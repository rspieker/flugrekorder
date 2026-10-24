# Examples

Self-contained scenarios showing how flugrekorder fits into real work.

Each example is a standalone TypeScript file. Node.js 22.18 or later runs them directly after installing flugrekorder:

```sh
npm install flugrekorder
node examples/01-spy-without-setup.ts
```

---

## 01 — Spy without setup

**File:** [`01-spy-without-setup.ts`](01-spy-without-setup.ts)

**The problem:** you want to assert that your code calls the right methods on a dependency, with the right arguments — but spinning up a mock framework just to answer "was `execute()` called?" feels like overkill.

**The trick:** wrap the real dependency (or a lightweight stub) with `create`. The recordings give you a complete, ordered list of every method call that happened. No upfront ceremony; no return-value stubs unless you need them.

```ts
let spy!: typeof db;
const calls: Array<{ method: string; args: Array<unknown> }> = [];

spy = create(db, {
  only: ['get', 'apply'],
  callback(r) {
    if (r.trap !== 'apply' || !r.origin || !('source' in r.origin)) return;
    const fn = getProxyById(r.origin.source, spy);
    if (fn) calls.push({ method: getPath(fn), args: r.args[2] as Array<unknown> });
  },
});
```

`only: ['get', 'apply']` keeps the recording to what matters — property lookups that produce methods, and the calls themselves. `getPath` resolves the function proxy back to a readable name like `'execute'`.

**Output:**
```
Calls recorded:
  query("SELECT * FROM users WHERE id = ?", [1])
  execute("DELETE FROM users WHERE id = ?", [42])
All assertions passed.
```

---

## 02 — Mutation detective

**File:** [`02-mutation-detective.ts`](02-mutation-detective.ts)

**The problem:** a config or state object is being mutated somewhere in a large codebase and you can't find where. Adding `console.log` to every assignment is tedious and often misses indirect mutations through nested references.

**The trick:** wrap the object before passing it anywhere. Every `set` trap fires regardless of call depth. The recording includes the parent proxy ID, which you can resolve to a full dotted path via `getPath`.

```ts
tracked = create(config, {
  callback(r) {
    if (r.trap !== 'set' || !r.origin || !('parent' in r.origin)) return;
    const parent = getProxyById(r.origin.parent, tracked);
    const prefix = parent ? getPath(parent) : '';
    const path   = prefix ? `${prefix}.${r.origin.key}` : String(r.origin.key);
    mutations.push(`${path} = ${JSON.stringify(r.args[2])}`);
  },
});
```

No `only` filter here — you want the full picture, including nested gets that create the proxy chain used to resolve paths.

**Output:**
```
Mutations detected:
  db.port = 5433
  cache.ttl = 600
```

---

## 03 — API surface audit

**File:** [`03-api-surface-audit.ts`](03-api-surface-audit.ts)

**The problem:** you're upgrading a third-party library to a new major version. The changelog lists breaking changes, but you don't know which ones affect you because you don't know which fields of your options object the library actually reads.

**The trick:** wrap your options, pass the proxy, collect every `get` trap's key. Compare against the full set of keys you provide. Anything never touched is safe to drop or ignore in the new version.

```ts
const accessed = new Set<string>();

const tracked = create(options, {
  only: ['get'],
  callback(r) {
    if (r.origin && 'key' in r.origin) accessed.add(r.origin.key as string);
  },
});
```

**Output:**
```
Read by the library: [ 'baseUrl', 'timeout', 'retries' ]
Never touched: [ 'auth', 'debug', 'legacyMode' ]
```

Fields in "never touched" can be removed without consequence — or, if the new library version claims to use them, that's a signal the upgrade changes behaviour.

---

## 04 — HTTPS request interaction recorder

**File:** [`04-https-request-interaction.ts`](04-https-request-interaction.ts)

**The problem:** you want to know exactly which requests your code makes and what sequence of calls it performs on the resulting objects — without a mock server, without patching globals, without setup.

**The trick:** wrap the `https` module before passing it to your code. Every method call on the request object is recorded in order. The real network request runs untouched — you just get a transcript of what happened.

```ts
const client = create(https, {
  only: ['get', 'apply'],
  callback(r) {
    if (r.trap !== 'apply' || !r.origin || !('source' in r.origin)) return;
    const fn = getProxyById(r.origin.source, client);
    if (!fn) return;
    calls.push(`${getPath(fn)}(...)`);
  },
});
```

Note: flugrekorder records *everything*, including Node.js internals. The example filters to public API calls at depth ≤ 2 to keep the output readable — remove the filter to see the full picture.

**Output:**
```
Calls recorded:
  request("https://www.rammstein.de/en/history/reisereisealbum/")
  request().on("response", {})
  request().end()

HTTP 200 — 7085 bytes
```

---

## 06 — HTTP server lifecycle

**File:** [`06-http-server.ts`](06-http-server.ts)

**The problem:** you want to see what a Node.js HTTP server does across its entire lifetime — which methods fire, in what order, with what arguments — without touching any application code.

**The trick:** wrap the server itself instead of wrapping individual request objects. One proxy on `createServer()`'s return value covers the whole lifetime. `only: ['get', 'apply']` keeps the output to the two traps that matter: which functions are looked up (the wiring), and when they are called (the story). The request handler still receives the real `req` and `res` objects.

