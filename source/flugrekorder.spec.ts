import { createServer } from 'node:http';
import { Writable } from 'node:stream';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { each } from 'template-literal-each';
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

test('traps with no origin mapping (e.g. has) emit a rekording with null origin', () => {
	// arrange
	const records: Rekording[] = [];
	const p = create({ x: 1 }, { callback: (r) => records.push(r) });

	// act
	'x' in p;

	// assert
	const rec = records.find((r) => r.trap === 'has');
	assert.ok(rec, 'has record emitted');
	assert.strictEqual(
		rec?.origin,
		null,
		'origin is null for traps outside the origin mapping',
	);

});

test('primitives are returned unchanged through get', () => {
	const p = create({ n: 42, s: 'hi', b: true }, { callback: () => {} });

	assert.strictEqual(p.n, 42, 'number');
	assert.strictEqual(p.s, 'hi', 'string');
	assert.strictEqual(p.b, true, 'boolean');

});

test('get trap emits one rekording per property access', () => {
	// arrange
	const records: Rekording[] = [];
	const p = create({ a: 1, b: 2 }, { callback: (r) => records.push(r) });

	// act
	p.a;
	p.b;

	// assert
	assert.strictEqual(
		records.filter((r) => r.trap === 'get').length,
		2,
		'two get records',
	);

});

