import assert from 'node:assert/strict';
import { test } from 'node:test';
import { each } from 'template-literal-each';
import { create, format } from './flugrekorder';

// biome-ignore lint/suspicious/noExplicitAny: Improbability is the intentional escape hatch for test assertions that cannot be typed otherwise
type Improbability = any;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function record(fn: (proxy: Improbability) => void) {
	const records: Array<Improbability> = [];
	const target = {
		port: 5432,
		find: function (q: unknown) {
			return [q];
		},
		nested: { value: 1 },
	};
	const proxy = create(target, { callback: (r) => records.push(r) });
	fn(proxy);
	return { records, proxy };
}

// ─── Returns a non-empty string for every trap type ───────────────────────────

test('format: returns a non-empty string for every trap type without throwing', () => {
	// arrange
	const { records, proxy } = record((p) => {
		p.port;
		p.port = 9999;
		p.find({ active: true });
		new (p.find as Improbability)();
		Object.defineProperty(p, 'x', { value: 1, configurable: true });
		Object.getOwnPropertyDescriptor(p, 'x');
		'port' in p;
	});

	// act
	// assert
	each`
		trap                       | record
		-------------------------- | -------
		get                        | ${records.find((r: Improbability) => r.trap === 'get')}
		set                        | ${records.find((r: Improbability) => r.trap === 'set')}
		apply                      | ${records.find((r: Improbability) => r.trap === 'apply')}
		construct                  | ${records.find((r: Improbability) => r.trap === 'construct')}
		defineProperty             | ${records.find((r: Improbability) => r.trap === 'defineProperty')}
		getOwnPropertyDescriptor   | ${records.find((r: Improbability) => r.trap === 'getOwnPropertyDescriptor')}
		has                        | ${records.find((r: Improbability) => r.trap === 'has')}
	`(({ trap, record: r }: Improbability) => {
		assert.ok(r, `${trap} record exists`);
		assert.doesNotThrow(() => format(r, proxy), `${trap} does not throw`);
		assert.ok(
			format(r, proxy).length > 0,
			`${trap} produces a non-empty string`,
		);
	});
});

// ─── Trap-specific formats ─────────────────────────────────────────────────────

test('format: set trap → "<path> = <value>"', () => {
	// arrange
	const { records, proxy } = record((p) => {
		p.port = 9999;
	});
	const r: Improbability = records.find(
		(r: Improbability) => r.trap === 'set',
	);

	// act
	// assert
	assert.strictEqual(format(r, proxy), 'port = 9999');
});

test('format: get trap → "<path> → <value>"', () => {
	const { records, proxy } = record((p) => {
		p.port;
	});
	const r: Improbability = records.find(
		(r: Improbability) => r.trap === 'get',
	);

	assert.strictEqual(format(r, proxy), 'port → 5432');
});

test('format: apply trap → "<path>(<args>)"', () => {
	// arrange
	const { records, proxy } = record((p) => {
		p.find({ active: true });
	});
	const r: Improbability = records.find(
		(r: Improbability) => r.trap === 'apply',
	);

	// act
	// assert
	assert.strictEqual(format(r, proxy), 'find({"active":true})');
});

test('format: construct trap → "new <path>(<args>)"', () => {
	// arrange
	const { records, proxy } = record((p) => {
		new (p.find as Improbability)(1, 2);
	});
	const r: Improbability = records.find(
		(r: Improbability) => r.trap === 'construct',
	);

	// act
	// assert
	assert.strictEqual(format(r, proxy), 'new find(1, 2)');
});

// ─── Proxy resolution ─────────────────────────────────────────────────────────

test('format: $proxy-tagged args resolve to paths when proxy is supplied', () => {
	// arrange
	const records: Array<Improbability> = [];
	const target = { a: { value: 1 }, fn: (x: unknown) => x };
	const proxy = create(target, { callback: (r) => records.push(r) });

	// act
	proxy.fn(proxy.a);

	// assert
	const apply: Improbability = records.find(
		(r: Improbability) => r.trap === 'apply',
	);
	assert.ok(apply, 'apply record exists');
	assert.strictEqual(format(apply, proxy), 'fn(a)');
});

test('format: without proxy, $proxy tags show raw IDs', () => {
	// arrange
	const records: Array<Improbability> = [];
	const target = { a: { value: 1 }, fn: (x: unknown) => x };
	const proxy = create(target, { callback: (r) => records.push(r) });

	// act
	proxy.fn(proxy.a);

	// assert
	const apply: Improbability = records.find(
		(r: Improbability) => r.trap === 'apply',
	);
	assert.ok(apply, 'apply record exists');

	const result = format(apply);
	assert.ok(result.includes('('), 'still formats as a call');
	assert.strictEqual(
		result.includes('a'),
		false,
		'path not resolved without proxy',
	);
});

