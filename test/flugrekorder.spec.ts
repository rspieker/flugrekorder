import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
	create,
	getAncestors,
	getOrigin,
	getPath,
	getProxyById,
	getTarget,
	isFlugrekorder,
	type Rekording,
} from '../source/flugrekorder';

// biome-ignore lint/suspicious/noExplicitAny: Improbability is the intentional escape hatch for test assertions that cannot be typed otherwise
type Improbability = any;

// ─── descriptors ─────────────────────────────────────────────────────────────

describe('descriptors', () => {
	test('defineProperty: getter defined via accessor descriptor is proxied and its calls are recorded', () => {
		const records: Rekording[] = [];
		const target: Record<string, unknown> = {};
		const p = create(target, { callback: (r) => records.push(r) });
		const innerObj = { value: 42 };
		Object.defineProperty(p, 'x', { get: () => innerObj, configurable: true });

		const result = (p as Improbability).x;

		assert.ok(isFlugrekorder(result), 'getter return value is proxied');
		assert.ok(
			records.some((r) => r.trap === 'apply'),
			'calling the getter emits an apply record',
		);
	});

	test('defineProperty: setter defined via accessor descriptor is proxied, incoming value is tracked', () => {
		const records: Rekording[] = [];
		let received: unknown;
		const target: Record<string, unknown> = {};
		const p = create(target, { callback: (r) => records.push(r) });
		Object.defineProperty(p, 'x', {
			set: (v) => { received = v; },
			configurable: true,
		});

		(p as Improbability).x = { val: 1 };

		assert.ok(isFlugrekorder(received as object), 'value received by setter is proxied');
	});

	test('getOwnPropertyDescriptor: accessor descriptor get/set are proxied in the returned descriptor', () => {
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
		assert.ok(isFlugrekorder(desc.get!), 'get in returned descriptor is proxied');
		// biome-ignore lint/style/noNonNullAssertion: same
		assert.ok(isFlugrekorder(desc.set!), 'set in returned descriptor is proxied');
	});

	test('defineProperty with only flag changes (no value/get/set) passes the descriptor through unchanged', () => {
		const records: Rekording[] = [];
		const target = { x: 1 };
		const p = create(target, { callback: (r) => records.push(r) });

		Object.defineProperty(p, 'x', { configurable: true, writable: true });

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
});

// ─── promise ─────────────────────────────────────────────────────────────────

describe('promise', () => {
	test('async function: resolved value is proxied', async () => {
		const p = create({ fetch: async () => ({ id: 1 }) }, { callback: () => {} });

		const result = await p.fetch();

		assert.ok(isFlugrekorder(result), 'resolved value is a proxy');
		assert.strictEqual(
			(result as Improbability).id,
			1,
			'resolved value is accessible through the proxy',
		);
	});

	test('async function: resolved primitive is returned as-is', async () => {
		const p = create({ getCount: async () => 42 }, { callback: () => {} });

		assert.strictEqual(await p.getCount(), 42, 'primitive resolved value is returned unchanged');
	});

	test('Promise property: awaiting a proxied Promise resolves correctly', async () => {
		const p = create(
			{ data: Promise.resolve({ name: 'alice' }) },
			{ callback: () => {} },
		);

		const result = await p.data;

		assert.ok(isFlugrekorder(result), 'resolved value of a Promise property is proxied');
		assert.strictEqual((result as Improbability).name, 'alice', 'data is accessible');
	});

	test('Promise stability: the same Promise always resolves to the same proxy', async () => {
		const inner = { v: 1 };
		const p = create(
			{ a: Promise.resolve(inner), b: Promise.resolve(inner) },
			{ callback: () => {} },
		);

		const [a, b] = await Promise.all([p.a, p.b]);

		assert.strictEqual(a, b, 'same resolved object yields the same proxy');
	});
});

// ─── helpers ─────────────────────────────────────────────────────────────────

describe('helpers', () => {
	test('getOrigin, getAncestors, getPath compose correctly over a deep chain', () => {
		const p = create(
			{ a: { b: { fn: () => ({ v: 1 }) } } },
			{ callback: () => {} },
		);
		const result = p.a.b.fn();

		assert.strictEqual(getPath(result), 'a.b.fn()');

		const ancestors = getAncestors(result);
		assert.strictEqual(ancestors.length, 5, 'root + a + b + fn + fn() = 5 entries');
		assert.strictEqual(ancestors[0].origin, null, 'root has null origin');
	});

	test('getTarget round-trips through a nested proxy', () => {
		const inner = { x: 42 };
		const p = create({ inner }, { callback: () => {} });
		const proxiedInner = p.inner;

		assert.strictEqual(getTarget(proxiedInner), inner, 'getTarget recovers the original inner object');
	});

	test('getProxyById resolves IDs from stream records', () => {
		const { Writable } = require('node:stream');
		const lines: string[] = [];
		let buf = '';
		const stream = new Writable({
			write(chunk: Buffer, _enc: unknown, cb: () => void) {
				buf += chunk.toString();
				const parts = buf.split('\n');
				buf = parts.pop() ?? '';
				lines.push(...parts.filter(Boolean));
				cb();
			},
		});

		const p = create({ a: { v: 1 } }, { stream });
		p.a;

		const rec = lines.map((l) => JSON.parse(l)).find((r: Improbability) => r.trap === 'get');
		const id = rec?.result?.$proxy;
		assert.ok(id, 'a $proxy ID appears in the stream output');

		const retrieved = getProxyById(id, p);
		assert.ok(isFlugrekorder(retrieved), 'retrieved by ID is a proxy');
		assert.strictEqual(retrieved, p.a, 'retrieved proxy is the same instance');
	});
});
