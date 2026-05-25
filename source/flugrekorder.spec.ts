import { test } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import * as flugrekorder from './flugrekorder';
import {
	create,
	getAncestors,
	getOrigin,
	getPath,
	getProxyById,
	getTarget,
	isFlugrekorder,
	type Rekording,
} from './flugrekorder';

// biome-ignore lint/suspicious/noExplicitAny: Improbability is the intentional escape hatch for test assertions that cannot be typed otherwise
type Improbability = any;

// ─── Arbitraries ──────────────────────────────────────────────────────────────

const safeKey = fc
	.string({ minLength: 1, maxLength: 20 })
	.filter((k) => !['__proto__', 'constructor', 'prototype'].includes(k));

const primitive = fc.oneof(
	fc.string(),
	fc.integer(),
	fc.double({ noNaN: true }),
	fc.boolean(),
);

// ─── Export surface ───────────────────────────────────────────────────────────

test('module exports exactly the expected public API', () => {
	const expected = [
		'create',
		'isFlugrekorder',
		'isProxiable',
		'format',
		'getAncestors',
		'getOrigin',
		'getPath',
		'getProxyById',
		'getTarget',
	] as const;

	for (const name of expected) {
		assert.strictEqual(
			typeof flugrekorder[name],
			'function',
			`${name} is exported as a function`,
		);
	}

	const unexpected = Object.keys(flugrekorder).filter(
		(k) => !(expected as readonly string[]).includes(k),
	);
	assert.strictEqual(unexpected.length, 0, `unexpected exports: ${unexpected.join(', ')}`);
});

// ─── Core proxy behaviour ─────────────────────────────────────────────────────

test('traps with no origin mapping (e.g. has) emit a rekording with null origin', () => {
	const records: Rekording[] = [];
	const p = create({ x: 1 }, { callback: (r) => records.push(r) });

	'x' in p;

	const rec = records.find((r) => r.trap === 'has');
	assert.ok(rec, 'has record emitted');
	assert.strictEqual(rec?.origin, null, 'origin is null for traps outside the origin mapping');
});

test('primitives are returned unchanged through get', () => {
	const p = create({ n: 42, s: 'hi', b: true }, { callback: () => {} });

	assert.strictEqual(p.n, 42, 'number');
	assert.strictEqual(p.s, 'hi', 'string');
	assert.strictEqual(p.b, true, 'boolean');
});

test('primitives are returned unchanged through get (property)', () => {
	fc.assert(
		fc.property(safeKey, primitive, (key, value) => {
			const target: Record<string, unknown> = { [key]: value };
			const p = create(target, { callback: () => {} });
			return (p as Improbability)[key] === value;
		}),
	);
});

test('get trap emits one rekording per property access', () => {
	const records: Rekording[] = [];
	const p = create({ a: 1, b: 2 }, { callback: (r) => records.push(r) });

	p.a;
	p.b;

	assert.strictEqual(
		records.filter((r) => r.trap === 'get').length,
		2,
		'two get records',
	);
});

test('get trap emits exactly one record per access for any key (property)', () => {
	fc.assert(
		fc.property(safeKey, fc.integer(), (key, value) => {
			const records: Rekording[] = [];
			const target: Record<string, unknown> = { [key]: value };
			const p = create(target, { callback: (r) => records.push(r) });
			(p as Improbability)[key];
			return records.filter(
				(r) =>
					r.trap === 'get' &&
					r.origin !== null &&
					'key' in r.origin &&
					r.origin.key === key,
			).length === 1;
		}),
	);
});

test('set trap emits a rekording and mutates the underlying value', () => {
	const records: Rekording[] = [];
	const target: { a: number } = { a: 1 };
	const p = create(target, { callback: (r) => records.push(r) });

	p.a = 99;

	const rec = records.find(
		(r) =>
			r.trap === 'set' &&
			r.origin !== null &&
			'key' in r.origin &&
			r.origin.key === 'a',
	);
	assert.ok(rec, 'set record emitted');
	assert.strictEqual(target.a, 99, 'underlying value mutated');
});

test('set trap propagates any primitive value to the underlying target (property)', () => {
	fc.assert(
		fc.property(safeKey, primitive, (key, value) => {
			const target: Record<string, unknown> = {};
			const p = create(target, { callback: () => {} });
			(p as Improbability)[key] = value;
			return target[key] === value;
		}),
	);
});

test('apply trap emits a rekording and returns the correct value', () => {
	const records: Rekording[] = [];
	const p = create(
		{ double: (n: number) => n * 2 },
		{ callback: (r) => records.push(r) },
	);

	assert.strictEqual(p.double(5), 10, 'return value is correct');
	assert.ok(
		records.some((r) => r.trap === 'apply'),
		'apply record emitted',
	);
});

