import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Writable } from 'node:stream';
import { create, type Rekording } from '../source/flugrekorder';

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

// ─── $proxy tags and primitive inlining ───────────────────────────────────────

test('proxiable results are serialised as $proxy tags', () => {
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
	assert.ok(rec, 'get record found');
	assert.ok(isProxyTag(rec?.result), 'result is a $proxy tag');
	assert.strictEqual(
		typeof (rec?.result as { $proxy: string }).$proxy,
		'string',
		'$proxy is a string',
	);
});

test('primitive results are inlined in the rekording', () => {
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
	assert.ok(rec, 'get record found');
	assert.strictEqual(rec?.result, 7, 'primitive result is inlined');
});

test('proxy IDs are consistent: result.$proxy matches origin.parent of child records', () => {
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
	const records: Rekording[] = [];
	const sym = Symbol('myKey');
	const target = { [sym]: 'value' };
	const p = create(target, { callback: (r) => records.push(r) });
	p[sym];
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

// ─── Timestamp ────────────────────────────────────────────────────────────────

test('every rekording has a numeric timestamp', () => {
	const records: Rekording[] = [];
	const p = create({ x: 1 }, { callback: (r) => records.push(r) });
	p.x;
	assert.strictEqual(typeof records[0].timestamp, 'number', 'timestamp is a number');
});

test('timestamps are monotonically non-decreasing across sequential traps', () => {
	const records: Rekording[] = [];
	const p = create({ a: 1, b: 2, c: 3 }, { callback: (r) => records.push(r) });
	p.a;
	p.b;
	p.c;
	for (let i = 1; i < records.length; i++) {
		assert.ok(
			records[i].timestamp >= records[i - 1].timestamp,
			`record ${i} timestamp >= record ${i - 1} timestamp`,
		);
	}
});

// ─── Stream sink ──────────────────────────────────────────────────────────────

test('stream sink: writes valid NDJSON', () => {
	const { stream, lines } = makeStream();
	const p = create({ x: 1, y: 2 }, { stream });
	p.x;
	p.y;
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
	const { stream, lines } = makeStream();
	const p = create({ a: { b: () => ({ v: 1 }) } }, { stream });
	p.a.b();
	for (const line of lines) {
		const rec = JSON.parse(line);
		assert.doesNotThrow(
			() => JSON.stringify(rec),
			`record ${rec.id} is fully serialisable`,
		);
	}
});

test('stream sink: origins contain only string IDs (no live references)', () => {
	const { stream, lines } = makeStream();
	const p = create({ a: { b: 1 }, fn: () => 'x' }, { stream });
	p.a.b;
	p.fn();
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

test('stream sink: timestamp is present and numeric in NDJSON output', () => {
	const { stream, lines } = makeStream();
	const p = create({ x: 1 }, { stream });
	p.x;
	const rec = JSON.parse(lines[0]);
	assert.strictEqual(typeof rec.timestamp, 'number', 'timestamp is a number in NDJSON');
});
