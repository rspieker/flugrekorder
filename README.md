# flugrekorder

[![npm version](https://img.shields.io/npm/v/flugrekorder)](https://www.npmjs.com/package/flugrekorder)
[![CI](https://github.com/rspieker/flugrekorder/actions/workflows/tests.yml/badge.svg)](https://github.com/rspieker/flugrekorder/actions/workflows/tests.yml)
[![license](https://img.shields.io/npm/l/flugrekorder)](LICENSE)

> A tireless, impartial, punctilious, incurious spectator. It witnesses every interaction. It takes note. It understands nothing. Remarkably, this is a feature.

Wraps any object, function, or array in a transparent `Proxy` and emits a structured `Rekording` for every Reflect trap that fires — get, set, apply, construct, and all others.

Design principle: **record structure, relay behaviour, understand nothing.**
The recorder has no knowledge of what it wraps. If a dependency adds new methods, they are recorded automatically.

---

## Installation

```sh
npm install flugrekorder
```

---

## Quick start

```ts
import { create, type Rekording } from 'flugrekorder';

const records: Rekording[] = [];
const p = create({ greet: (name: string) => `hello, ${name}` }, {
  callback: (r) => records.push(r),
});

p.greet('world');

console.log(records.map((r) => `${r.id} ${r.trap}`));
// #1 get
// #2 apply
```

---

## API

### `create(target, options)`

Wraps `target` in a recording proxy and returns it. The proxy is transparent — all operations on it behave identically to the original.

```ts
import { create, type Rekording } from 'flugrekorder';

const records: Rekording[] = [];
const p = create(target, { callback: (r) => records.push(r) });
```

**`options`**

| Field | Type | Default | Description |
|---|---|---|---|
| `callback` | `(r: Rekording) => void` | — | Called synchronously with each record. Mutually exclusive with `stream`. |
| `stream` | `Writable` | — | Node.js Writable; records are written as newline-delimited JSON. Mutually exclusive with `callback`. |
| `id` | `number \| (() => string)` | `0` | Starting integer for the auto-incrementing ID sequence, or a custom generator. IDs take the form `#1`, `#2`, … unless overridden. |
| `recursive` | `boolean` | `true` | When `false`, only the root target is proxied. Values returned from traps are passed through as-is. |
| `only` | `string[]` | all traps | Allowlist of Reflect trap names to record. Traps not listed pass straight through to `Reflect` without emitting a record. |

One of `callback` or `stream` is required.

---

### `isFlugrekorder(value)`

Returns `true` if `value` is a proxy created by this module.

```ts
import { create, isFlugrekorder } from 'flugrekorder';

const p = create({ nested: { x: 1 } }, { callback: () => {} });

isFlugrekorder(p);         // true
isFlugrekorder(p.nested);  // true — proxied recursively
isFlugrekorder({});        // false
isFlugrekorder(42);        // false
```

---

### `getOrigin(proxy)`

Returns the structured `Origin` of a proxy — how and from where it was created. Returns `null` for the root proxy and for non-proxies.

```ts
import { create, getOrigin } from 'flugrekorder';

const p = create({ a: { v: 1 } }, { callback: () => {} });

getOrigin(p);    // null  (root)
getOrigin(p.a);  // { trap: 'get', parent: '#1', key: 'a' }
```

---

### `getAncestors(proxy)`

Walks the origin chain from the root proxy down to `proxy` and returns every step as an ordered array of `{ proxy, origin }` pairs, root first. Returns an empty array for non-proxies.

```ts
import { create, getAncestors } from 'flugrekorder';

const p = create({ a: { b: { c: 1 } } }, { callback: () => {} });

getAncestors(p.a.b);
// [
//   { proxy: <root>, origin: null },
//   { proxy: <a>,    origin: { trap: 'get', parent: '#1', key: 'a' } },
//   { proxy: <b>,    origin: { trap: 'get', parent: '#2', key: 'b' } },
// ]
```

---

### `getPath(proxy)`

Produces a human-readable dotted path string. Function and constructor calls are annotated with `()`. Returns an empty string for the root proxy and for non-proxies.

```ts
import { create, getPath } from 'flugrekorder';

const p = create({ a: { b: { fn: () => ({ v: 1 }) } } }, { callback: () => {} });

getPath(p);           // ''
getPath(p.a);         // 'a'
getPath(p.a.b.fn);   // 'a.b.fn'
getPath(p.a.b.fn()); // 'a.b.fn()'
```

---

### `getTarget(proxy)`

Returns the original unwrapped target of a proxy. Returns `null` for non-proxies.

```ts
import { create, getTarget } from 'flugrekorder';

const target = { x: 1 };
const p = create(target, { callback: () => {} });

getTarget(p) === target; // true
getTarget({});           // null
```

---

### `getProxyById(id, proxy)`

Looks up a proxy by its recorded ID within the same graph as `proxy`. Useful for resolving `{ $proxy: id }` references in recorded args and results back to live proxy objects. Returns `undefined` if the ID is not found.

```ts
import { create, getProxyById, type Rekording } from 'flugrekorder';

const records: Rekording[] = [];
const p = create({ nested: { x: 1 } }, { callback: (r) => records.push(r) });

p.nested; // triggers a get, result is { $proxy: '#2' }

const id = (records[0].result as { $proxy: string }).$proxy; // '#2'
const nested = getProxyById(id, p); // returns the same proxy as p.nested
```

---

## The `Rekording` shape

Every emitted record has this structure:

```ts
type Rekording = {
  id: string;       // e.g. '#3'
  trap: string;     // Reflect trap name: 'get', 'set', 'apply', …
  origin: {
    trap: 'get' | 'set' | 'defineProperty' | 'getOwnPropertyDescriptor';
    parent: string; // ID of the proxy this trap fired on
    key: string;    // property name (symbols are serialised to their string form)
  } | {
    trap: 'apply' | 'construct';
    source: string; // ID of the function/constructor proxy that was called
  } | null;         // null for the root proxy
  args: Serialized[];   // trap arguments
  result: Serialized;   // return value
};
```

`Serialized` values are JSON-safe: primitives pass through unchanged, proxiable values become `{ $proxy: '<id>' }`, arrays are serialised element-by-element, plain objects are serialised by value (with circular-reference protection).

---

## Examples

### Stream interactions to a file (NDJSON)

```ts
import { createWriteStream } from 'node:fs';
import { create } from 'flugrekorder';

const log = createWriteStream('interactions.ndjson');
const tracked = create(myService, { stream: log });

// Every trap now writes one JSON line to interactions.ndjson
await tracked.processOrder(orderId);
```

### Record only method calls

```ts
import { create, type Rekording } from 'flugrekorder';

const records: Rekording[] = [];
const p = create(myApi, {
  callback: (r) => records.push(r),
  only: ['apply'],
});

p.users.find({ active: true });

// records contains only 'apply' entries — one per function call
console.log(records.length); // 1
```

### Inspect the call graph after the fact

```ts
import { create, getPath, getProxyById, type Rekording } from 'flugrekorder';

const records: Rekording[] = [];
const p = create(myService, { callback: (r) => records.push(r) });

myService.run(p);

// Find every method call and display its path
records
  .filter((r) => r.trap === 'apply')
  .forEach((r) => {
    if (r.origin && 'source' in r.origin) {
      const fn = getProxyById(r.origin.source, p);
      if (fn) console.log('called:', getPath(fn));
    }
  });
```

### Custom ID sequence

```ts
import { create } from 'flugrekorder';

// Prefix IDs with a session token for correlation across multiple recordings
const session = crypto.randomUUID();
let n = 0;
const p = create(target, {
  callback: (r) => console.log(r.id),
  id: () => `${session}:${++n}`,
});
```

---

## Types

```ts
export type Proxiable = object | Function;

export type Serialized =
  | string | number | boolean | bigint | null | undefined
  | { readonly $proxy: string }
  | Serialized[]
  | { [key: string]: Serialized };

export type Origin =
  | { trap: 'get' | 'set' | 'defineProperty' | 'getOwnPropertyDescriptor'; parent: string; key: string | symbol }
  | { trap: 'apply' | 'construct'; source: string }
  | null;

export type Rekording = {
  id: string;
  trap: string;
  origin: { trap: string; parent?: string; key?: string; source?: string } | null;
  args: Serialized[];
  result: Serialized;
};
```