test('construct trap emits a rekording and returns an instance', () => {
	const records: Rekording[] = [];
	class Counter {
		count = 0;
	}
	const p = create(Counter, { callback: (r) => records.push(r) });

	const instance = new p();

	assert.ok(
		records.some((r) => r.trap === 'construct'),
		'construct record emitted',
	);
	assert.strictEqual(instance.count, 0, 'instance has correct initial state');
});

test('returned proxiable values are themselves proxied', () => {
	const records: Rekording[] = [];
	const p = create(
		{ nested: { x: 1 } },
		{ callback: (r) => records.push(r) },
	);
	const nested = p.nested;
	const before = records.length;

	nested.x;

	assert.ok(
		records.length > before,
		'accessing a property on a returned nested proxy emits further records',
	);
});

test('proxy stability: the same underlying object always returns the same proxy', () => {
	const shared = { v: 1 };
	const p = create({ a: shared, b: shared }, { callback: () => {} });

	assert.strictEqual(p.a, p.b, 'both references return the identical proxy instance');
});

test('proxy stability: holds for any object (property)', () => {
	fc.assert(
		fc.property(fc.object({ maxDepth: 1 }), (target) => {
			const p = create(target, { callback: () => {} });
			const q = create(p, { callback: () => {} });
			return p === q;
		}),
	);
});

test('a known target passed as a call argument is proxied, so interactions on it are recorded', () => {
	const records: Rekording[] = [];
	const child = { x: 42 };
	const target = {
		child,
		fn: (obj: typeof child) => obj.x,
	};
	const p = create(target, { callback: (r) => records.push(r) });
	p.child; // registers child in the graph
	const before = records.length;

	p.fn(child); // passes raw target — known() should return its proxy

	const xAccess = records
		.slice(before)
		.find(
			(r) =>
				r.trap === 'get' &&
				r.origin !== null &&
				'key' in r.origin &&
				r.origin.key === 'x',
		);
	assert.ok(xAccess, 'get trap for x fires when known target is passed as argument');
});

test('no recursion when a method mutates this', () => {
	const target = {
		c: 0,
		inc() {
			return ++this.c;
		},
	};
	const p = create(target, { callback: () => {} });

	assert.strictEqual(p.inc(), 1, 'returns 1');
	assert.strictEqual(target.c, 1, 'underlying counter incremented');
});

test('a known proxy passed back through a trap is not double-wrapped', () => {
	const target = {
		getSelf(): Improbability {
			return this;
		},
	};
	const p = create(target, { callback: () => {} });

	assert.strictEqual(p.getSelf(), p, 'getSelf() returns the same proxy instance');
});

test('arrays are proxied and elements remain accessible', () => {
	const p = create({ arr: [10, 20, 30] }, { callback: () => {} });
	const arr = p.arr;

	assert.strictEqual(arr[0], 10, 'first element');
	assert.strictEqual(arr[2], 30, 'last element');
	assert.strictEqual(arr.length, 3, 'length');
});

test('prototype access is not wrapped and does not violate proxy invariants', () => {
	class Foo {
		bar() {
			return 1;
		}
	}
	const p = create(new Foo(), { callback: () => {} });

	assert.doesNotThrow(() => p.bar(), 'calling a prototype method does not throw');
});

test('instanceof still works after proxying', () => {
	class Foo {}
	const original = new Foo();
	const p = create(original, { callback: () => {} });

	assert.ok(p instanceof Foo, 'instanceof Foo is preserved on the proxy');
});

test('create() called with an already-proxied target returns it unchanged', () => {
	const original = { x: 1 };
	const p1 = create(original, { callback: () => {} });
	const p2 = create(p1, { callback: () => {} });

	assert.strictEqual(p2, p1, 'returns the existing proxy, not a new wrapper');
});

// ─── isFlugrekorder ───────────────────────────────────────────────────────────

test('isFlugrekorder returns true for a proxy created by create()', () => {
	const p = create({ x: 1 }, { callback: () => {} });

	assert.ok(isFlugrekorder(p), 'root proxy is recognised');
});

test('isFlugrekorder returns true for a child proxy', () => {
	const p = create({ a: { v: 1 } }, { callback: () => {} });

	assert.ok(isFlugrekorder(p.a), 'child proxy is recognised');
});

test('isFlugrekorder returns false for plain objects and primitives', () => {
	assert.strictEqual(isFlugrekorder({}), false, 'plain object');
	assert.strictEqual(isFlugrekorder(42), false, 'number');
	assert.strictEqual(isFlugrekorder(null), false, 'null');
	assert.strictEqual(isFlugrekorder('hi'), false, 'string');
});

test('isFlugrekorder returns true for any proxied object (property)', () => {
	fc.assert(
		fc.property(fc.object({ maxDepth: 1 }), (target) => {
			return isFlugrekorder(create(target, { callback: () => {} }));
		}),
	);
});

