# Migrating from 1.x to 2.0

Most code that uses flugrekorder 1.x runs on 2.0 unchanged. What changed is mostly what gets recorded: values that used to throw or slip past the recorder are now proxied and recorded, and `only` no longer decides how far the recorder reaches.

| If your code… | Then |
|---|---|
| runs on Node.js older than 22.18 | upgrade Node.js — [Requirements](#requirements-and-packaging) |
| uses `only` | check what it records now — [`only`](#only-chooses-records-not-how-far-the-recorder-reaches) |
| keeps record IDs to look proxies up later | expect `undefined` once the object is gone — [Sessions](#a-session-no-longer-keeps-objects-alive) |
| reads `getAncestors()` steps | each step gained an `id`, and `proxy` can be `undefined` — [Sessions](#a-session-no-longer-keeps-objects-alive) |
| reads `origin` or `format()` output of `has`, `deleteProperty`, `getPrototypeOf` or `setPrototypeOf` records | see [Records](#records) |
| narrows `Serialized` exhaustively | add `{ $omitted }` — [Types](#types) |
| passes both `stream` and `callback` | pick one — [Types](#types) |
| records binary data, frozen objects, or Node.js and browser built-ins | expect more, and different, records — [Values that used to fail](#values-that-used-to-fail) |

---

## Requirements and packaging

- **Node.js 22.18 or later** (1.x: 22). flugrekorder 2.0 runs on Node.js 22, 24 and 26.
- **The package is an ES module.** `dist/flugrekorder.js` is ESM, and there is no separate CommonJS build any more (1.x shipped `flugrekorder.js` as CommonJS and `flugrekorder.mjs` as ESM).
  - `import { create } from 'flugrekorder'` works as before.
  - `require('flugrekorder')` keeps working: Node.js 22.12 and later can `require()` an ES module.
  - Paths into `dist/` were never part of the package's `exports`, so no import can have depended on them.
- **The browser bundle** is still `dist/flugrekorder.global.js`, exposing a global `Flugrekorder`.

---

## `only` chooses records, not how far the recorder reaches

In 1.x, a trap left out of `only` was relayed raw: its result was not proxied. So `only` decided two things at once — which traps produce a record, and which values the recorder ever sees. In 2.0 it decides only the first. Every trap proxies its result and handles native boundaries; a trap left out of `only` just skips the record (no ID, no serialization, no `location` or `stack`).

```ts
const p = create(api, { only: ['apply'], callback });
p.util.decode('…');
```

| | 1.x | 2.0 |
|---|---|---|
| records | none — `p.util` came back as the real object, so the call was never seen | one `apply` record for `util.decode(…)` |

**What to change:**

- **`only: ['get', 'apply']` with a callback or `filter` that ignores the `get` records** — the usual way to see nested calls in 1.x. Use `only: ['apply']`: the same `apply` records, without building the `get` records first. That is about twice as fast, and around five times as fast with `stack`.
- **`only` used to keep the recorder out of part of an application** — for example, objects created with `new` on a proxied class stayed raw when `construct` was left out, so an HTTP request handler received the real `req` and `res`. Those values are proxied now, exactly as they always were without `only`. To proxy nothing but the root, use `recursive: false`.
- **Native methods** — with `apply` left out of `only`, 1.x skipped the retries that make host methods work through a proxy (`TextEncoder`, `URL`, …), so those calls threw. They work in 2.0, whatever `only` lists.

---

## A session no longer keeps objects alive

In 1.x, a session held every proxy it had created, by ID, for as long as the session existed: in a long-running process, everything that passed through the recorder stayed in memory. In 2.0 a proxy lives exactly as long as the object behind it. See [One graph per session](README.md#one-graph-per-session).

- **`getProxyById(id, proxy)`** returns `undefined` once the object behind the ID has been collected. Resolve IDs while the object is still in use, typically inside the callback.
- **`getAncestors(proxy)`** steps are `{ id, proxy, origin }` (1.x: `{ proxy, origin }`), and `proxy` is `undefined` for an ancestor that has been collected. The chain itself — and `getPath` — stay complete.

```ts
// 1.x
type Step = { proxy: Proxiable; origin: Origin };
// 2.0
type Step = { id: string; proxy: Proxiable | undefined; origin: Origin };
```

---

## Records

- **`has` and `deleteProperty` name their key.** Their records carry a property origin, `{ trap, parent, key }`, instead of `null`, and `PropertyTrap` includes both. `format()` shows `has port` instead of `has on #4`.
- **`getPrototypeOf` and `setPrototypeOf` have no origin.** In 1.x they got a property origin with a key that was not one (`"undefined"`, or the new prototype converted to a string). With a proxy as the new prototype, that conversion also produced records of `get` and `apply` calls the application never made. Their `origin` is now `null`, like `ownKeys`, and `format()` shows `getPrototypeOf on #3` instead of `getPrototypeOf undefined`.
- **IDs are numbered differently.** Values that 1.x relayed raw are proxies now, and every proxy takes an ID. IDs remain unique within a session, but do not compare them with recordings made by 1.x.
- **New trap names** can appear: `apply:native` for host methods in Firefox and Safari, and for Node.js classes such as `URLSearchParams`, which threw through a proxy in 1.x. See [Native boundary crossings](README.md#native-boundary-crossings-applynative-applystructure-applyprivate).

---

## Values that used to fail

- **Frozen and read-only values are proxied and recorded.** In 1.x, reading a non-configurable, read-only property through a proxy — anything on a frozen object, a class `prototype`, the getters TypeScript emits for re-exports — threw a `TypeError` into the application. One case is refused instead of recorded; see [Stand-in targets](README.md#stand-in-targets).
- **Binary data is passed on unwrapped.** An `ArrayBuffer`, typed array or `DataView` reached through a proxy is now the real object, so the built-ins that read its bytes work (`new Uint8Array(buffer)`, `TextDecoder`, `crypto`, `structuredClone`). Reading the property that holds it is still recorded; reading its bytes is not. A root `create(buffer)` is still proxied.
- **Built-ins behave through a proxy in every engine.** `Map`, `Set`, `Date`, typed arrays and classes with `#private` members threw in Firefox and Safari; they work in all three browser engines and in Node.js.

---

## Types

- **`Serialized`** has one more member, `{ readonly $omitted: string }`, which only appears with `values: false`. Code that narrows `Serialized` exhaustively needs a branch for it.
- **`CreateOptions`** — `stream` and `callback` exclude each other. 1.x accepted both and silently ignored `callback`; 2.0 reports it as a type error. A `stream` that is `undefined` now means "use the callback"; 1.x threw on the first trap.
- **`PropertyTrap`** includes `has` and `deleteProperty`.
- **`getAncestors`** returns `Array<{ id: string; proxy: Proxiable | undefined; origin: Origin }>`.

---

## New in 2.0

Nothing to migrate, but worth knowing:

- **`location` and `stack`** — where a called function is defined, and the call stack that made a trap fire. `getLocation(proxy)` for a function proxy, and `registerStackParser` for stack formats of other engines. See [Where code lives](README.md#where-code-lives-location-and-stack).
- **`values: false`** — records keep their structure, and every value becomes `{ $omitted: kind }`: `number`, `Array<3>`, `Uint8Array<32>`, … Nothing is serialized, and no value can end up in a record.
- **Browsers** — tested in Chromium, Firefox and WebKit.
