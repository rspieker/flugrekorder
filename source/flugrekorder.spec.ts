import { Writable } from 'node:stream';
import test from 'tape';
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

// ─── Helpers ──────────────────────────────────────────────────────────────────

const isProxyTag = (v: unknown): v is { $proxy: string } =>
	typeof v === 'object' &&
	v !== null &&
	!Array.isArray(v) &&
	'$proxy' in (v as object);

function makeStream() {
	const lines: string[] = [];
	let buf = '';
	const stream = new Writable({
		write(chunk: Buffer, _enc, cb) {
			buf += chunk.toString();
			const parts = buf.split('\n');
			buf = parts.pop() ?? '';
			lines.push(...parts.filter(Boolean));
			cb();
		},
	});
	return { stream, lines };
}

// ─── Core proxy behaviour ─────────────────────────────────────────────────────

test('primitives are returned unchanged through get', (t) => {
	const p = create({ n: 42, s: 'hi', b: true }, { callback: () => {} });
	t.equal(p.n, 42, 'number');
	t.equal(p.s, 'hi', 'string');
	t.equal(p.b, true, 'boolean');
	t.end();
});

test('get trap emits one rekording per property access', (t) => {
	const records: Rekording[] = [];
	const p = create({ a: 1, b: 2 }, { callback: (r) => records.push(r) });
	p.a;
	p.b;
	t.equal(
		records.filter((r) => r.trap === 'get').length,
		2,
		'two get records',
	);
	t.end();
});

test('set trap emits a rekording and mutates the underlying value', (t) => {
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
	t.ok(rec, 'set record emitted');
	t.equal(target.a, 99, 'underlying value mutated');
	t.end();
});

test('apply trap emits a rekording and returns the correct value', (t) => {
	const records: Rekording[] = [];
	const p = create(
		{ double: (n: number) => n * 2 },
		{ callback: (r) => records.push(r) },
	);
	t.equal(p.double(5), 10, 'return value is correct');
	t.ok(
		records.some((r) => r.trap === 'apply'),
		'apply record emitted',
	);
	t.end();
});

test('construct trap emits a rekording and returns an instance', (t) => {
	const records: Rekording[] = [];
	class Counter {
		count = 0;
	}
	const p = create(Counter, { callback: (r) => records.push(r) });
	const instance = new p();
	t.ok(
		records.some((r) => r.trap === 'construct'),
		'construct record emitted',
	);
	t.equal(instance.count, 0, 'instance has correct initial state');
	t.end();
});

test('returned proxiable values are themselves proxied', (t) => {
	const records: Rekording[] = [];
	const p = create(
		{ nested: { x: 1 } },
		{ callback: (r) => records.push(r) },
	);
	const nested = p.nested;
	const before = records.length;
	nested.x;
	t.ok(
		records.length > before,
		'accessing a property on a returned nested proxy emits further records',
	);
	t.end();
});

test('proxy stability: the same underlying object always returns the same proxy', (t) => {
	const shared = { v: 1 };
	const p = create({ a: shared, b: shared }, { callback: () => {} });
	t.equal(p.a, p.b, 'both references return the identical proxy instance');
	t.end();
});

test('no recursion when a method mutates this', (t) => {
	const records: Rekording[] = [];
	const target = {
		c: 0,
		inc() {
			return ++this.c;
		},
	};
	const p = create(target, { callback: (r) => records.push(r) });
	t.doesNotThrow(() => {
		t.equal(p.inc(), 1, 'returns 1');
		t.equal(target.c, 1, 'underlying counter incremented');
	}, 'method that uses this does not cause infinite recursion');
	t.end();
});

test('a known proxy passed back through a trap is not double-wrapped', (t) => {
	const target = {
		getSelf(): Improbability {
			return this;
		},
	};
	const p = create(target, { callback: () => {} });
	t.equal(p.getSelf(), p, 'getSelf() returns the same proxy instance');
	t.end();
});

test('arrays are proxied and elements remain accessible', (t) => {
	const p = create({ arr: [10, 20, 30] }, { callback: () => {} });
	const arr = p.arr;
	t.equal(arr[0], 10, 'first element');
	t.equal(arr[2], 30, 'last element');
	t.equal(arr.length, 3, 'length');
	t.end();
});