test('isFlugrekorder returns false for any primitive (property)', () => {
	fc.assert(
		fc.property(primitive, (value) => !isFlugrekorder(value)),
	);
});

// ─── recursive option ─────────────────────────────────────────────────────────

test('recursive: true (default) proxies nested values', () => {
	const records: Rekording[] = [];
	const p = create({ a: { b: 1 } }, { callback: (r) => records.push(r) });
	const a = p.a;
	const before = records.length;

	a.b;

	assert.ok(records.length > before, 'nested access emits additional records');
});

test('recursive: false does not proxy values returned from traps', () => {
	const p = create(
		{ a: { b: 1 } },
		{ callback: () => {}, recursive: false },
	);

	assert.strictEqual(isFlugrekorder(p.a), false, 'returned nested value is not a proxy');
});

test('recursive: false still emits records for the root proxy', () => {
	const records: Rekording[] = [];
	const p = create(
		{ x: 1 },
		{ callback: (r) => records.push(r), recursive: false },
	);

	p.x;

	assert.ok(
		records.some((r) => r.trap === 'get'),
		'get record still emitted on root',
	);
});

// ─── only option ──────────────────────────────────────────────────────────────

test('only: restricts which traps emit records', () => {
	const records: Rekording[] = [];
	const target: { a: number } = { a: 1 };
	const p = create(target, { callback: (r) => records.push(r), only: ['get'] });

	p.a;
	p.a = 99;

	assert.ok(records.every((r) => r.trap === 'get'), 'only get records emitted');
	assert.strictEqual(
		records.some((r) => r.trap === 'set'),
		false,
		'no set records emitted',
	);
});

test('only: traps not in the list still execute correctly (pass-through)', () => {
	const target: { a: number } = { a: 1 };
	const p = create(target, { callback: () => {}, only: ['get'] });

	p.a = 99;

	assert.strictEqual(
		target.a,
		99,
		'set passes through and mutates target even when not recorded',
	);
});

test('only: apply and get can be combined', () => {
	const records: Rekording[] = [];
	const p = create(
		{ fn: () => 'hi' },
		{ callback: (r) => records.push(r), only: ['get', 'apply'] },
	);

	p.fn();

	const traps = new Set(records.map((r) => r.trap));
	assert.ok(traps.has('get'), 'get recorded');
	assert.ok(traps.has('apply'), 'apply recorded');
	assert.strictEqual(traps.size, 2, 'no other traps recorded');
});

// ─── filter option ────────────────────────────────────────────────────────────

test('filter: returning false suppresses the record', () => {
	const records: Rekording[] = [];
	const p = create(
		{ port: 3000 },
		{ callback: (r) => records.push(r), filter: () => false },
	);

	p.port;

	assert.strictEqual(records.length, 0, 'no records emitted');
});

test('filter: returning true passes the record through', () => {
	const records: Rekording[] = [];
	const p = create(
		{ port: 3000 },
		{ callback: (r) => records.push(r), filter: () => true },
	);

	p.port;

	assert.strictEqual(records.length, 1, 'record emitted');
});

test('filter: can select by trap type', () => {
	const records: Rekording[] = [];
	const p = create(
		{ port: 3000 },
		{ callback: (r) => records.push(r), filter: (r) => r.trap === 'set' },
	);

	p.port;
	p.port = 9999;

	assert.strictEqual(records.length, 1, 'only set record emitted');
	assert.strictEqual(records[0].trap, 'set');
});

test('filter: composes with only — both must pass', () => {
	const records: Rekording[] = [];
	const p = create(
		{ port: 3000 },
		{
			callback: (r) => records.push(r),
			only: ['get', 'set'],
			filter: (r) => r.trap === 'set',
		},
	);

	p.port;
	p.port = 9999;

	assert.strictEqual(records.length, 1, 'only set passes both only and filter');
	assert.strictEqual(records[0].trap, 'set');
});

test('filter: omitting filter emits all records', () => {
	const records: Rekording[] = [];
	const p = create({ port: 3000 }, { callback: (r) => records.push(r) });

	p.port;
	p.port = 9999;

	const traps = records.map((r) => r.trap);
	assert.ok(traps.includes('get'), 'get emitted');
	assert.ok(traps.includes('set'), 'set emitted');
});

// ─── id option ────────────────────────────────────────────────────────────────

test('id: numeric starting value offsets the sequence', () => {
	const records: Rekording[] = [];
	const p = create({ x: 1 }, { callback: (r) => records.push(r), id: 100 });

	p.x;

	assert.ok(records[0].id.startsWith('#'), 'ID has # prefix');
	const n = parseInt(records[0].id.slice(1), 10);
	assert.ok(n > 100, 'ID is greater than the starting value');
});

