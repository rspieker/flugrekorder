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
- When the whole district looks suspicious, bring them all to the archives, every soul, every mouse, every elephant. They all give a statement. They don't get a choice.

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

const records: Array<Rekording> = [];
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

### Watch sort rewrite your array

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

Output:
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

### What hint JavaScript passes when it coerces your object

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

Output:
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

### What survives `JSON.stringify` — and what doesn't

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

Output:
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

### How many comparisons does `sort` need?

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

Output:
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

### Request logging

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

Output:
```
200
404
```

`requests.ndjson` — 5 lines written:

```json
{"id":"req1:2","trap":"get","origin":{"trap":"get","parent":"req1:1","key":"url"},"args":[{"$unwrap":{"$proxy":"req1:1"}},"url",{"$proxy":"req1:1"}],"result":"/hello","timestamp":1748091234100}
{"id":"req1:3","trap":"get","origin":{"trap":"get","parent":"req1:1","key":"method"},"args":[{"$unwrap":{"$proxy":"req1:1"}},"method",{"$proxy":"req1:1"}],"result":"GET","timestamp":1748091234101}
{"id":"req2:2","trap":"get","origin":{"trap":"get","parent":"req2:1","key":"url"},"args":[{"$unwrap":{"$proxy":"req2:1"}},"url",{"$proxy":"req2:1"}],"result":"/missing","timestamp":1748091234150}
{"id":"req2:3","trap":"get","origin":{"trap":"get","parent":"req2:1","key":"method"},"args":[{"$unwrap":{"$proxy":"req2:1"}},"method",{"$proxy":"req2:1"}],"result":"GET","timestamp":1748091234151}
{"id":"req2:4","trap":"get","origin":{"trap":"get","parent":"req2:1","key":"url"},"args":[{"$unwrap":{"$proxy":"req2:1"}},"url",{"$proxy":"req2:1"}],"result":"/missing","timestamp":1748091234151}
```

Certainly not the average request log, but a full picture of what happened when, where and why.
`req1:*` and `req2:*` are distinct namespaces in the same file. `args[0]` carries `$unwrap` — the raw request object (not the proxy) — because that is what the Reflect `get` trap receives as its target. `args[2]` is the proxy receiver. The 404 handler reads `url` twice and `method` once — exactly as written. Under concurrent load the records interleave by timestamp, but `grep req1` always isolates one request.

---

### Find the call behind a memory spike

flugrekorder knows nothing about memory — but the callback runs synchronously after every trap, so it can take a sample itself. A record fires only once a trap *returns*, though, and the call that runs a process out of memory never does. The `get` that looks a method up fires *before* the call, so it doubles as an entry marker.

```ts
import { openSync, writeSync } from 'node:fs';
import { create } from 'flugrekorder';

const log = openSync('memory.ndjson', 'w');
const write = (line: object) => writeSync(log, `${JSON.stringify(line)}\n`);
let peak = process.resourceUsage().maxRSS;
let seq = 0;
const id = () => `#${++seq}`;

// exit: every method becomes its own non-recursive proxy
for (const [key, fn] of Object.entries(processor)) {
  processor[key] = create(fn, {
    id,
    only: ['apply'],
    recursive: false,
    depth: 0,
    callback(r) {
      const { maxRSS } = process.resourceUsage();
      write({ id: r.id, exit: key, growth: Math.round((maxRSS - peak) / 1024) });
      peak = maxRSS;
    },
  });
}