test('prototype access is not wrapped and does not violate proxy invariants', (t) => {
	class Foo {
		bar() {
			return 1;
		}
	}
	const p = create(new Foo(), { callback: () => {} });
	t.doesNotThrow(() => p.bar(), 'calling a prototype method does not throw');
	t.end();
});

test('instanceof still works after proxying', (t) => {
	class Foo {}
	const original = new Foo();
	const p = create(original, { callback: () => {} });
	t.ok(p instanceof Foo, 'instanceof Foo is preserved on the proxy');
	t.end();
});

// ─── isFlugrekorder ──────────────────────────────────────────────────────

test('isFlugrekorder returns true for a proxy created by create()', (t) => {
	const p = create({ x: 1 }, { callback: () => {} });
	t.ok(isFlugrekorder(p), 'root proxy is recognised');
	t.end();
});

test('isFlugrekorder returns true for a child proxy', (t) => {
	const p = create({ a: { v: 1 } }, { callback: () => {} });
	t.ok(isFlugrekorder(p.a), 'child proxy is recognised');
	t.end();
});

test('isFlugrekorder returns false for plain objects and primitives', (t) => {
	t.notOk(isFlugrekorder({}), 'plain object');
	t.notOk(isFlugrekorder(42), 'number');
	t.notOk(isFlugrekorder(null), 'null');
	t.notOk(isFlugrekorder('hi'), 'string');
	t.end();
});

// ─── recursive option ────────────────────────────────────────────────────────

test('recursive: true (default) proxies nested values', (t) => {
	const records: Rekording[] = [];
	const p = create({ a: { b: 1 } }, { callback: (r) => records.push(r) });
	const a = p.a;
	const before = records.length;
	a.b;
	t.ok(records.length > before, 'nested access emits additional records');
	t.end();
});

test('recursive: false does not proxy values returned from traps', (t) => {
	const records: Rekording[] = [];
	const p = create(
		{ a: { b: 1 } },
		{ callback: (r) => records.push(r), recursive: false },
	);
	const a = p.a;
	t.notOk(isFlugrekorder(a), 'returned nested value is not a proxy');
	t.end();
});

test('recursive: false still emits records for the root proxy', (t) => {
	const records: Rekording[] = [];
	const p = create(
		{ x: 1 },
		{ callback: (r) => records.push(r), recursive: false },
	);
	p.x;
	t.ok(
		records.some((r) => r.trap === 'get'),
		'get record still emitted on root',
	);
	t.end();
});

// ─── only option ─────────────────────────────────────────────────────────────

test('only: restricts which traps emit records', (t) => {
	const records: Rekording[] = [];
	const target: { a: number } = { a: 1 };
	const p = create(target, {
		callback: (r) => records.push(r),
		only: ['get'],
	});
	p.a;
	p.a = 99;
	t.ok(
		records.every((r) => r.trap === 'get'),
		'only get records emitted',
	);
	t.notOk(
		records.some((r) => r.trap === 'set'),
		'no set records emitted',
	);
	t.end();
});

test('only: traps not in the list still execute correctly (pass-through)', (t) => {
	const target: { a: number } = { a: 1 };
	const p = create(target, {
		callback: () => {},
		only: ['get'],
	});
	p.a = 99;
	t.equal(
		target.a,
		99,
		'set passes through and mutates target even when not recorded',
	);
	t.end();
});

test('only: apply and get can be combined', (t) => {
	const records: Rekording[] = [];
	const p = create(
		{ fn: () => 'hi' },
		{ callback: (r) => records.push(r), only: ['get', 'apply'] },
	);
	p.fn();
	const traps = new Set(records.map((r) => r.trap));
	t.ok(traps.has('get'), 'get recorded');
	t.ok(traps.has('apply'), 'apply recorded');
	t.equal(traps.size, 2, 'no other traps recorded');
	t.end();
});

// ─── Serialisation ────────────────────────────────────────────────────────────