// ─── $unwrap ──────────────────────────────────────────────────────────────────

test('format: $unwrap-tagged value renders with ↓ prefix', () => {
	// arrange
	// $unwrap appears when the real target (not the proxy) is captured in a
	// serialised arg — e.g. the unwrapped `this` in apply:native records.
	// format() must render it as ↓<path> regardless of where the tag appears.
	const rec: Improbability = {
		id: 'test-id',
		trap: 'set',
		origin: { trap: 'set', parent: 'root-id', key: 'x' },
		args: ['root-id', 'x', { $unwrap: { $proxy: 'proxy-id' } }, 'root-id'],
		result: true,
		timestamp: Date.now(),
	};

	// act
	// assert
	assert.ok(format(rec).includes('↓'), '$unwrap renders with ↓ prefix');
});

// ─── Truncation ───────────────────────────────────────────────────────────────

test('format: plain object argument exceeding 80 chars is truncated', () => {
	// arrange
	const records: Array<Improbability> = [];
	const target = { fn: (..._args: Array<unknown>) => null };
	const proxy = create(target, { callback: (r) => records.push(r) });
	// Large plain object not yet in graph — passed through `known` unchanged,
	// then inlined by serialize(), then truncated at 80 chars by display().
	const largeArg = Object.fromEntries(
		Array.from({ length: 10 }, (_, i) => [`key${i}`, `value${i}`]),
	);

	// act
	(proxy as Improbability).fn(largeArg);

	// assert
	const apply: Improbability = records.find(
		(r: Improbability) => r.trap === 'apply',
	);
	assert.ok(apply, 'apply record exists');
	const result = format(apply, proxy);
	assert.ok(result.includes('…'), 'long argument is truncated with ellipsis');
});

// ─── Null / undefined display ─────────────────────────────────────────────────

test('format: null get result displays as "null"', () => {
	// arrange
	const records: Array<Improbability> = [];
	const target = { x: null as unknown };
	const proxy = create(target, { callback: (r) => records.push(r) });

	// act
	proxy.x;

	// assert
	const get: Improbability = records.find(
		(r: Improbability) => r.trap === 'get',
	);
	assert.strictEqual(format(get, proxy), 'x → null');
});

// ─── Array display ────────────────────────────────────────────────────────────

test('format: array call argument is displayed in [...] notation', () => {
	// arrange
	const records: Array<Improbability> = [];
	const target = { fn: (..._args: Array<unknown>) => null };
	const proxy = create(target, { callback: (r) => records.push(r) });

	// act
	// Plain array is not in the graph — inlined by serialize(), displayed as [...]
	(proxy as Improbability).fn([1, 2, 3]);

	// assert
	const apply: Improbability = records.find(
		(r: Improbability) => r.trap === 'apply',
	);
	assert.ok(apply, 'apply record exists');
	assert.strictEqual(format(apply, proxy), 'fn([1, 2, 3])');
});

// ─── Unresolvable proxy ID ────────────────────────────────────────────────────

test('format: unresolvable proxy ID in origin falls back to raw ID', () => {
	// arrange
	// When a Rekording is formatted against a proxy that does not contain the
	// referenced ID (e.g. a record replayed against a different proxy), resolve()
	// must return the raw ID string rather than throwing.
	const proxy = create({ x: 1 }, { callback: () => {} });
	const rec: Improbability = {
		id: 'test-id',
		trap: 'get',
		origin: { trap: 'get', parent: 'unknown-id', key: 'x' },
		args: [],
		result: 1,
		timestamp: Date.now(),
	};

	// act
	const result = format(rec, proxy);

	// assert
	assert.ok(
		result.includes('unknown-id'),
		'raw ID used when proxy not found',
	);
});

// ─── Fallback ─────────────────────────────────────────────────────────────────

test('format: fallback → "<trap> on <id>" for traps with null origin', () => {
	// arrange
	const { records, proxy } = record((p) => {
		'port' in p;
	});
	const r: Improbability = records.find(
		(r: Improbability) => r.trap === 'has',
	);

	// act
	// assert
	assert.ok(
		format(r, proxy).startsWith('has on'),
		'fallback format for null-origin trap',
	);
});