// enter: looking up `p.method` fires just before calling it
const p = create(processor, {
  id,
  only: ['get'],
  recursive: false,
  callback: (r) => write({ id: r.id, enter: r.origin && 'key' in r.origin ? r.origin.key : '?' }),
});
```

`memory.ndjson` after a crash ends with a call that was entered but never exited:

```json
{"id":"#13","exit":"parse","growth":85}
{"id":"#14","enter":"normalise"}
```

Without the memory limit, the same run reports `{"exit":"normalise","growth":213}`, while `heapUsed` *dropped* by 66MB across that call. Some details matter more than they look:

- **`maxRSS`, not `heapUsed`.** Garbage collection can run between the spike and the sample, so the heap may look fine afterwards. `maxRSS` is a high-water mark: its growth per call is what each call cost at its worst. `Buffer` contents count towards `external`, not the heap.
- **`writeSync`, not `stream`.** A Writable buffers in memory, adding to the spike, and whatever is still buffered when the process dies is lost.
- **`recursive: false`.** Proxying the payload records every element read and creates a proxy for each, which takes memory of its own for as long as the payload lives. The recorder becomes the spike.
- **`depth: 0`.** The default `depth: Infinity` serializes plain-object arguments by value, so a `Buffer` argument is serialized byte by byte. Here it also stops the `apply` record from serializing `this`, which is the `enter` proxy: reading its keys would fire its `get` trap and log entries that never happened.

The record names the call, not the line. Wrap the internals of the call it points at and run again, or take a heap snapshot at the limit (`node --heapsnapshot-near-heap-limit=1`) to see what filled it. The runnable version is [`examples/07-memory-spike.ts`](examples/07-memory-spike.ts).

---

## API

### `create(target, options)`

Wraps `target` in a recording proxy and returns it. The proxy is transparent — all operations on it behave identically to the original.

```ts
import { create, type Rekording } from 'flugrekorder';

