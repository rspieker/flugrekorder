import { test } from 'node:test';
import assert from 'node:assert/strict';
import { each } from 'template-literal-each';
import { create, format } from './flugrekorder';

// biome-ignore lint/suspicious/noExplicitAny: Improbability is the intentional escape hatch for test assertions that cannot be typed otherwise
type Improbability = any;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function record(fn: (proxy: Improbability) => void) {
	const records: Improbability[] = [];
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
	const { records, proxy } = record((p) => {
		p.port;
		p.port = 9999;
		p.find({ active: true });
		new (p.find as Improbability)();
		Object.defineProperty(p, 'x', { value: 1, configurable: true });
		Object.getOwnPropertyDescriptor(p, 'x');
		'port' in p;
	});

	each`
	trap                       | record
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
	const { records, proxy } = record((p) => {
		p.port = 9999;
	});
	const r: Improbability = records.find(
		(r: Improbability) => r.trap === 'set',
	);

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
	const { records, proxy } = record((p) => {
		p.find({ active: true });
	});
	const r: Improbability = records.find(
		(r: Improbability) => r.trap === 'apply',
	);

	assert.strictEqual(format(r, proxy), 'find({"active":true})');
});

test('format: construct trap → "new <path>(<args>)"', () => {
	const { records, proxy } = record((p) => {
		new (p.find as Improbability)(1, 2);
	});
	const r: Improbability = records.find(
		(r: Improbability) => r.trap === 'construct',
	);

	assert.strictEqual(format(r, proxy), 'new find(1, 2)');
});

// ─── Proxy resolution ─────────────────────────────────────────────────────────

test('format: $proxy-tagged args resolve to paths when proxy is supplied', () => {
	const records: Improbability[] = [];
	const target = { a: { value: 1 }, fn: (x: unknown) => x };
	const proxy = create(target, { callback: (r) => records.push(r) });

	proxy.fn(proxy.a);

	const apply: Improbability = records.find(
		(r: Improbability) => r.trap === 'apply',
	);
	assert.ok(apply, 'apply record exists');
	assert.strictEqual(format(apply, proxy), 'fn(a)');
});

test('format: without proxy, $proxy tags show raw IDs', () => {
	const records: Improbability[] = [];
	const target = { a: { value: 1 }, fn: (x: unknown) => x };
	const proxy = create(target, { callback: (r) => records.push(r) });

	proxy.fn(proxy.a);

	const apply: Improbability = records.find(
		(r: Improbability) => r.trap === 'apply',
	);
	assert.ok(apply, 'apply record exists');

	const result = format(apply);
	assert.ok(result.includes('('), 'still formats as a call');
	assert.strictEqual(result.includes('a'), false, 'path not resolved without proxy');
});

// ─── Fallback ─────────────────────────────────────────────────────────────────

test('format: fallback → "<trap> on <id>" for traps with null origin', () => {
	const { records, proxy } = record((p) => {
		'port' in p;
	});
	const r: Improbability = records.find(
		(r: Improbability) => r.trap === 'has',
	);

	assert.ok(
		format(r, proxy).startsWith('has on'),
		'fallback format for null-origin trap',
	);
});
