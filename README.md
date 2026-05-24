# flugrekorder

[![npm version](https://img.shields.io/npm/v/flugrekorder)](https://www.npmjs.com/package/flugrekorder)
[![CI](https://github.com/rspieker/flugrekorder/actions/workflows/tests.yml/badge.svg)](https://github.com/rspieker/flugrekorder/actions/workflows/tests.yml)
[![license](https://img.shields.io/npm/l/flugrekorder)](LICENSE)

> Following a hunch but not sure if you need a microscope, a periscope, or a telescope? Zoom in, peek around, look beyond — all at once.

> A tireless, impartial, punctilious, incurious spectator. It witnesses every interaction. It takes note. It understands nothing. Remarkably, this is a feature.

Wraps any object, function, or array in a transparent `Proxy` and emits a structured `Rekording` for every Reflect trap that fires — get, set, apply, construct, and all others.

Design principle: **record structure, relay behaviour, understand nothing.**
The recorder has no knowledge of what it wraps. If a dependency adds new methods, they are recorded automatically.

---

## When to use this

- A side effect came knocking. Where did it come from? Was it invited? When? By whom?
- Here, we observe the code in its digital habitat. Undisturbed. Unmodified. Doing — what?
- The scriptures tell one story. The scribes tell another.
- You want a record. Not a theory, not a phantom — a record.

---

## Why not…

- **`console.log`** — you have to know where to put it first.
- **Mocks and spies** — they replace the real thing; you're no longer observing, you're performing.
- **Monkey-patching** — one property at a time, brittle, and you'll miss what you didn't think to patch.
- **A debugger** — interactive, ephemeral, and gone the moment you step past it.

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

## Quick useful patterns

**Watch sort rewrite your array**

`sort` reads every element to compare, then writes every position back. Most developers think of it as a single operation. It isn't.

```ts
import { create, format } from 'flugrekorder';

const todos = [
  '🔲 document quick examples',
  '🔲 release next version',
  '✅ build flugrekorder',
];
let tracked!: typeof todos;
tracked = create(todos, {
  only: ['get', 'set', 'apply'],
  callback: (r) => console.log(format(r, tracked)),
});

tracked[0] = tracked[0].replace('🔲', '✅');
tracked.sort();
```

```
0 → 🔲 document quick examples
0 = ✅ document quick examples
sort → sort
length → 3
0 → ✅ document quick examples
1 → 🔲 release next version
2 → ✅ build flugrekorder
0 = ✅ build flugrekorder
1 = ✅ document quick examples
2 = 🔲 release next version
sort()
```

The read phase (`→`) and write phase (`=`) are visible in sequence. After marking index `0` as done, `sort` reads all three items — including `✅ build flugrekorder` sitting at index `2` — then rewrites every position. The completed item from index `2` lands at `0` because `✅` sorts before `🔲`.

---

**What hint JavaScript passes when it coerces your object**

Every time JavaScript converts an object to a primitive, it calls `Symbol.toPrimitive` with a hint — `'string'`, `'number'`, or `'default'`. Track a `Date` to see which context passes which:

```ts
import { create, format } from 'flugrekorder';

const date = new Date('2025-01-15T12:00:00Z');
let tracked!: typeof date;
tracked = create(date, {
  only: ['get', 'apply'],
  callback: (r) => console.log(format(r, tracked)),
});

`${tracked}`;   // template literal
tracked + '';   // + operator
+tracked;       // unary plus
```

```
Symbol(Symbol.toPrimitive) → Symbol(Symbol.toPrimitive)
Symbol(Symbol.toPrimitive)(string)
Symbol(Symbol.toPrimitive) → Symbol(Symbol.toPrimitive)
Symbol(Symbol.toPrimitive)(default)
Symbol(Symbol.toPrimitive) → Symbol(Symbol.toPrimitive)
Symbol(Symbol.toPrimitive)(number)
```

`tracked + ''` passes `'default'`, not `'string'` — most developers expect string-hint here. For `Date` both resolve to the same string representation, but that is a `Date`-specific choice, not a JavaScript guarantee.

---

**What survives `JSON.stringify` — and what doesn't**

`toJSON` lets an object control its own serialisation. Track one to see exactly what it reads, what it returns, and which values quietly disappear on the way to JSON.

```ts
import { create, format } from 'flugrekorder';

const config: Record<string, Record<string, unknown>> = {
  db: {
    host: 'localhost',
    port: 27017,
    database: 'example',
    timeout: Infinity,
    toJSON() {
      return {
        dsn: `${this['protocol'] ?? 'mongodb'}://${this['host']}:${this['port']}/${this['database']}`,
        timeout: this['timeout'],
      };
    },
  },
};

let tracked!: typeof config;
tracked = create(config, {
  only: ['get', 'apply'],
  callback: (r) => console.log(format(r, tracked)),
});

console.log(JSON.stringify(tracked));
```

```
toJSON → undefined
db → db
db.toJSON → db.toJSON
db.protocol → undefined
db.host → localhost
db.port → 27017
db.database → example
db.timeout → Infinity
db.toJSON(db)
db.toJSON().dsn → mongodb://localhost:27017/example
db.toJSON().timeout → Infinity

{"db":{"dsn":"mongodb://localhost:27017/example","timeout":null}}
```

`protocol` was read but never set — `toJSON` had a hidden dependency. `timeout` recorded faithfully as `Infinity` throughout, then silently coerced to `null` in the final JSON because `Infinity` is not valid JSON.

---

**How many comparisons does `sort` need?**

Sorting feels atomic — pass an array, get it back in order. But `sort` calls your comparator repeatedly, and the number of calls — and their order — is what the algorithm actually looks like. Writing every call to disk is an easy way to count them and examine the sequence afterwards.

```ts
import { createWriteStream } from 'node:fs';
import { create } from 'flugrekorder';

const words = ['banana', 'apple', 'elderberry', 'cherry', 'date', 'fig'];

let compare!: (a: string, b: string) => number;
compare = create((a: string, b: string) => a.localeCompare(b), {
  only: ['apply'],
  stream: createWriteStream('comparisons.ndjson'),
});

words.sort(compare);
console.log(words);
```

```
[ 'apple', 'banana', 'cherry', 'date', 'elderberry', 'fig' ]
```

`comparisons.ndjson` — 9 lines written, first two shown:

```json
{"id":"#2","trap":"apply","origin":{"trap":"apply","source":"#1"},"args":[{"$proxy":"#1"},null,["apple","banana"]],"result":-1,"timestamp":1748091234567}
{"id":"#3","trap":"apply","origin":{"trap":"apply","source":"#1"},"args":[{"$proxy":"#1"},null,["elderberry","apple"]],"result":1,"timestamp":1748091234568}
...
```

For 6 words, V8 made 9 comparisons — not 15 (the bubble sort worst case for 6 elements). The pattern is binary insertion sort: each word is binary-searched into position in the already-sorted prefix. `args[2]` holds the pair being compared; `result` is the comparator's return value. Swap the input for a larger or reverse-sorted list and the count — and the pattern — change.

---

**Request logging**

An HTTP server handles requests concurrently. `callback` accumulates records per request in memory — `stream` writes directly to disk as each trap fires. Custom IDs make records from concurrent requests separable: every record carries its request's namespace.

```ts
import { createServer } from 'node:http';
import { createWriteStream } from 'node:fs';
import { create } from 'flugrekorder';

let n = 0;
const log = createWriteStream('requests.ndjson');

const server = createServer((req, res) => {
  let seq = 0;
  const rid = `req${++n}`;
  let r!: typeof req;
  r = create(req, { id: () => `${rid}:${++seq}`, stream: log });

  if (r.url === '/hello') {
    res.end(`Hello, ${r.method}!`);
  } else {
    res.statusCode = 404;
    res.end(`not found: ${r.method}: ${r.url}`);
  }
});

await new Promise<void>(resolve => server.listen(3000, resolve));
console.log((await fetch('http://localhost:3000/hello')).status);
console.log((await fetch('http://localhost:3000/missing')).status);
server.close();
```

```
200
404
```

`requests.ndjson` — 3 lines written:

```json
{"id":"req1:2","trap":"get","origin":{"trap":"get","parent":"req1:1","key":"url"},"args":[{"$proxy":"req1:1"},"url",{"$proxy":"req1:1"}],"result":"/hello","timestamp":1748091234100}
{"id":"req1:3","trap":"get","origin":{"trap":"get","parent":"req1:1","key":"method"},"args":[{"$proxy":"req1:1"},"method",{"$proxy":"req1:1"}],"result":"GET","timestamp":1748091234101}
{"id":"req2:2","trap":"get","origin":{"trap":"get","parent":"req2:1","key":"url"},"args":[{"$proxy":"req2:1"},"url",{"$proxy":"req2:1"}],"result":"/missing","timestamp":1748091234150}
...
```

Certainly not the average request log, but a full picture of what happened when, where and why.
`req1:*` and `req2:*` are distinct namespaces in the same file. The 404 handler reads only `url` — `method` never appears in its records because the handler never touches it. Under concurrent load the records interleave by timestamp, but `grep req1` always isolates one request.

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
  timestamp: number;    // Date.now() at the moment the trap fired
};
```

`Serialized` values are JSON-safe: primitives pass through unchanged, proxiable values become `{ $proxy: '<id>' }`, arrays are serialised element-by-element, plain objects are serialised by value (with circular-reference protection).

---

## Resolving paths inside a callback

`getProxyById` and `getPath` are most useful when called *inside* the callback while the trap is still in context — not as a post-processing step on the raw recordings.

When an `apply` trap fires, `origin.source` is the ID of the function proxy that was called. Resolving it immediately gives you a human-readable path:

```ts
let p!: typeof myService;

p = create(myService, {
  only: ['get', 'apply'],
  callback(r) {
    if (r.trap !== 'apply' || !r.origin || !('source' in r.origin)) return;
    const fn = getProxyById(r.origin.source, p);
    if (fn) console.log('called:', getPath(fn)); // e.g. "users.find"
  },
});
```

The same pattern works for `set` traps — `origin.parent` is the ID of the proxy being written to:

```ts
let p!: typeof config;

p = create(config, {
  callback(r) {
    if (r.trap !== 'set' || !r.origin || !('parent' in r.origin)) return;
    const parent = getProxyById(r.origin.parent, p);
    const prefix = parent ? getPath(parent) : '';
    console.log(`${prefix ? `${prefix}.` : ''}${r.origin.key} =`, r.args[2]);
    // e.g. "db.port = 5433"
  },
});
```

Note the `let p!: typeof …` pattern: the callback closes over `p` before it is assigned, but `p` is fully set by the time any trap fires, so the reference is always valid.

---

## How it works

### One graph per session

Every `create()` call produces an isolated `Graph` — a session-scoped registry that maps proxies, targets, and IDs to each other. Once all references to a proxied tree are dropped, the graph is eligible for garbage collection. There are no module-level leaks between independent recordings.

### Structured origin

Each proxy carries an `Origin` that describes exactly how it was created: which trap fired, on which parent proxy, and under which key (for property traps) or from which function proxy (for call traps). This makes the recording self-describing — you can reconstruct a full call graph from the records alone, without keeping any external state.

Earlier designs tracked paths as arrays of keys. That approach broke down when the same object was accessed via different routes, or when proxies were collected before the path could be read. Storing a parent ID and a key instead of a full path makes the origin both stable and compact.

### `{ $proxy: id }` serialization

Proxiable values (objects and functions) in args and results are replaced with `{ $proxy: '<id>' }` tags rather than inlined. This keeps records JSON-safe, avoids circular reference problems, and lets you resolve references back to live proxies via `getProxyById` when needed.

### Promises

Promises cannot be proxied directly — native `.then()` checks for the `[[PromiseState]]` internal slot and throws if `this` is a Proxy. Instead, flugrekorder returns a new Promise that resolves to a proxy of the settled value, maintaining the stability guarantee across async boundaries.

### `wrap` vs `wrapKnown`

Trap specs use two wrapping modes. `wrap` creates a new proxy for any proxiable value not already in the graph — used for results, where a newly returned object should be recorded. `wrapKnown` only wraps values that are already in the graph — used for call arguments, where passing a plain object to a proxied function should not silently create a new proxy out of it.

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
  timestamp: number;
};
```