const records: Array<Rekording> = [];
const p = create(target, { callback: (r) => records.push(r) });
```

**`options`**

| Field | Type | Default | Description |
|---|---|---|---|
| `callback` | `(r: Rekording) => void` | — | Called synchronously with each record. Mutually exclusive with `stream`. |
| `stream` | `Writable` | — | Node.js Writable; records are written as newline-delimited JSON. Mutually exclusive with `callback`. |
| `id` | `number \| (() => string)` | `0` | Starting integer for the auto-incrementing ID sequence, or a custom generator. IDs take the form `#1`, `#2`, … unless overridden. |
| `recursive` | `boolean` | `true` | When `false`, only the root target is proxied. Values returned from traps are passed through as-is. |
| `only` | `Array<string>` | all traps | Allowlist of Reflect trap names to record. Traps not listed behave exactly the same — their results are proxied, so nested values stay visible — but produce no record: no ID, no serialization, no `location` or `stack`. `only: ['apply']` records every call into a nested API without recording the property reads that lead to it. |
| `filter` | `(r: Rekording) => boolean` | — | Called with each record before it is emitted; return `false` to drop it. Unlike `only`, the record is already built — serialized, with `location` and `stack` — when `filter` sees it, so use `only` to leave out whole traps and `filter` to choose among records. |
| `depth` | `number` | `Infinity` | Maximum depth for nested object serialization. Deeper values are replaced with `[…]`. |
| `redact` | `Redactor \| Array<Redactor>` | — | Function(s) to redact sensitive values. Return `true` to replace with `"[redacted]"`, `false` to keep as-is, or a string for custom replacement. |
| `truncate` | `number` | `Infinity` | Maximum string length before truncation. Longer strings are truncated with `…`. |
| `values` | `boolean` | `true` | When `false`, no value is recorded: every value in `args` and `result` becomes `{ $omitted: kind }` — `null`, `Array<length>`, binary data as `Uint8Array<32>`, otherwise its `typeof`. References (`$proxy`, `$unwrap`), property keys and the argument list of a call keep their shape, so `format` still shows `db.port = ‹number›`. Nothing is serialized, and the guarantee comes from the configuration, not from `depth` and `truncate` limits. |
| `bind` | `boolean` | `undefined` | Controls how flugrekorder handles classes with `#` private fields. See [Private fields](#private-fields-bind). |
| `location` | `boolean` | `false` | Adds `location` to `apply` and `construct` records: where the called function is defined. See [Where code lives](#where-code-lives-location-and-stack). |
| `stack` | `boolean \| number` | `false` | Adds `stack` to every record: the call stack that made the trap fire. `true` records every frame (up to 200, Node.js's limit), a number up to that many. See [Where code lives](#where-code-lives-location-and-stack). |

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

Walks the origin chain from the root proxy down to `proxy` and returns every step as an ordered array of `{ id, proxy, origin }`, root first. The chain is complete even when ancestors have been garbage collected; the `proxy` of such a step is then `undefined`. Returns an empty array for non-proxies.

```ts
import { create, getAncestors } from 'flugrekorder';

const p = create({ a: { b: { c: 1 } } }, { callback: () => {} });

getAncestors(p.a.b);
// [
//   { id: '#1', proxy: <root>, origin: null },
//   { id: '#2', proxy: <a>,    origin: { trap: 'get', parent: '#1', key: 'a' } },
//   { id: '#3', proxy: <b>,    origin: { trap: 'get', parent: '#2', key: 'b' } },
// ]
```

---

### `getPath(proxy)`

Produces a human-readable dotted path string. Function and constructor calls are annotated with `()`. Returns an empty string for the root proxy and for non-proxies.

```ts
import { create, getPath } from 'flugrekorder';

const p = create({ a: { b: { fn: () => ({ v: 1 }) } } }, { callback: () => {} });

getPath(p);          // ''
getPath(p.a);        // 'a'
getPath(p.a.b.fn);   // 'a.b.fn'
getPath(p.a.b.fn()); // 'a.b.fn()'
```

---

### `getLocation(proxy)`

Returns where the function behind a proxy is defined, as a `SourceLocation`. Returns `null` for non-proxies, for proxies of anything but a function, for functions without a source location (native functions), and outside Node.js. Works without the `location` option.

```ts
import { create, getLocation } from 'flugrekorder';

const greeter = create(require('greeter'), { callback: () => {} });

getLocation(greeter.greet); // { file: 'node_modules/greeter/index.js', line: 1, column: 31 }
getLocation(Math.max);      // null  (not a proxy)
```

---

### `registerStackParser(parser)`

Adds a `StackParser` ahead of the built-in ones, for an engine with a stack format of its own — or to read a known format differently. Call it once; every `create()` with `stack` uses it from then on. Each line of `Error.stack` goes to the parsers in turn; the first to return a frame wins, and lines no parser understands are skipped. Parsers are only used where call stacks come as `Error.stack` strings (browsers): Node.js reports structured call sites, which need no parsing.

```ts
import { registerStackParser } from 'flugrekorder';

// an engine reporting frames as `name (url line:column)`
registerStackParser((line) => {
  const match = line.match(/^(\S+) \((.+) (\d+):(\d+)\)$/);

  return match
    ? { file: match[2], line: Number(match[3]), column: Number(match[4]), function: match[1] }
    : undefined;
});
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

Looks up a proxy by its recorded ID within the same graph as `proxy`. Useful for resolving `{ $proxy: id }` references in recorded args and results back to live proxy objects. Returns `undefined` if the ID is not found, or its object has been garbage collected.

```ts
import { create, getProxyById, type Rekording } from 'flugrekorder';

const records: Array<Rekording> = [];
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
  trap: string;     // Reflect trap name: 'get', 'set', 'apply', … or a synthetic variant ('apply:native', 'apply:structure', 'apply:private')
  origin: {
    trap: 'get' | 'set' | 'defineProperty' | 'getOwnPropertyDescriptor';
    parent: string; // ID of the proxy this trap fired on
    key: string;    // property name (symbols are serialised to their string form)
  } | {
    trap: 'apply' | 'construct';
    source: string;        // ID of the function/constructor proxy that was called
  } | null;                // null for the root proxy
  args: Array<Serialized>; // trap arguments
  result: Serialized;      // return value
  timestamp: number;       // Date.now() at the moment the trap fired
  location?: SourceLocation | null; // with `location`, on apply/construct records: where the called function is defined
  stack?: Array<StackFrame>;        // with `stack`: the call stack that made the trap fire, nearest frame first
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
  only: ['apply'],
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

A session doesn't keep objects alive either: a proxy and its graph entry live exactly as long as the object behind it. The index by ID holds its entries through `WeakRef`s, and a `FinalizationRegistry` removes the entries of objects that have been collected. So `getProxyById` resolves an ID for as long as its object exists — and returns `undefined` after that — and a long-running process can record without its memory growing with everything that passed through it. Runtimes without `WeakRef` or `FinalizationRegistry` keep entries strongly instead.

Paths survive collection: every proxy carries its *lineage* — its ID and origin, and its parent's lineage — which holds no application objects. A certificate kept from a `parse()` result that has since been collected still has the path `parse().certificate`.

Objects behind a `WeakRef` stay alive until the task that touched them has ended, so in one long synchronous run, nothing is released until it is over. Recording still costs memory while objects are alive: a proxy per object reached. When memory is what you are investigating, wrap code boundaries with `recursive: false` rather than the data flowing through them (see [Find the call behind a memory spike](#find-the-call-behind-a-memory-spike)).

### Structured origin

Each proxy carries an `Origin` that describes exactly how it was created: which trap fired, on which parent proxy, and under which key (for property traps) or from which function proxy (for call traps). This makes the recording self-describing — you can reconstruct a full call graph from the records alone, without keeping any external state.

Earlier designs tracked paths as arrays of keys. That approach broke down when the same object was accessed via different routes, or when proxies were collected before the path could be read. Storing a parent ID and a key instead of a full path makes the origin both stable and compact.

### `{ $proxy: id }` serialization

Proxiable values (objects and functions) in args and results are replaced with `{ $proxy: '<id>' }` tags rather than inlined. This keeps records JSON-safe, avoids circular reference problems, and lets you resolve references back to live proxies via `getProxyById` when needed.

### Promises

Promises cannot be proxied directly — native `.then()` checks for the `[[PromiseState]]` internal slot and throws if `this` is a Proxy. Instead, flugrekorder returns a new Promise that resolves to a proxy of the settled value, maintaining the stability guarantee across async boundaries.

### Stand-in targets

A `Proxy` is held to its target by the engine: a property that is non-configurable and read-only — every property of a frozen object, or a getter as TypeScript and Babel emit for re-exports — must be reported exactly as the target holds it, and so must the target's extensibility. A proxy over the real target could therefore never hand out a proxy for a frozen value, and anything done with that value would go unrecorded.

So a flugrekorder proxy does not wrap the real target. It wraps an empty stand-in of the same kind — an object, an array, or a function that is constructable only when the target is — and relays every trap to the real target. The engine checks results against the stand-in, which follows the real target only as far as the invariants demand: a non-configurable property is copied onto it once a trap reports it, and once the real target stops being extensible (also when it is frozen around the proxy), so does the stand-in. Copies hold the value as the proxy reported it, so the same proxy is reported by every trap from then on.

For this to work, every trap has a handler, including those left out of `only`: those do everything a recorded trap does, except produce a record.

**Known limitation** — this concerns explicit redefinition only; assignment behaves as on the target. Once the proxy has *described* a non-configurable, read-only property (`Object.getOwnPropertyDescriptor`, spread, `Object.keys` on a frozen object, …), calling `Object.defineProperty` or `Reflect.defineProperty` on the proxy with the raw value taken from the real target is refused: `Reflect.defineProperty` returns `false`, `Object.defineProperty` throws. On the real target that call can only be a no-op — a frozen property can only be redefined to what it already is. The engine holds the caller's descriptor against the stand-in's copy after the trap returns, so the trap can only choose between refusing (`false`) and the engine throwing; it refuses. Redefining with the descriptor read through the proxy works.

### Where code lives (`location` and `stack`)

A record says *what* happened. Two options add *where*: `location` names the file a called function is defined in, `stack` the files the call came through. `stack` works in Node.js and in browsers; `location` is Node.js only. `create()` throws when an option is asked for in a runtime that cannot provide it.

Here an application calls a dependency, `welcome`, which calls the wrapped one, `greeter`:

```ts
// src/app.mjs
const greeter = create(require('greeter'), {
  only: ['apply'],
  location: true,
  stack: 3,
  callback(r) {
    if (r.trap === 'apply') console.log(JSON.stringify({ location: r.location, stack: r.stack }));
  },
});
const { welcome } = require('welcome');

welcome(greeter, 'world');
```

```json
{"location":{"file":"node_modules/greeter/index.js","line":1,"column":31},
 "stack":[{"file":"node_modules/welcome/index.js","line":2,"column":17,"function":"welcome"},
          {"file":"src/app.mjs","line":15,"column":1,"function":""},
          {"file":"node:internal/modules/esm/module_job","line":343,"column":25,"function":"run"}]}
```

Paths are just paths: which package a file belongs to — `node_modules/<name>`, or the application itself — is for whoever reads the records to decide.

- **`stack`** uses `util.getCallSites` in Node.js, which honours `--enable-source-maps`; elsewhere it reads `Error.stack` (see [In browsers](#in-browsers)). flugrekorder's own frames are left out: the recorder is not part of what it records. A frame count is a cost control as much as a filter: capturing a stack costs roughly 10–50µs per record, growing with the number of frames captured, so `stack: 10` on a deep stack is a lot cheaper than `stack: true`. Combine it with `only` to capture stacks only for the traps you need.
- **`location`** asks V8 where a function is defined, through an in-process `node:inspector` session. Bound functions and proxies are followed to the function they call. Positions are as V8 reports them: the `class` keyword for classes, the opening parenthesis of the parameter list for functions. The lookup takes tens of microseconds, once per function; after that it is cached. The debugger is never enabled — it would slow the application down, and disabling it again disturbs coverage tools such as c8 — so script URLs come from V8's best-effort coverage data instead, collected once for every script not seen before.

#### In browsers

Browsers report call stacks as `Error.stack` strings only, so flugrekorder parses them: the format V8 uses (Chrome, Edge), and the one SpiderMonkey (Firefox) and JavaScriptCore (Safari) share. Tests run the same scenarios in all three engines.

- **Files are URLs, as the browser reports them**: in a browser, the domain is the working directory.
- **Columns differ per engine**: each points at a different part of the call — V8 and SpiderMonkey at its start, JavaScriptCore just past the function being called. Lines agree.
- **Function names are as each engine reports them.** V8 prefixes a method call with its receiver's type (`Greeter.greet`, where Node.js reports `greet`), and SpiderMonkey makes up names for anonymous functions (`window.samples/<.anonymous<`). The string doesn't tell a prefix from a name with a dot in it, so names are not altered.
- **Safari reports no frames for eval'd code**, so there are none to record.
- **Frames of flugrekorder further down a stack stay**: bundled into an application, its code shares the application's file, so only the frames above the trap can be dropped — by position. They only appear when a trap fired inside another, and that other trap has a record of its own.
- **Source maps are not applied**: positions are those of the code that ran. A bundle's source map turns them back into original files and lines afterwards.

Engines with a format of their own can be taught with [`registerStackParser`](#registerstackparserparser).

### `wrap` vs `known`

Trap specs use two wrapping modes. `wrap` creates a new proxy for any proxiable value not already in the graph — used for results, where a newly returned object should be recorded. `known` only wraps values that are already in the graph — used for call arguments, where passing a plain object to a proxied function should not silently create a new proxy out of it.

### Native boundary crossings (`apply:native`, `apply:structure`, `apply:private`)

Some native code rejects a `Proxy` as `this` or as an argument — V8 checks the real target at the C++ level before any JS runs. flugrekorder catches these failures, retries with the unwrapped real target, and records the crossing with a synthetic trap name so it remains visible in the rekording.

**`apply:native`** — a host method (Node.js, DOM) rejected a Proxy as `this`: `Illegal invocation` in V8, `… does not implement interface …` in SpiderMonkey, `Can only call … on instances of …` in JavaScriptCore, and a `TypeError` coded `ERR_INVALID_THIS` from Node.js classes written in JavaScript, such as `URLSearchParams`. The real target is substituted for `this` and the call is retried. A getter of such a class (`URLSearchParams.prototype.size`) is retried the same way, with the real target as receiver, and stays a `get` record. The unwrapped `this` appears as `{ $unwrap: { $proxy: "<id>" } }` in `args[1]`.

**`apply:structure`** — a function internally passed a proxied argument to the [Structured Clone Algorithm](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Structured_clone_algorithm) (`structuredClone`, `postMessage`, `history.pushState`, …), which threw `DataCloneError`. flugrekorder unwraps any proxy arguments in the call and retries. Unwrapped args appear as `{ $unwrap: { $proxy: "<id>" } }` in `args[2]`.

**Binary data is passed on unwrapped** — `ArrayBuffer`, `SharedArrayBuffer`, typed arrays and `DataView` reached through a proxy are not proxied themselves. Other built-ins read the bytes behind them directly (`new Uint8Array(buffer)`, `TextDecoder`, `crypto`, `structuredClone`, WebAssembly), and a proxy has none: they would throw, or silently read an empty array-like. Reading binary data is recorded; what is done with the bytes is not, which native code would not show through a proxy anyway. A root `create(buffer)` is proxied as asked.

**Built-ins in every engine** — objects such as `Map`, `Set`, `Date` and WebAssembly's `Memory` keep their state in internal slots a proxy cannot carry. flugrekorder recognises them by probing a native method or getter through a blank proxy: a native function that throws a `TypeError` there has failed a brand check — however the engine words it.

**Remaining gap** — a *direct* `structuredClone(proxy)` call that never passes through a flugrekorder trap cannot be intercepted; V8 resolves the proxy before any JS runs. Use `structuredClone(getTarget(proxy))` at the call site as a workaround.

### Private fields (`bind`)

JavaScript `#` private fields and methods are stored on the real instance. Accessing them with `this` as a Proxy throws a `TypeError` — `Cannot read private member …` or `Receiver must be an instance of class …` in V8, `… private field or method: object is not the right class` in SpiderMonkey, `Cannot access invalid private field` in JavaScriptCore — the engine enforces the class boundary at the field level.

The `bind` option controls how flugrekorder responds:

**`undefined` (default)** — flugrekorder tries normally. If a method or getter throws the private-field TypeError, it retries with the real target as `this`. Method calls record as `apply:private` instead of `apply` to signal the crossing; getter reads record transparently as `get`. This is the zero-friction path — no configuration needed, no crashes.

**`bind: true`** — flugrekorder pre-binds all methods to the real target at `get` time, before any call is attempted. Calls record as plain `apply` and never throw. The trade-off: any property access that happens *inside* a method (e.g. `this.name`) runs on the real target, bypassing the proxy. Those internal reads and writes are not recorded.

**`bind: false`** — flugrekorder never retries. If a method throws due to a `#` private field, the error propagates unchanged. Use this when you know the class has no `#` fields and want to ensure unexpected private-field errors surface rather than being silently retried.

```ts
class Counter {
  #count = 0;
  increment() { this.#count++; }
  get value()  { return this.#count; }
}

// default: automatic retry, apply:private in recording
const p = create(new Counter(), { callback });
p.increment(); // records trap: 'apply:private'
p.value;       // records trap: 'get'

// bind: true: pre-bound, plain apply in recording, internals invisible
const q = create(new Counter(), { bind: true, callback });
q.increment(); // records trap: 'apply'
q.value;       // records trap: 'get'
```

**The inverse** — a class that uses `#` private fields exclusively for its internal state is naturally opaque to flugrekorder: method calls are recorded but what happens inside them is not. This is an effective opt-out for library authors who want their implementation details to remain unobservable regardless of whether a caller wraps their object.

---

## Types

### `Proxiable`
Any value that can be proxied: objects or functions.

```ts
type Proxiable = object | Function;
```

### `Redactor`
Function that decides how to handle sensitive values during serialization.

```ts
type Redactor = (
  key: string | symbol,
  value: unknown,
  target: object,
) => string | boolean | null;
```

```ts
/**
 * @param key - Property key being serialized
 * @param value - Value at that key
 * @param target - Parent object containing the key
 * @returns `true` to replace with `"[redacted]"`, `false` to keep as-is,
 *          a string for custom replacement, or `null` to drop the key
 */
const hideSecrets: Redactor = (key) => key === 'password';
const redactSecrets: Redactor = (key, value) => key === 'password' && '*'.repeat(String(value).length);
const dropSecrets: Redactor = (key) => key === 'password' ? null : false;
```

### `Origin`
Describes how a proxy was created. Every proxied value carries its `Origin` so you can trace where it came from in the proxy tree. `null` for the root proxy.

```ts
type Origin =
  | { trap: 'get' | 'set' | 'has' | 'deleteProperty' | 'defineProperty' | 'getOwnPropertyDescriptor'; parent: string; key: string | symbol }
  | { trap: 'apply' | 'construct'; source: string }
  | null;
```

| Field | Type | Description |
|-------|------|-------------|
| `trap` | `string` | The trap that created this proxy |
| `parent` | `string` | Proxy ID of the parent that returned this value |
| `key` | `string \| symbol` | Property key accessed |
| `source` | `string` | Proxy ID of the function that returned this value |

### `Rekording`
A single recorded interaction from a proxy trap. Every trap firing produces one `Rekording` emitted to your callback or stream.

```ts
type Rekording = {
  id: string;
  trap: string;
  origin: Origin;
  args: Array<Serialized>;
  result: Serialized;
  timestamp: number;
  location?: SourceLocation | null;
  stack?: Array<StackFrame>;
};
```

| Field | Type | Description |
|-------|------|-------------|
| `id` | `string` | Unique identifier for this record |
| `trap` | `string` | Reflect trap name (`get`, `set`, `apply`, etc.) |
| `origin` | `Origin` | How this proxy was created |
| `args` | `Array<Serialized>` | Arguments passed to the trap |
| `result` | `Serialized` | Return value from the trap |
| `timestamp` | `number` | When the trap fired |
| `location` | `SourceLocation \| null` | With the `location` option, on `apply` and `construct` records: where the called function is defined; `null` for native functions |
| `stack` | `Array<StackFrame>` | With the `stack` option: the call stack that made the trap fire, nearest frame first |

### `SourceLocation`
A position in a source file. `file` is a path in unix notation, relative to `process.cwd()` at the time it is recorded — or a name that is not a file, as Node.js reports it (`node:fs`, `''` for eval'd code). `line` and `column` are 1-based.

```ts
type SourceLocation = {
  file: string;
  line: number;
  column: number;
};
```

### `StackFrame`
One frame of a call stack: the position of the call, and the name of the function it is made from (`''` for anonymous functions and top-level code).

```ts
type StackFrame = SourceLocation & {
  function: string;
};
```

### `StackParser`
Reads one line of an `Error.stack` string as a `StackFrame`, or returns `undefined` for a line it does not understand. See [`registerStackParser`](#registerstackparserparser).

```ts
type StackParser = (line: string) => StackFrame | undefined;
```

### `Serialized`
Serialized recorded values can be:
- Primitives: `string`, `number`, `boolean`, `bigint`, `null`, `undefined`
- Proxy reference: `{ $proxy: string }` — a proxiable value known to the graph, referenced by ID
- Raw target reference: `{ $unwrap: { $proxy: string } }` — the real target behind a proxy, recorded when a native boundary crossing required unwrapping (see [`apply:native`](#native-boundary-crossings-and-applynative))
- Omitted value: `{ $omitted: string }` — with `values: false`, a value described without its contents: `null`, `Array<3>`, `Uint8Array<32>`, `number`, `object`, …
- Array of `Serialized`
- Plain object with `Serialized` values

```ts
type Serialized =
  | string | number | boolean | bigint | null | undefined
  | { readonly $proxy: string }
  | { readonly $unwrap: { readonly $proxy: string } }
  | { readonly $omitted: string }
  | Array<Serialized>
  | { [key: string]: Serialized };
```