test('proxiable results are serialised as $proxy tags', (t) => {
	const records: Rekording[] = [];
	const p = create({ obj: { v: 1 } }, { callback: (r) => records.push(r) });
	p.obj;
	const rec = records.find(
		(r) =>
			r.trap === 'get' &&
			r.origin !== null &&
			'key' in r.origin &&
			r.origin.key === 'obj',
	);
	t.ok(rec, 'get record found');
	t.ok(isProxyTag(rec?.result), 'result is a $proxy tag');
	t.equal(
		typeof (rec?.result as { $proxy: string }).$proxy,
		'string',
		'$proxy is a string',
	);
	t.end();
});

test('primitive results are inlined in the rekording', (t) => {
	const records: Rekording[] = [];
	const p = create({ n: 7 }, { callback: (r) => records.push(r) });
	p.n;
	const rec = records.find(
		(r) =>
			r.trap === 'get' &&
			r.origin !== null &&
			'key' in r.origin &&
			r.origin.key === 'n',
	);
	t.ok(rec, 'get record found');
	t.equal(rec?.result, 7, 'primitive result is inlined');
	t.end();
});

test('proxy IDs are consistent: result.$proxy matches origin.parent of child records', (t) => {
	const records: Rekording[] = [];
	const p = create({ a: { b: 1 } }, { callback: (r) => records.push(r) });
	p.a.b;

	const getA = records.find(
		(r) =>
			r.trap === 'get' &&
			r.origin !== null &&
			'key' in r.origin &&
			r.origin.key === 'a',
	);
	const getB = records.find(
		(r) =>
			r.trap === 'get' &&
			r.origin !== null &&
			'key' in r.origin &&
			r.origin.key === 'b',
	);

	t.ok(getA && getB, 'both records found');
	t.ok(isProxyTag(getA?.result), 'getA result is a $proxy tag');

	const aId = (getA?.result as { $proxy: string }).$proxy;
	const bParent =
		getB && getB.origin !== null && 'parent' in getB.origin
			? getB.origin.parent
			: null;
	t.equal(aId, bParent, "a's result.$proxy === b's origin.parent");
	t.end();
});

test('apply origin.source matches the $proxy ID of the accessed function', (t) => {
	const records: Rekording[] = [];
	const p = create({ fn: () => 'ok' }, { callback: (r) => records.push(r) });
	p.fn();

	const getFn = records.find(
		(r) =>
			r.trap === 'get' &&
			r.origin !== null &&
			'key' in r.origin &&
			r.origin.key === 'fn',
	);
	const applyRec = records.find((r) => r.trap === 'apply');

	t.ok(getFn && applyRec, 'get and apply records found');
	t.ok(isProxyTag(getFn?.result), 'get result is $proxy-tagged');

	const fnId = (getFn?.result as { $proxy: string }).$proxy;
	const applySource =
		applyRec && applyRec.origin !== null && 'source' in applyRec.origin
			? applyRec.origin.source
			: null;
	t.equal(
		fnId,
		applySource,
		'function proxy ID is consistent across get and apply',
	);
	t.end();
});

test('symbol property keys are serialised as strings in records', (t) => {
	const records: Rekording[] = [];
	const sym = Symbol('myKey');
	const target = { [sym]: 'value' };
	const p = create(target, { callback: (r) => records.push(r) });
	p[sym];
	const rec = records.find(
		(r) => r.trap === 'get' && r.origin !== null && 'key' in r.origin,
	);
	t.ok(rec, 'get record found');
	t.equal(
		typeof (rec?.origin as Improbability).key,
		'string',
		'symbol key is serialised as string',
	);
	t.end();
});

test('circular references in plain object arguments are serialised as { $proxy: "?" }', (t) => {
	const records: Rekording[] = [];
	const p = create({ fn: (_v: unknown) => {} }, { callback: (r) => records.push(r) });
	const circular: Record<string, unknown> = {};
	circular.self = circular;
	p.fn(circular);
	const rec = records.find((r) => r.trap === 'apply');
	const arg = (rec?.args?.[2] as Improbability)?.[0];
	t.deepEqual(arg?.self, { $proxy: '?' }, 'circular back-reference serialised as { $proxy: "?" }');
	t.end();
});

// ─── Origin & path utilities ──────────────────────────────────────────────────

test('getOrigin returns null for the root proxy', (t) => {
	const p = create({ x: 1 }, { callback: () => {} });
	t.equal(getOrigin(p), null, 'root origin is null');
	t.end();
});

