import assert from 'node:assert/strict';
import { Writable } from 'node:stream';
import { describe, test } from 'node:test';
import { create } from '../source/flugrekorder.ts';
import {
	createTestProxyRecorder,
	type Improbability,
	isProxyTag,
} from './test-helpers.ts';

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
	// What a reader does: parse every line, and skip the session headers.
	const records = () =>
		lines
			.map((line) => JSON.parse(line))
			.filter((line) => !('$flugrekorder' in line));

	return { stream, lines, records };
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
		const aId = (getA.result as { $proxy: string }).$proxy;
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
		const fnId = (getFn.result as { $proxy: string }).$proxy;
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
			typeof (rec.origin as Improbability).key,
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
			const { stream, lines, records } = makeStream();
			const p = create({ x: 1, y: 2 }, { stream });

			// act
			p.x;
			p.y;

			// assert
			for (const line of lines) {
				assert.doesNotThrow(
					() => JSON.parse(line),
					'line is valid JSON',
				);
			}
			assert.ok(
				records().length >= 2,
				`at least two records written (got ${records().length})`,
			);
			for (const rec of records()) {
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
			const { stream, records } = makeStream();
			const p = create({ a: { b: () => ({ v: 1 }) } }, { stream });

			// act
			p.a.b();

			// assert
			for (const rec of records()) {
				assert.doesNotThrow(
					() => JSON.stringify(rec),
					`record ${rec.id} is fully serialisable`,
				);
			}
		});

		test('origins contain only string IDs (no live references)', () => {
			// arrange
			const { stream, records } = makeStream();
			const p = create({ a: { b: 1 }, fn: () => 'x' }, { stream });

			// act
			p.a.b;
			p.fn();

			// assert
			for (const rec of records()) {
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

		test('a bigint is written as a $bigint tag instead of making JSON.stringify throw', () => {
			// arrange
			const { stream, records } = makeStream();
			const p = create(
				{ big: 42n, fn: (n: bigint) => n * 2n },
				{ stream, only: ['get', 'apply'] },
			);

			// act
			const big = p.big;
			const doubled = p.fn(7n);

			// assert
			assert.strictEqual(big, 42n, 'the application gets the bigint');
			assert.strictEqual(doubled, 14n);
			const [read, , call] = records();
			assert.deepStrictEqual(read.result, { $bigint: '42' });
			assert.deepStrictEqual(call.args[2], [{ $bigint: '7' }]);
			assert.deepStrictEqual(call.result, { $bigint: '14' });
		});

		test('timestamp is present and numeric in NDJSON output', () => {
			// arrange
			const { stream, records } = makeStream();
			const p = create({ x: 1 }, { stream });

			// act
			p.x;

			// assert
			const [rec] = records();
			assert.strictEqual(
				typeof rec.timestamp,
				'number',
				'timestamp is a number in NDJSON',
			);
		});
	});

	describe('stream header', () => {
		const header = { $flugrekorder: { format: '2.0' } };

		test('a session starts with the format its records follow', () => {
			// arrange
			const { stream, lines } = makeStream();
			const p = create({ x: 1 }, { stream });

			// act
			p.x;

			// assert
			assert.deepStrictEqual(JSON.parse(lines[0]), header);
			assert.strictEqual(
				lines.slice(1).every((line) => 'trap' in JSON.parse(line)),
				true,
				'every line after the header is a record',
			);
		});

		test('the header is written when the session starts, before anything is recorded', () => {
			// arrange
			const { stream, lines } = makeStream();

			// act
			create({ x: 1 }, { stream });

			// assert
			assert.deepStrictEqual(
				lines.map((line) => JSON.parse(line)),
				[header],
			);
		});

		test('every session writes its own header, so a shared stream shows where each starts', () => {
			// arrange
			const { stream, lines } = makeStream();
			const first = create(
				{ x: 1 },
				{ stream, id: () => `a${lines.length}` },
			);
			first.x;
			const second = create(
				{ y: 2 },
				{ stream, id: () => `b${lines.length}` },
			);

			// act
			second.y;

			// assert
			assert.deepStrictEqual(
				lines.map((line) => {
					const parsed = JSON.parse(line);
					return '$flugrekorder' in parsed ? 'header' : parsed.id[0];
				}),
				['header', 'a', 'header', 'b'],
			);
		});

		test('a callback receives records only', () => {
			// arrange
			const received: Array<unknown> = [];

			// act
			create({ x: 1 }, { callback: (r) => received.push(r) });

			// assert
			assert.deepStrictEqual(received, []);
		});
	});
});
