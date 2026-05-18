# Examples

Three self-contained scenarios showing how flugrekorder fits into real work.

Each example is a standalone TypeScript file. Run them with `tsx` or any TypeScript runner after installing flugrekorder:

```sh
npm install flugrekorder
npx tsx examples/01-spy-without-setup.ts
```

---

## 01 — Spy without setup

**File:** [`01-spy-without-setup.ts`](01-spy-without-setup.ts)

**The problem:** you want to assert that your code calls the right methods on a dependency, with the right arguments — but spinning up a mock framework just to answer "was `execute()` called?" feels like overkill.

**The trick:** wrap the real dependency (or a lightweight stub) with `create`. The recordings give you a complete, ordered list of every method call that happened. No upfront ceremony; no return-value stubs unless you need them.

```ts
let spy!: typeof db;
const calls: Array<{ method: string; args: unknown[] }> = [];

spy = create(db, {
  only: ['get', 'apply'],
  callback(r) {
    if (r.trap !== 'apply' || !r.origin || !('source' in r.origin)) return;
    const fn = getProxyById(r.origin.source, spy);
    if (fn) calls.push({ method: getPath(fn), args: r.args[2] as unknown[] });
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