test('getOrigin returns a structured origin for a property-access proxy', (t) => {
	const p = create({ a: { v: 1 } }, { callback: () => {} });
	const a = p.a;
	const origin = getOrigin(a);
	t.ok(origin !== null, 'origin is not null');
	t.equal(origin?.trap, 'get');
	t.ok(origin && 'key' in origin, 'origin has a key field');
	t.equal(String((origin as { key: string | symbol }).key), 'a');
	t.end();
});

test('getOrigin for a function-return proxy has trap=apply and a source ID', (t) => {
	const p = create({ fn: () => ({ v: 1 }) }, { callback: () => {} });
	const result = p.fn();
	const origin = getOrigin(result);
	t.ok(origin !== null, 'origin is not null');
	t.equal(origin?.trap, 'apply');
	t.ok(origin && 'source' in origin, 'origin has a source field');
	t.equal(
		typeof (origin as { source: string }).source,
		'string',
		'source is a string proxy ID',
	);
	t.end();
});

test('getAncestors returns the full chain root-first', (t) => {
	const p = create({ a: { b: { c: 1 } } }, { callback: () => {} });
	const b = p.a.b;
	const ancestors = getAncestors(b);

	t.equal(ancestors.length, 3, 'root + a + b = 3 entries');
	t.equal(ancestors[0].origin, null, 'root entry has null origin');
	t.equal(
		ancestors[1].origin !== null && 'key' in ancestors[1].origin
			? String((ancestors[1].origin as { key: string | symbol }).key)
			: null,
		'a',
	);
	t.equal(
		ancestors[2].origin !== null && 'key' in ancestors[2].origin
			? String((ancestors[2].origin as { key: string | symbol }).key)
			: null,
		'b',
	);
	t.end();
});

test('getAncestors returns an empty array for a non-proxy', (t) => {
	t.deepEqual(getAncestors({ x: 1 }), [], 'plain object returns empty array');
	t.end();
});

test('getPath returns a dotted property path', (t) => {
	const p = create({ a: { b: { fn: () => 'x' } } }, { callback: () => {} });
	t.equal(getPath(p.a.b.fn), 'a.b.fn');
	t.end();
});

test('getPath annotates a function-return value with ()', (t) => {
	const p = create(
		{ a: { b: { make: () => ({ v: 1 }) } } },
		{ callback: () => {} },
	);
	t.equal(getPath(p.a.b.make()), 'a.b.make()');
	t.end();
});

test('getPath for the root proxy is an empty string', (t) => {
	const p = create({ x: 1 }, { callback: () => {} });
	t.equal(getPath(p), '');
	t.end();
});

// ─── Stream sink ──────────────────────────────────────────────────────────────

test('stream sink: writes valid NDJSON', (t) => {
	const { stream, lines } = makeStream();
	const p = create({ x: 1, y: 2 }, { stream });
	p.x;
	p.y;

	t.ok(lines.length >= 2, `at least two lines written (got ${lines.length})`);
	for (const line of lines) {
		t.doesNotThrow(() => JSON.parse(line), 'line is valid JSON');
		const rec = JSON.parse(line);
		t.equal(typeof rec.id, 'string', 'id is a string');
		t.equal(typeof rec.trap, 'string', 'trap is a string');
		t.ok('origin' in rec, 'origin field present');
		t.ok(Array.isArray(rec.args), 'args is an array');
		t.ok('result' in rec, 'result field present');
	}
	t.end();
});

test('stream sink: every record round-trips through JSON.stringify', (t) => {
	const { stream, lines } = makeStream();
	const p = create({ a: { b: () => ({ v: 1 }) } }, { stream });
	p.a.b();

	for (const line of lines) {
		const rec = JSON.parse(line);
		t.doesNotThrow(
			() => JSON.stringify(rec),
			`record ${rec.id} is fully serialisable`,
		);
	}
	t.end();
});