```ts
let server!: ReturnType<typeof createServer>;

server = create(makeServer(), {
  only: ['get', 'apply'],
  callback(r) {
    if (r.trap !== 'apply' || !r.origin || !('source' in r.origin)) return;
    const fn = getProxyById(r.origin.source, server);
    if (fn) console.log(format(r, server));
  },
});
```

**Output:**
```
emit(listening)
listen(3000, {})
emit(connection, {...})
emit(request, {"url":"/","method":"GET",...}, {"statusCode":200,...})
close()
emit(close)
```

`emit(listening)` appears before `listen(3000)` because it fires synchronously inside `listen()`'s execution, before the outer `listen` record is emitted. Swap `callback` for `stream` to write raw NDJSON to disk; each apply record carries `args[1]` as the server proxy and `args[2]` as the event payload.

---

## 05 — Fetch interaction recorder

**File:** [`05-fetch-interaction.ts`](05-fetch-interaction.ts)

**The problem:** you want to know exactly which URLs your code fetches — without a mock server, without patching globals, without setup. The URL used here also explains where the name "flugrekorder" comes from.

**The trick:** wrap the `fetch` function itself with `create`. Use `recursive: false` to keep recording at the call level; the `Response` is left unproxied so `ok`, `status`, `text()` and all body methods work exactly as normal.

```ts
const recordedFetch = create(fetch, {
  only: ['apply'],
  recursive: false,
  callback(r) {
    if (r.trap !== 'apply') return;
    const args = (r.args[2] as Array<unknown>)
      .filter(a => typeof a !== 'function')
      .map(a => JSON.stringify(a)).join(', ');
    calls.push(`fetch(${args})`);
  },
});
```

**Output:**
```
Calls recorded:
  fetch("https://www.rammstein.de/en/history/reisereisealbum/")

Page loaded: 7061 characters
```

---

## 07 — Memory spike hunter

**File:** [`07-memory-spike.ts`](07-memory-spike.ts)

**The problem:** a process downloads a large document and memory jumps from its baseline to the limit, then crashes. You need to know which call in the flow caused the jump — and the call that causes it never returns, so it never produces a record.

**The trick:** sample memory inside the callback, at two moments per call. Every method becomes its own `recursive: false` proxy whose `apply` record logs the growth of peak RSS — the *exit*. A `get` proxy on the module logs the method lookup that happens just before the call — the *enter*. Write with `writeSync` so the last line survives the crash.

```ts
(module as Record<string, unknown>)[key] = create(fn, {
  id,
  only: ['apply'],
  recursive: false,
  depth: 0,
  callback(r) {
    const { maxRSS } = process.resourceUsage();
    write({ id: r.id, exit: `${name}.${key}`, growth: Math.round((maxRSS - peak) / 1024) });
    peak = maxRSS;
  },
});
```

`recursive: false` keeps the 70MB payload out of the graph; proxying it would make the recorder the biggest consumer of memory. `depth: 0` keeps the record from serializing the payload or `this`.

**Output** (`memory.ndjson`, abridged):
```
{"id":"#13","exit":"processor.parse",...,"peak":523,"growth":85}
{"id":"#14","enter":"processor.normalise","rss":523}
{"id":"#15","exit":"processor.normalise","heap":234,...,"peak":736,"growth":213}
```

`heapUsed` went down during `normalise` while its peak grew by 213MB, so look at `growth`, not at heap deltas. Run it with `NODE_OPTIONS=--max-old-space-size=200` and the log ends at `enter processor.normalise`, which has no matching exit: that is the call that crashed the process.

---

## 08 — Frozen state dependencies

**File:** [`08-frozen-state.ts`](08-frozen-state.ts)

**The problem:** a view re-renders more often than it should. Its selector reads from a store whose state is deeply frozen — as Redux Toolkit does through Immer — and you want to know which parts of the state it actually depends on, so you can tell which updates should trigger it.

**The trick:** wrap the frozen state and collect the path of every property the selector reads. A frozen object would normally force a proxy to hand out its real values, ending the recording at the first level; flugrekorder wraps a stand-in instead (see [Stand-in targets](../README.md#stand-in-targets)), so nested reads through frozen objects are recorded like any other.

```ts
tracked = create(state, {
  only: ['get'],
  callback(r) {
    if (!r.origin || !('parent' in r.origin)) return;

    const parent = getProxyById(r.origin.parent, tracked);
    const owner = parent && getTarget(parent);

    // keep reads of the state's own data — not of methods like `filter`,
    // nor of the `Array` constructor that `filter` uses to create its result
    if (typeof owner !== 'object' || !Object.hasOwn(owner, r.origin.key))
      return;

    const prefix = getPath(parent);

    reads.add(general(prefix ? `${prefix}.${r.origin.key}` : r.origin.key));
  },
});
```

`general` folds array indices into `[n]`: which item was read matters less than what was read from it. Comparing the reads against every path in the state gives what the selector never touches.

**Output:**
```
[ 'document frozen state', 'release next version' ]
Read by the selector: [
  'todos',
  'todos.length',
  'todos[n]',
  'filter',
  'todos[n].done',
  'todos[n].title'
]
Never read: [ 'todos[n].id', 'todos[n].tags', 'user' ]
```

Updates to `user`, or to a todo's `id` or `tags`, can't change what this selector returns — a view depending on it alone doesn't need to re-render for them. `todos.length` is a dependency too: adding or removing a todo always matters.