test('set trap emits a rekording and mutates the underlying value', () => {
	// arrange
	const records: Rekording[] = [];
	const target: { a: number } = { a: 1 };
	const p = create(target, { callback: (r) => records.push(r) });

	// act
	p.a = 99;

	// assert
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

test('apply trap emits a rekording and returns the correct value', () => {
	// arrange
	const records: Rekording[] = [];
	const p = create(
		{ double: (n: number) => n * 2 },
		{ callback: (r) => records.push(r) },
	);

	// act + assert
	assert.strictEqual(p.double(5), 10, 'return value is correct');
	assert.ok(
		records.some((r) => r.trap === 'apply'),
		'apply record emitted',
	);

});

test('construct trap emits a rekording and returns an instance', () => {
	// arrange
	const records: Rekording[] = [];
	class Counter {
		count = 0;
	}
	const p = create(Counter, { callback: (r) => records.push(r) });

	// act
	const instance = new p();

	// assert
	assert.ok(
		records.some((r) => r.trap === 'construct'),
		'construct record emitted',
	);
	assert.strictEqual(instance.count, 0, 'instance has correct initial state');

});

test('returned proxiable values are themselves proxied', () => {
	// arrange
	const records: Rekording[] = [];
	const p = create(
		{ nested: { x: 1 } },
		{ callback: (r) => records.push(r) },
	);
	const nested = p.nested;
	const before = records.length;

	// act
	nested.x;

	// assert
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

test('a known target passed as a call argument is proxied, so interactions on it are recorded', () => {
	// arrange
	const records: Rekording[] = [];
	const child = { x: 42 };
	const target = {
		child,
		fn: (obj: typeof child) => obj.x,
	};
	const p = create(target, { callback: (r) => records.push(r) });
	p.child; // registers child in the graph
	const before = records.length;

	// act
	p.fn(child); // passes raw target — known() should return its proxy

	// assert
	const xAccess = records
		.slice(before)
		.find(
			(r) =>
				r.trap === 'get' &&
				r.origin !== null &&
				'key' in r.origin &&
				r.origin.key === 'x',
		);
	assert.ok(
		xAccess,
		'get trap for x fires when known target is passed as argument',
	);

});

test('no recursion when a method mutates this', () => {
	// arrange
	const records: Rekording[] = [];
	const target = {
		c: 0,
		inc() {
			return ++this.c;
		},
	};
	const p = create(target, { callback: (r) => records.push(r) });

	// act + assert — if inc() throws it means infinite recursion; node:test catches it
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

// ─── isFlugrekorder ──────────────────────────────────────────────────────

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

// ─── recursive option ────────────────────────────────────────────────────────

test('recursive: true (default) proxies nested values', () => {
	// arrange
	const records: Rekording[] = [];
	const p = create({ a: { b: 1 } }, { callback: (r) => records.push(r) });
	const a = p.a;
	const before = records.length;

	// act
	a.b;

	// assert
	assert.ok(records.length > before, 'nested access emits additional records');

});

test('recursive: false does not proxy values returned from traps', () => {
	// arrange
	const records: Rekording[] = [];
	const p = create(
		{ a: { b: 1 } },
		{ callback: (r) => records.push(r), recursive: false },
	);

	// act + assert
	const a = p.a;
	assert.strictEqual(isFlugrekorder(a), false, 'returned nested value is not a proxy');

});

test('recursive: false still emits records for the root proxy', () => {
	// arrange
	const records: Rekording[] = [];
	const p = create(
		{ x: 1 },
		{ callback: (r) => records.push(r), recursive: false },
	);

	// act
	p.x;

	// assert
	assert.ok(
		records.some((r) => r.trap === 'get'),
		'get record still emitted on root',
	);

});

// ─── only option ─────────────────────────────────────────────────────────────

test('only: restricts which traps emit records', () => {
	// arrange
	const records: Rekording[] = [];
	const target: { a: number } = { a: 1 };
	const p = create(target, {
		callback: (r) => records.push(r),
		only: ['get'],
	});

	// act
	p.a;
	p.a = 99;

	// assert
	assert.ok(
		records.every((r) => r.trap === 'get'),
		'only get records emitted',
	);
	assert.strictEqual(
		records.some((r) => r.trap === 'set'),
		false,
		'no set records emitted',
	);

});

test('only: traps not in the list still execute correctly (pass-through)', () => {
	// arrange
	const target: { a: number } = { a: 1 };
	const p = create(target, {
		callback: () => {},
		only: ['get'],
	});

	// act
	p.a = 99;

	// assert
	assert.strictEqual(
		target.a,
		99,
		'set passes through and mutates target even when not recorded',
	);

});

test('only: apply and get can be combined', () => {
	// arrange
	const records: Rekording[] = [];
	const p = create(
		{ fn: () => 'hi' },
		{ callback: (r) => records.push(r), only: ['get', 'apply'] },
	);

	// act
	p.fn();

	// assert
	const traps = new Set(records.map((r) => r.trap));
	assert.ok(traps.has('get'), 'get recorded');
	assert.ok(traps.has('apply'), 'apply recorded');
	assert.strictEqual(traps.size, 2, 'no other traps recorded');

});

// ─── filter option ───────────────────────────────────────────────────────────

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

// ─── Serialisation ────────────────────────────────────────────────────────────

test('proxiable results are serialised as $proxy tags', () => {
	// arrange
	const records: Rekording[] = [];
	const p = create({ obj: { v: 1 } }, { callback: (r) => records.push(r) });

	// act
	p.obj;

	// assert
	const rec = records.find(
		(r) =>
			r.trap === 'get' &&
			r.origin !== null &&
			'key' in r.origin &&
			r.origin.key === 'obj',
	);
	assert.ok(rec, 'get record found');
	assert.ok(isProxyTag(rec?.result), 'result is a $proxy tag');
	assert.strictEqual(
		typeof (rec?.result as { $proxy: string }).$proxy,
		'string',
		'$proxy is a string',
	);

});

test('primitive results are inlined in the rekording', () => {
	// arrange
	const records: Rekording[] = [];
	const p = create({ n: 7 }, { callback: (r) => records.push(r) });

	// act
	p.n;

	// assert
	const rec = records.find(
		(r) =>
			r.trap === 'get' &&
			r.origin !== null &&
			'key' in r.origin &&
			r.origin.key === 'n',
	);
	assert.ok(rec, 'get record found');
	assert.strictEqual(rec?.result, 7, 'primitive result is inlined');

});

test('proxy IDs are consistent: result.$proxy matches origin.parent of child records', () => {
	// arrange
	const records: Rekording[] = [];
	const p = create({ a: { b: 1 } }, { callback: (r) => records.push(r) });

	// act
	p.a.b;

	// assert
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
	assert.ok(getA && getB, 'both records found');
	assert.ok(isProxyTag(getA?.result), 'getA result is a $proxy tag');

	const aId = (getA?.result as { $proxy: string }).$proxy;
	const bParent =
		getB && getB.origin !== null && 'parent' in getB.origin
			? getB.origin.parent
			: null;
	assert.strictEqual(aId, bParent, "a's result.$proxy === b's origin.parent");

});

test('apply origin.source matches the $proxy ID of the accessed function', () => {
	// arrange
	const records: Rekording[] = [];
	const p = create({ fn: () => 'ok' }, { callback: (r) => records.push(r) });

	// act
	p.fn();

	// assert
	const getFn = records.find(
		(r) =>
			r.trap === 'get' &&
			r.origin !== null &&
			'key' in r.origin &&
			r.origin.key === 'fn',
	);
	const applyRec = records.find((r) => r.trap === 'apply');
	assert.ok(getFn && applyRec, 'get and apply records found');
	assert.ok(isProxyTag(getFn?.result), 'get result is $proxy-tagged');

	const fnId = (getFn?.result as { $proxy: string }).$proxy;
	const applySource =
		applyRec && applyRec.origin !== null && 'source' in applyRec.origin
			? applyRec.origin.source
			: null;
	assert.strictEqual(
		fnId,
		applySource,
		'function proxy ID is consistent across get and apply',
	);

});

test('symbol property keys are serialised as strings in records', () => {
	// arrange
	const records: Rekording[] = [];
	const sym = Symbol('myKey');
	const target = { [sym]: 'value' };
	const p = create(target, { callback: (r) => records.push(r) });

	// act
	p[sym];

	// assert
	const rec = records.find(
		(r) => r.trap === 'get' && r.origin !== null && 'key' in r.origin,
	);
	assert.ok(rec, 'get record found');
	assert.strictEqual(
		typeof (rec?.origin as Improbability).key,
		'string',
		'symbol key is serialised as string',
	);

});

// ─── Origin & path utilities ──────────────────────────────────────────────────

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

// ─── Stream sink ──────────────────────────────────────────────────────────────

test('stream sink: writes valid NDJSON', () => {
	// arrange
	const { stream, lines } = makeStream();
	const p = create({ x: 1, y: 2 }, { stream });

	// act
	p.x;
	p.y;

	// assert
	assert.ok(lines.length >= 2, `at least two lines written (got ${lines.length})`);
	for (const line of lines) {
		assert.doesNotThrow(() => JSON.parse(line), 'line is valid JSON');
		const rec = JSON.parse(line);
		assert.strictEqual(typeof rec.id, 'string', 'id is a string');
		assert.strictEqual(typeof rec.trap, 'string', 'trap is a string');
		assert.ok('origin' in rec, 'origin field present');
		assert.ok(Array.isArray(rec.args), 'args is an array');
		assert.ok('result' in rec, 'result field present');
	}

});

test('stream sink: every record round-trips through JSON.stringify', () => {
	// arrange
	const { stream, lines } = makeStream();
	const p = create({ a: { b: () => ({ v: 1 }) } }, { stream });

	// act
	p.a.b();

	// assert
	for (const line of lines) {
		const rec = JSON.parse(line);
		assert.doesNotThrow(
			() => JSON.stringify(rec),
			`record ${rec.id} is fully serialisable`,
		);
	}

});

test('stream sink: origins contain only string IDs (no live references)', () => {
	// arrange
	const { stream, lines } = makeStream();
	const p = create({ a: { b: 1 }, fn: () => 'x' }, { stream });

	// act
	p.a.b;
	p.fn();

	// assert
	for (const line of lines) {
		const rec = JSON.parse(line);
		if (rec.origin && 'parent' in rec.origin) {
			assert.strictEqual(
				typeof rec.origin.parent,
				'string',
				'origin.parent is a string ID',
			);
			assert.strictEqual(typeof rec.origin.key, 'string', 'origin.key is a string');
		}
		if (rec.origin && 'source' in rec.origin) {
			assert.strictEqual(
				typeof rec.origin.source,
				'string',
				'origin.source is a string ID',
			);
		}
	}

});

// ─── ID option ────────────────────────────────────────────────────────────────

test('id: numeric starting value offsets the sequence', () => {
	// arrange
	const records: Rekording[] = [];
	const p = create({ x: 1 }, { callback: (r) => records.push(r), id: 100 });

	// act
	p.x;

	// assert
	assert.ok(records[0].id.startsWith('#'), 'ID has # prefix');
	const n = parseInt(records[0].id.slice(1), 10);
	assert.ok(n > 100, 'ID is greater than the starting value');

});

test('id: custom generator function is used', () => {
	// arrange
	const records: Rekording[] = [];
	let seq = 0;
	const p = create(
		{ x: 1 },
		{ callback: (r) => records.push(r), id: () => `evt-${++seq}` },
	);

	// act
	p.x;

	// assert
	assert.ok(records[0].id.startsWith('evt-'), 'custom ID format used');

});

// ─── defineProperty / getOwnPropertyDescriptor with accessor descriptors ─────

test('defineProperty: getter defined via accessor descriptor is proxied and its calls are recorded', () => {
	// arrange
	const records: Rekording[] = [];
	const target: Record<string, unknown> = {};
	const p = create(target, { callback: (r) => records.push(r) });
	const innerObj = { value: 42 };
	Object.defineProperty(p, 'x', { get: () => innerObj, configurable: true });

	// act
	const result = (p as Improbability).x;

	// assert
	assert.ok(isFlugrekorder(result), 'getter return value is proxied');
	assert.ok(
		records.some((r) => r.trap === 'apply'),
		'calling the getter emits an apply record',
	);

});

test('defineProperty: setter defined via accessor descriptor is proxied, incoming value is tracked', () => {
	// arrange
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

	// act
	(p as Improbability).x = incoming;

	// assert
	assert.ok(
		isFlugrekorder(received as object),
		'value received by setter is proxied',
	);

});

test('getOwnPropertyDescriptor: accessor descriptor get/set are proxied in the returned descriptor', () => {
	// arrange
	const target: Record<string, unknown> = {};
	Object.defineProperty(target, 'x', {
		get: () => 99,
		set: (_v) => {},
		configurable: true,
	});
	const p = create(target, { callback: () => {} });

	// act + assert
	// biome-ignore lint/style/noNonNullAssertion: descriptor and its accessors must exist — silent undefined would mask a real failure
	const desc = Object.getOwnPropertyDescriptor(p, 'x')!;
	// biome-ignore lint/style/noNonNullAssertion: same — asserting get/set are present is the point of the test
	assert.ok(isFlugrekorder(desc.get!), 'get in returned descriptor is proxied');
	// biome-ignore lint/style/noNonNullAssertion: same
	assert.ok(isFlugrekorder(desc.set!), 'set in returned descriptor is proxied');

});

test('defineProperty with only flag changes (no value/get/set) passes the descriptor through unchanged', () => {
	// arrange
	const records: Rekording[] = [];
	const target = { x: 1 };
	const p = create(target, { callback: (r) => records.push(r) });

	// act
	Object.defineProperty(p, 'x', { configurable: true, writable: true });

	// assert
	assert.ok(
		records.some((r) => r.trap === 'defineProperty'),
		'defineProperty record still emitted',
	);
	assert.strictEqual(
		Object.getOwnPropertyDescriptor(target, 'x')?.configurable,
		true,
		'flag change applied to target',
	);

});

test('getOwnPropertyDescriptor returns undefined for a non-existent property', () => {
	const p = create({ x: 1 }, { callback: () => {} });

	assert.strictEqual(
		Object.getOwnPropertyDescriptor(p, 'nonExistent'),
		undefined,
		'non-existent property returns undefined',
	);

});

test('getOwnPropertyDescriptor on a property with value undefined returns the descriptor unchanged', () => {
	const p = create({ x: undefined as unknown }, { callback: () => {} });

	// biome-ignore lint/style/noNonNullAssertion: descriptor must exist — silent undefined would mask a real failure
	const desc = Object.getOwnPropertyDescriptor(p, 'x')!;
	assert.strictEqual(desc.value, undefined, 'value is undefined');
	assert.strictEqual(
		isFlugrekorder(desc as Improbability),
		false,
		'the descriptor object itself is not a proxy',
	);

});

test('create() called with an already-proxied target returns it unchanged', () => {
	// arrange
	const original = { x: 1 };
	const p1 = create(original, { callback: () => {} });
	const records: Rekording[] = [];
	const p2 = create(p1, { callback: (r) => records.push(r) });

	// assert
	assert.strictEqual(p2, p1, 'returns the existing proxy, not a new wrapper');

});

// ─── Promise handling ─────────────────────────────────────────────────────────

test('async function: resolved value is proxied', async () => {
	// arrange
	const p = create(
		{ fetch: async () => ({ id: 1 }) },
		{ callback: () => {} },
	);

	// act
	const result = await p.fetch();

	// assert
	assert.ok(isFlugrekorder(result), 'resolved value is a proxy');
	assert.strictEqual(
		(result as Improbability).id,
		1,
		'resolved value is accessible through the proxy',
	);

});

test('async function: resolved primitive is returned as-is', async () => {
	const p = create({ getCount: async () => 42 }, { callback: () => {} });
	const result = await p.getCount();

	assert.strictEqual(result, 42, 'primitive resolved value is returned unchanged');

});

test('Promise property: awaiting a proxied Promise resolves correctly', async () => {
	// arrange
	const p = create(
		{ data: Promise.resolve({ name: 'alice' }) },
		{ callback: () => {} },
	);

	// act
	const result = await p.data;

	// assert
	assert.ok(
		isFlugrekorder(result),
		'resolved value of a Promise property is proxied',
	);
	assert.strictEqual((result as Improbability).name, 'alice', 'data is accessible');

});

test('Promise stability: the same Promise always resolves to the same proxy', async () => {
	// arrange
	const inner = { v: 1 };
	const p = create(
		{ a: Promise.resolve(inner), b: Promise.resolve(inner) },
		{ callback: () => {} },
	);

	// act
	const [a, b] = await Promise.all([p.a, p.b]);

	// assert
	assert.strictEqual(a, b, 'same resolved object yields the same proxy');

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
	// arrange
	const records: Rekording[] = [];
	const p = create({ a: { v: 1 } }, { callback: (r) => records.push(r) });

	// act
	p.a;

	// assert
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

// ─── getPath ──────────────────────────────────────────────────────────────────

test('getPath on a directly-called root function produces ()', () => {
	const fn = create(() => ({ v: 1 }), { callback: () => {} });
	const result = fn();

	assert.strictEqual(
		getPath(result),
		'()',
		'root call site with no preceding property access',
	);

});

// ─── native objects with internal slots ──────────────────────────────────────

// Finds all apply records for a given method name by cross-referencing the
// preceding get record's $proxy result with apply origin.source.
function appliesFor(records: Rekording[], method: string): Rekording[] {
	const getRecord = records.find(
		(r) =>
			r.trap === 'get' &&
			r.origin !== null &&
			'key' in r.origin &&
			r.origin.key === method,
	);
	if (!getRecord || !isProxyTag(getRecord.result)) return [];
	const fnId = (getRecord.result as { $proxy: string }).$proxy;
	return records.filter(
		(r) =>
			r.trap === 'apply' &&
			r.origin !== null &&
			'source' in r.origin &&
			r.origin.source === fnId,
	);
}

test('native objects with internal slots', () => {
	each`
	message        | input                       | access                         | expect
	-------------- | --------------------------- | ------------------------------ | -------
	Array.length   | ${[1, 2, 3]}                | ${(f: Improbability) => f.length}      | ${3}
	Map.size       | ${new Map([['a', 1]])}      | ${(f: Improbability) => f.size}        | ${1}
	Map.get        | ${new Map([['a', 1]])}      | ${(f: Improbability) => f.get('a')}    | ${1}
	Set.size       | ${new Set([1, 2, 3])}       | ${(f: Improbability) => f.size}        | ${3}
	Set.has        | ${new Set([1, 2, 3])}       | ${(f: Improbability) => f.has(1)}      | ${true}
	Date.getTime   | ${new Date(0)}              | ${(f: Improbability) => f.getTime()}   | ${0}
	`(({ message, input, access, expect }: Improbability) => {
		const p = create(input, { callback: () => {} });

		assert.strictEqual(access(p), expect, message);
	});


});

test('Map: set/get/delete of an object value are recorded', () => {
	const records: Rekording[] = [];
	const obj = { id: 1 };
	const p = create(new Map<string, typeof obj>(), {
		callback: (r) => records.push(r),
	});

	p.set('k', obj);
	const retrieved = p.get('k');
	const deleted = p.delete('k');

	const [setRec] = appliesFor(records, 'set');
	assert.ok(setRec, 'set call recorded');
	assert.strictEqual((setRec?.args[2] as Improbability)[0], 'k', 'set key in args');
	assert.ok(isProxyTag(setRec?.result), 'set returns the Map as proxy');

	const [getRec] = appliesFor(records, 'get');
	assert.ok(getRec, 'get call recorded');
	assert.strictEqual((getRec?.args[2] as Improbability)[0], 'k', 'get key in args');
	assert.ok(
		isProxyTag(getRec?.result),
		'get result is the stored object (proxied)',
	);
	assert.ok(isFlugrekorder(retrieved as object), 'retrieved value is a proxy');

	const [deleteRec] = appliesFor(records, 'delete');
	assert.ok(deleteRec, 'delete call recorded');
	assert.strictEqual(
		(deleteRec?.args[2] as Improbability)[0],
		'k',
		'delete key in args',
	);
	assert.strictEqual(deleteRec?.result, true, 'delete result recorded as true');
	assert.strictEqual(deleted, true, 'delete return value is true');


});

test('Set: add/has/delete of an object are recorded', () => {
	const records: Rekording[] = [];
	const obj = { id: 1 };
	const p = create(new Set<typeof obj>(), {
		callback: (r) => records.push(r),
	});

	p.add(obj);
	const before = p.has(obj);
	p.delete(obj);
	const after = p.has(obj);

	const [addRec] = appliesFor(records, 'add');
	assert.ok(addRec, 'add call recorded');
	assert.ok(isProxyTag(addRec?.result), 'add returns the Set as proxy');

	const hasRecs = appliesFor(records, 'has');
	assert.strictEqual(hasRecs.length, 2, 'has called twice — both recorded');
	assert.strictEqual(hasRecs[0]?.result, true, 'first has: true (after add)');
	assert.strictEqual(hasRecs[1]?.result, false, 'second has: false (after delete)');
	assert.strictEqual(before, true, 'has return value correct before delete');
	assert.strictEqual(after, false, 'has return value correct after delete');

	const [deleteRec] = appliesFor(records, 'delete');
	assert.ok(deleteRec, 'delete call recorded');
	assert.strictEqual(deleteRec?.result, true, 'delete result recorded as true');


});

test('WeakMap: set/get/delete of an object value are recorded', () => {
	const records: Rekording[] = [];
	const key = { id: 'key' };
	const value = { data: 42 };
	const p = create(new WeakMap<typeof key, typeof value>(), {
		callback: (r) => records.push(r),
	});

	p.set(key, value);
	const retrieved = p.get(key);
	const deleted = p.delete(key);

	const [setRec] = appliesFor(records, 'set');
	assert.ok(setRec, 'set call recorded');
	assert.ok((setRec?.args[2] as Improbability)[0], 'key arg present in recording');
	assert.ok(isProxyTag(setRec?.result), 'set returns the WeakMap as proxy');

	const [getRec] = appliesFor(records, 'get');
	assert.ok(getRec, 'get call recorded');
	assert.ok(
		isProxyTag(getRec?.result),
		'get result is the stored value (proxied)',
	);
	assert.ok(isFlugrekorder(retrieved as object), 'retrieved value is a proxy');
	assert.strictEqual(
		(retrieved as typeof value)?.data,
		42,
		'retrieved value is correct',
	);

	const [deleteRec] = appliesFor(records, 'delete');
	assert.ok(deleteRec, 'delete call recorded');
	assert.strictEqual(deleteRec?.result, true, 'delete result recorded as true');
	assert.strictEqual(deleted, true, 'delete return value is true');


});

test('WeakSet: add/has/delete of an object are recorded', () => {
	const records: Rekording[] = [];
	const obj = { id: 1 };
	const p = create(new WeakSet<typeof obj>(), {
		callback: (r) => records.push(r),
	});

	p.add(obj);
	const before = p.has(obj);
	p.delete(obj);
	const after = p.has(obj);

	const [addRec] = appliesFor(records, 'add');
	assert.ok(addRec, 'add call recorded');
	assert.ok(isProxyTag(addRec?.result), 'add returns the WeakSet as proxy');

	const hasRecs = appliesFor(records, 'has');
	assert.strictEqual(hasRecs.length, 2, 'has called twice — both recorded');
	assert.strictEqual(hasRecs[0]?.result, true, 'first has: true (after add)');
	assert.strictEqual(hasRecs[1]?.result, false, 'second has: false (after delete)');
	assert.strictEqual(before, true, 'has return value correct before delete');
	assert.strictEqual(after, false, 'has return value correct after delete');

	const [deleteRec] = appliesFor(records, 'delete');
	assert.ok(deleteRec, 'delete call recorded');
	assert.strictEqual(deleteRec?.result, true, 'delete result recorded as true');


});

// ─── Timestamp ────────────────────────────────────────────────────────────────

test('every rekording has a numeric timestamp', () => {
	// arrange
	const records: Rekording[] = [];
	const p = create({ x: 1 }, { callback: (r) => records.push(r) });

	// act
	p.x;

	// assert
	assert.strictEqual(typeof records[0].timestamp, 'number', 'timestamp is a number');

});

test('timestamps are monotonically non-decreasing across sequential traps', () => {
	// arrange
	const records: Rekording[] = [];
	const p = create(
		{ a: 1, b: 2, c: 3 },
		{ callback: (r) => records.push(r) },
	);

	// act
	p.a;
	p.b;
	p.c;

	// assert
	for (let i = 1; i < records.length; i++) {
		assert.ok(
			records[i].timestamp >= records[i - 1].timestamp,
			`record ${i} timestamp >= record ${i - 1} timestamp`,
		);
	}

});

test('stream sink: timestamp is present and numeric in NDJSON output', () => {
	// arrange
	const { stream, lines } = makeStream();
	const p = create({ x: 1 }, { stream });

	// act
	p.x;

	// assert
	const rec = JSON.parse(lines[0]);
	assert.strictEqual(typeof rec.timestamp, 'number', 'timestamp is a number in NDJSON');

});

// ─── C++ binding boundary ─────────────────────────────────────────────────────

test('wrapping http.Server and completing a full request lifecycle does not crash', async () => {
	// Before the fix, wrapping an http.Server caused a fatal V8 abort:
	// GetAlignedPointerFromInternalField on a Proxy has no internal fields.
	// This test would have reproduced that crash.
	const raw = createServer((_req, res) => res.end('ok'));
	const server = create(raw, { only: ['apply'], callback: () => {} });

	await new Promise<void>((resolve) => {
		server.listen(0, () => {
			const { port } = raw.address() as { port: number };
			fetch(`http://127.0.0.1:${port}/`).then(() => {
				server.close(() => resolve());
			});
		});
	});
});

test('C++ binding objects returned via get are not proxied', async () => {
	// The isECMABuiltin guard lets Map/Set/Date be proxied safely but returns
	// C++ binding objects (TCP handles, ConnectionsList, …) unwrapped. If they
	// were proxied, passing them to native code would crash V8 fatally.
	const raw = createServer();

	await new Promise<void>((resolve) => {
		raw.listen(0, () => {
			const server = create(raw, { callback: () => {} });
			const handle = (server as Improbability)._handle;

			assert.ok(handle != null, 'server has a handle after listening');
			assert.strictEqual(isFlugrekorder(handle), false, 'TCP handle is not a flugrekorder proxy');

			raw.close(() => resolve());
		});
	});
});

test('defineProperty: C++ binding values in descriptors are not wrapped', async () => {
	// Covers the !isECMABuiltin branch in defineProperty.pre.
	// When listen() runs with `this = serverProxy`, Node.js assigns this._handle = new TCP()
	// which routes through Reflect.set(rawServer, '_handle', tcpHandle, serverProxy) →
	// defineProperty trap with descriptor.value = tcpHandle (a C++ binding).
	const raw = createServer((_req, res) => res.end('ok'));
	const server = create(raw, { callback: () => {} });

	await new Promise<void>((resolve) => {
		server.listen(0, () => {
			assert.strictEqual(
				isFlugrekorder((server as Improbability)._handle),
				false,
				'TCP handle stored via defineProperty is not proxied',
			);
			server.close(() => resolve());
		});
	});
});

test('getOwnPropertyDescriptor: C++ binding values in returned descriptors are not wrapped', async () => {
	// Covers the !isECMABuiltin branch in getOwnPropertyDescriptor.post.
	const raw = createServer();

	await new Promise<void>((resolve) => {
		raw.listen(0, () => {
			const server = create(raw, { callback: () => {} });
			const desc = Object.getOwnPropertyDescriptor(server as Improbability, '_handle');

			assert.ok(desc?.value != null, 'descriptor has a value after listening');
			assert.strictEqual(
				isFlugrekorder(desc?.value),
				false,
				'TCP handle in descriptor is not proxied',
			);
			raw.close(() => resolve());
		});
	});
});

test('apply:native is emitted when a function throws "Illegal invocation" and retries with real this', () => {
	// A WeakSet keyed by the real object: a Proxy has distinct identity from its
	// target, so has(proxy) returns false while has(realTarget) returns true.
	// This mirrors a C++ native method that checks its internal slot against the
	// real object and rejects the Proxy receiver.
	const records: Rekording[] = [];
	const isReal = new WeakSet<object>();
	const obj: Record<string, unknown> = {
		nativeLike: function (this: Improbability) {
			if (!isReal.has(this)) throw new TypeError('Illegal invocation');
			return 'ok';
		},
	};
	isReal.add(obj);

	const p = create(obj as Improbability, { callback: (r) => records.push(r) });

	// if the retry mechanism fails, nativeLike() throws — node:test catches it
	const result = (p as Improbability).nativeLike();
	assert.strictEqual(result, 'ok', 'correct return value from the retry');

	const nativeRec = records.find((r) => r.trap === 'apply:native');
	assert.ok(nativeRec, 'apply:native record emitted');

	const isUnwrapTag = (v: unknown): v is { $unwrap: { $proxy: string } } =>
		typeof v === 'object' && v !== null && !Array.isArray(v) && '$unwrap' in (v as object);

	assert.ok(
		isUnwrapTag(nativeRec?.args[1]),
		'raw target (real this) serialized as $unwrap in args',
	);


});