test('stream sink: origins contain only string IDs (no live references)', (t) => {
	const { stream, lines } = makeStream();
	const p = create({ a: { b: 1 }, fn: () => 'x' }, { stream });
	p.a.b;
	p.fn();

	for (const line of lines) {
		const rec = JSON.parse(line);
		if (rec.origin && 'parent' in rec.origin) {
			t.equal(
				typeof rec.origin.parent,
				'string',
				'origin.parent is a string ID',
			);
			t.equal(typeof rec.origin.key, 'string', 'origin.key is a string');
		}
		if (rec.origin && 'source' in rec.origin) {
			t.equal(
				typeof rec.origin.source,
				'string',
				'origin.source is a string ID',
			);
		}
	}
	t.end();
});

// ─── ID option ────────────────────────────────────────────────────────────────

test('id: numeric starting value offsets the sequence', (t) => {
	const records: Rekording[] = [];
	const p = create({ x: 1 }, { callback: (r) => records.push(r), id: 100 });
	p.x;
	t.ok(records[0].id.startsWith('#'), 'ID has # prefix');
	const n = parseInt(records[0].id.slice(1), 10);
	t.ok(n > 100, 'ID is greater than the starting value');
	t.end();
});

test('id: custom generator function is used', (t) => {
	const records: Rekording[] = [];
	let seq = 0;
	const p = create(
		{ x: 1 },
		{ callback: (r) => records.push(r), id: () => `evt-${++seq}` },
	);
	p.x;
	t.ok(records[0].id.startsWith('evt-'), 'custom ID format used');
	t.end();
});

// ─── defineProperty / getOwnPropertyDescriptor with accessor descriptors ─────

test('defineProperty: getter defined via accessor descriptor is proxied and its calls are recorded', (t) => {
	const records: Rekording[] = [];
	const target: Record<string, unknown> = {};
	const p = create(target, { callback: (r) => records.push(r) });

	const innerObj = { value: 42 };
	Object.defineProperty(p, 'x', { get: () => innerObj, configurable: true });

	const result = (p as Improbability).x;
	t.ok(isFlugrekorder(result), 'getter return value is proxied');
	t.ok(
		records.some((r) => r.trap === 'apply'),
		'calling the getter emits an apply record',
	);
	t.end();
});

test('defineProperty: setter defined via accessor descriptor is proxied, incoming value is tracked', (t) => {
	const records: Rekording[] = [];
	let received: unknown;
	const target: Record<string, unknown> = {};
	const p = create(target, { callback: (r) => records.push(r) });

	Object.defineProperty(p, 'x', {
		set: (v) => {
			received = v;
		},
		configurable: true,
	});
	const incoming = { val: 1 };
	(p as Improbability).x = incoming;

	t.ok(
		isFlugrekorder(received as object),
		'value received by setter is proxied',
	);
	t.end();
});

test('getOwnPropertyDescriptor: accessor descriptor get/set are proxied in the returned descriptor', (t) => {
	const target: Record<string, unknown> = {};
	Object.defineProperty(target, 'x', {
		get: () => 99,
		set: (_v) => {},
		configurable: true,
	});
	const p = create(target, { callback: () => {} });

	// biome-ignore lint/style/noNonNullAssertion: descriptor and its accessors must exist — silent undefined would mask a real failure
	const desc = Object.getOwnPropertyDescriptor(p, 'x')!;
	// biome-ignore lint/style/noNonNullAssertion: same — asserting get/set are present is the point of the test
	t.ok(isFlugrekorder(desc.get!), 'get in returned descriptor is proxied');
	// biome-ignore lint/style/noNonNullAssertion: same
	t.ok(isFlugrekorder(desc.set!), 'set in returned descriptor is proxied');
	t.end();
});

test('defineProperty with only flag changes (no value/get/set) passes the descriptor through unchanged', (t) => {
	const records: Rekording[] = [];
	const target = { x: 1 };
	const p = create(target, { callback: (r) => records.push(r) });

	Object.defineProperty(p, 'x', { configurable: true, writable: true });
	t.ok(
		records.some((r) => r.trap === 'defineProperty'),
		'defineProperty record still emitted',
	);
	t.equal(
		Object.getOwnPropertyDescriptor(target, 'x')?.configurable,
		true,
		'flag change applied to target',
	);
	t.end();
});


test('getOwnPropertyDescriptor returns undefined for a non-existent property', (t) => {
	const p = create({ x: 1 }, { callback: () => {} });
	t.equal(
		Object.getOwnPropertyDescriptor(p, 'nonExistent'),
		undefined,
		'non-existent property returns undefined',
	);
	t.end();
});