test('id: custom generator function is used', () => {
	const records: Rekording[] = [];
	let seq = 0;
	const p = create(
		{ x: 1 },
		{ callback: (r) => records.push(r), id: () => `evt-${++seq}` },
	);

	p.x;

	assert.ok(records[0].id.startsWith('evt-'), 'custom ID format used');
});

// ─── getOrigin ────────────────────────────────────────────────────────────────

test('getOrigin returns null for the root proxy', () => {
	const p = create({ x: 1 }, { callback: () => {} });

	assert.strictEqual(getOrigin(p), null, 'root origin is null');
});

test('getOrigin returns a structured origin for a property-access proxy', () => {
	const p = create({ a: { v: 1 } }, { callback: () => {} });
	const a = p.a;
	const origin = getOrigin(a);

	assert.ok(origin !== null, 'origin is not null');
	assert.strictEqual(origin?.trap, 'get');
	assert.ok(origin && 'key' in origin, 'origin has a key field');
	assert.strictEqual(String((origin as { key: string | symbol }).key), 'a');
});

test('getOrigin for a function-return proxy has trap=apply and a source ID', () => {
	const p = create({ fn: () => ({ v: 1 }) }, { callback: () => {} });
	const result = p.fn();
	const origin = getOrigin(result);

	assert.ok(origin !== null, 'origin is not null');
	assert.strictEqual(origin?.trap, 'apply');
	assert.ok(origin && 'source' in origin, 'origin has a source field');
	assert.strictEqual(
		typeof (origin as { source: string }).source,
		'string',
		'source is a string proxy ID',
	);
});

// ─── getAncestors ─────────────────────────────────────────────────────────────

test('getAncestors returns the full chain root-first', () => {
	const p = create({ a: { b: { c: 1 } } }, { callback: () => {} });
	const b = p.a.b;
	const ancestors = getAncestors(b);

	assert.strictEqual(ancestors.length, 3, 'root + a + b = 3 entries');
	assert.strictEqual(ancestors[0].origin, null, 'root entry has null origin');
	assert.strictEqual(
		ancestors[1].origin !== null && 'key' in ancestors[1].origin
			? String((ancestors[1].origin as { key: string | symbol }).key)
			: null,
		'a',
	);
	assert.strictEqual(
		ancestors[2].origin !== null && 'key' in ancestors[2].origin
			? String((ancestors[2].origin as { key: string | symbol }).key)
			: null,
		'b',
	);
});

test('getAncestors returns an empty array for a non-proxy', () => {
	assert.deepStrictEqual(getAncestors({ x: 1 }), [], 'plain object returns empty array');
});

// ─── getPath ─────────────────────────────────────────────────────────────────

test('getPath returns a dotted property path', () => {
	const p = create({ a: { b: { fn: () => 'x' } } }, { callback: () => {} });

	assert.strictEqual(getPath(p.a.b.fn), 'a.b.fn');
});

test('getPath annotates a function-return value with ()', () => {
	const p = create(
		{ a: { b: { make: () => ({ v: 1 }) } } },
		{ callback: () => {} },
	);

	assert.strictEqual(getPath(p.a.b.make()), 'a.b.make()');
});

test('getPath for the root proxy is an empty string', () => {
	const p = create({ x: 1 }, { callback: () => {} });

	assert.strictEqual(getPath(p), '');
});

test('getPath on a directly-called root function produces ()', () => {
	const fn = create(() => ({ v: 1 }), { callback: () => {} });
	const result = fn();

	assert.strictEqual(getPath(result), '()');
});

// ─── getTarget ────────────────────────────────────────────────────────────────

test('getTarget returns the original unwrapped object', () => {
	const target = { x: 1 };
	const p = create(target, { callback: () => {} });

	assert.strictEqual(getTarget(p), target, 'returns the original target');
});

test('getTarget returns null for a non-proxy', () => {
	assert.strictEqual(getTarget({ x: 1 }), null, 'plain object returns null');
});

// ─── getProxyById ─────────────────────────────────────────────────────────────

test('getProxyById retrieves a proxy by its recorded ID', () => {
	const records: Rekording[] = [];
	const p = create({ a: { v: 1 } }, { callback: (r) => records.push(r) });

	p.a;

	const rec = records.find((r) => r.trap === 'get');
	const id = (rec?.result as { $proxy: string })?.$proxy;
	assert.ok(id, 'a $proxy ID was recorded');
	const retrieved = getProxyById(id, p);
	assert.ok(isFlugrekorder(retrieved), 'retrieved value is a proxy');
	assert.strictEqual(retrieved, p.a, 'retrieved proxy is the same instance as p.a');
});

test('getProxyById returns undefined for an unknown ID', () => {
	const p = create({ x: 1 }, { callback: () => {} });

	assert.strictEqual(
		getProxyById('no-such-id', p),
		undefined,
		'unknown ID returns undefined',
	);
});
