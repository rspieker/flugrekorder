import assert from 'node:assert/strict';
import { Writable } from 'node:stream';
import { describe, test } from 'node:test';
import { create } from '../source/flugrekorder';
import {
	createTestProxyRecorder,
	type Improbability,
	isProxyTag,
} from './test-helpers';

function makeStream() {
	const lines: Array<string> = [];
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

describe('test/recording', () => {
	test('proxiable results are serialised as $proxy tags', () => {
		// arrange
		// act
		const { records } = createTestProxyRecorder({ obj: { v: 1 } }, (p) => {
			p.obj;
		});

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
			typeof rec?.result.$proxy,
			'string',
			'$proxy is a string',
		);
	});

	test('primitive results are inlined in the rekording', () => {
		// arrange
		// act
		const { records } = createTestProxyRecorder({ n: 7 }, (p) => {
			p.n;
		});

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
		// act
		const { records } = createTestProxyRecorder({ a: { b: 1 } }, (p) => {
			p.a.b;
		});

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
		assert.strictEqual(
			aId,
			bParent,
			"a's result.$proxy === b's origin.parent",
		);
	});

	test('apply origin.source matches the $proxy ID of the accessed function', () => {
		// arrange
		// act
		const { records } = createTestProxyRecorder({ fn: () => 'ok' }, (p) => {
			p.fn();
		});

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
		// act
		const sym = Symbol('myKey');
		const { records } = createTestProxyRecorder({ [sym]: 'value' }, (p) => {
			p[sym];
		});

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

	describe('timestamp', () => {
		test('every rekording has a numeric timestamp', () => {
			// arrange
			// act
			const { records } = createTestProxyRecorder({ x: 1 }, (p) => {
				p.x;
			});

			// assert
			assert.strictEqual(
				typeof records[0].timestamp,
				'number',
				'timestamp is a number',
			);
		});

		test('timestamps are monotonically non-decreasing across sequential traps', () => {
			// arrange
			// act
			const { records } = createTestProxyRecorder(
				{ a: 1, b: 2, c: 3 },
				(p) => {
					p.a;
					p.b;
					p.c;
				},
			);

			// assert
			for (let i = 1; i < records.length; i++) {
				assert.ok(
					records[i].timestamp >= records[i - 1].timestamp,
					`record ${i} timestamp >= record ${i - 1} timestamp`,
				);
			}
		});
	});

	describe('stream sink', () => {
		test('writes valid NDJSON', () => {
			// arrange
			const { stream, lines } = makeStream();
			const p = create({ x: 1, y: 2 }, { stream });

			// act
			p.x;
			p.y;

			// assert
			assert.ok(
				lines.length >= 2,
				`at least two lines written (got ${lines.length})`,
			);
			for (const line of lines) {
				assert.doesNotThrow(
					() => JSON.parse(line),
					'line is valid JSON',
				);
				const rec = JSON.parse(line);
				assert.strictEqual(typeof rec.id, 'string', 'id is a string');
				assert.strictEqual(
					typeof rec.trap,
					'string',
					'trap is a string',
				);
				assert.ok('origin' in rec, 'origin field present');
				assert.ok(Array.isArray(rec.args), 'args is an array');
				assert.ok('result' in rec, 'result field present');
			}
		});

		test('every record round-trips through JSON.stringify', () => {
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

		test('origins contain only string IDs (no live references)', () => {
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
					assert.strictEqual(
						typeof rec.origin.key,
						'string',
						'origin.key is a string',
					);
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

		test('timestamp is present and numeric in NDJSON output', () => {
			// arrange
			const { stream, lines } = makeStream();
			const p = create({ x: 1 }, { stream });

			// act
			p.x;

			// assert
			const rec = JSON.parse(lines[0]);
			assert.strictEqual(
				typeof rec.timestamp,
				'number',
				'timestamp is a number in NDJSON',
			);
		});
	});
});