test('getOwnPropertyDescriptor on a property with value undefined returns the descriptor unchanged', (t) => {
	const p = create({ x: undefined as unknown }, { callback: () => {} });
	// biome-ignore lint/style/noNonNullAssertion: descriptor must exist — silent undefined would mask a real failure
	const desc = Object.getOwnPropertyDescriptor(p, 'x')!;
	t.equal(desc.value, undefined, 'value is undefined');
	t.notOk(
		isFlugrekorder(desc as Improbability),
		'the descriptor object itself is not a proxy',
	);
	t.end();
});

test('create() called with an already-proxied target returns it unchanged', (t) => {
	const original = { x: 1 };
	const p1 = create(original, { callback: () => {} });
	const records: Rekording[] = [];
	const p2 = create(p1, { callback: (r) => records.push(r) });
	t.equal(p2, p1, 'returns the existing proxy, not a new wrapper');
	t.end();
});

// ─── Promise handling ─────────────────────────────────────────────────────────

test('async function: resolved value is proxied', async (t) => {
	const p = create(
		{ fetch: async () => ({ id: 1 }) },
		{ callback: () => {} },
	);
	const result = await p.fetch();
	t.ok(isFlugrekorder(result), 'resolved value is a proxy');
	t.equal(
		(result as Improbability).id,
		1,
		'resolved value is accessible through the proxy',
	);
	t.end();
});

test('async function: resolved primitive is returned as-is', async (t) => {
	const p = create({ getCount: async () => 42 }, { callback: () => {} });
	const result = await p.getCount();
	t.equal(result, 42, 'primitive resolved value is returned unchanged');
	t.end();
});

test('Promise property: awaiting a proxied Promise resolves correctly', async (t) => {
	const p = create(
		{ data: Promise.resolve({ name: 'alice' }) },
		{ callback: () => {} },
	);
	const result = await p.data;
	t.ok(
		isFlugrekorder(result),
		'resolved value of a Promise property is proxied',
	);
	t.equal((result as Improbability).name, 'alice', 'data is accessible');
	t.end();
});

test('Promise stability: the same Promise always resolves to the same proxy', async (t) => {
	const inner = { v: 1 };
	const p = create(
		{ a: Promise.resolve(inner), b: Promise.resolve(inner) },
		{ callback: () => {} },
	);
	const [a, b] = await Promise.all([p.a, p.b]);
	t.equal(a, b, 'same resolved object yields the same proxy');
	t.end();
});

// ─── getTarget ────────────────────────────────────────────────────────────────

test('getTarget returns the original unwrapped object', (t) => {
	const target = { x: 1 };
	const p = create(target, { callback: () => {} });
	t.equal(getTarget(p), target, 'returns the original target');
	t.end();
});

test('getTarget returns null for a non-proxy', (t) => {
	t.equal(getTarget({ x: 1 }), null, 'plain object returns null');
	t.end();
});

// ─── getProxyById ─────────────────────────────────────────────────────────────

test('getProxyById retrieves a proxy by its recorded ID', (t) => {
	const records: Rekording[] = [];
	const p = create({ a: { v: 1 } }, { callback: (r) => records.push(r) });
	p.a;
	const rec = records.find((r) => r.trap === 'get');
	const id = (rec?.result as { $proxy: string })?.$proxy;
	t.ok(id, 'a $proxy ID was recorded');
	const retrieved = getProxyById(id, p);
	t.ok(isFlugrekorder(retrieved), 'retrieved value is a proxy');
	t.equal(retrieved, p.a, 'retrieved proxy is the same instance as p.a');
	t.end();
});

test('getProxyById returns undefined for an unknown ID', (t) => {
	const p = create({ x: 1 }, { callback: () => {} });
	t.equal(getProxyById('no-such-id', p), undefined, 'unknown ID returns undefined');
	t.end();
});

// ─── getPath ──────────────────────────────────────────────────────────────────

test('getPath on a directly-called root function produces ()', (t) => {
	const fn = create(() => ({ v: 1 }), { callback: () => {} });
	const result = fn();
	t.equal(
		getPath(result),
		'()',
		'root call site with no preceding property access',
	);
	t.end();
});
