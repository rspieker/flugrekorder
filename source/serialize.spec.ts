import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import fc from 'fast-check';
import { each } from 'template-literal-each';
import type { Improbability } from '../test/test-helpers.ts';
import { Graph } from './graph.ts';
import type { SerialConfig } from './serialize.ts';
import { args, defaults, result, serialize } from './serialize.ts';

function cfg(overrides: Partial<SerialConfig>): SerialConfig {
	return { ...defaults, ...overrides };
}

describe('source/serialize', () => {
	describe('depth', () => {
		test('nested objects beyond the limit are replaced with "[…]"', () => {
			// arrange
			const result = serialize(
				{ a: { b: 'deep' } },
				new Graph(0),
				new Set(),
				cfg({ depth: 1 }),
			) as Record<string, unknown>;

			// act
			// assert
			assert.strictEqual(result.a, '[…]');
		});

		test('values within the limit are serialized normally', () => {
			// arrange
			const result = serialize(
				{ a: { b: 'hi' } },
				new Graph(0),
				new Set(),
				cfg({ depth: 2 }),
			) as Record<string, unknown>;

			// act
			// assert
			assert.strictEqual((result.a as Record<string, unknown>)?.b, 'hi');
		});
	});

	describe('redact', () => {
		test('returning true replaces the value with "[redacted]"', () => {
			// arrange
			const result = serialize(
				{ password: 'secret', user: 'alice' },
				new Graph(0),
				new Set(),
				cfg({ redactors: [(key) => key === 'password'] }),
			) as Record<string, unknown>;

			// act
			// assert
			assert.strictEqual(result.password, '[redacted]');
			assert.strictEqual(result.user, 'alice');
		});

		test('returning a string uses it as the replacement', () => {
			// arrange
			const result = serialize(
				{ token: 'abc123' },
				new Graph(0),
				new Set(),
				cfg({
					redactors: [
						(key) => (key === 'token' ? '[redacted:token]' : false),
					],
				}),
			) as Record<string, unknown>;

			// act
			// assert
			assert.strictEqual(result.token, '[redacted:token]');
		});

		test('returning null drops the key entirely', () => {
			// arrange
			const result = serialize(
				{ internal: 'data', visible: 'yes' },
				new Graph(0),
				new Set(),
				cfg({
					redactors: [(key) => (key === 'internal' ? null : false)],
				}),
			) as Record<string, unknown>;

			// act
			// assert
			assert.strictEqual('internal' in result, false);
			assert.strictEqual(result.visible, 'yes');
		});

		test('multiple redactors — first non-false result wins', () => {
			// arrange
			const result = serialize(
				{ password: 'secret', token: 'abc', user: 'alice' },
				new Graph(0),
				new Set(),
				cfg({
					redactors: [
						(key) =>
							key === 'password' ? '[redacted:password]' : false,
						(key) => (key === 'token' ? '[redacted:token]' : false),
					],
				}),
			) as Record<string, unknown>;

			// act
			// assert
			assert.strictEqual(result.password, '[redacted:password]');
			assert.strictEqual(result.token, '[redacted:token]');
			assert.strictEqual(result.user, 'alice');
		});

		test('receives value and target as context', () => {
			// arrange
			const calls: Array<{
				key: unknown;
				value: unknown;
				target: unknown;
			}> = [];
			const input = { port: 5432 };

			// act
			serialize(
				input,
				new Graph(0),
				new Set(),
				cfg({
					redactors: [
						(key, value, target) => {
							calls.push({ key, value, target });
							return false;
						},
					],
				}),
			);

			// assert
			assert.ok(calls.length > 0, 'redactor called');
			assert.strictEqual(calls[0].key, 'port');
			assert.strictEqual(calls[0].value, 5432);
			assert.strictEqual(calls[0].target, input);
		});
	});

	describe('truncate', () => {
		test('strings longer than the limit are truncated with "…"', () => {
			// arrange
			const result = serialize(
				'hello world',
				new Graph(0),
				new Set(),
				cfg({ truncate: 5 }),
			);

			// act
			// assert
			assert.strictEqual(result, 'hello…');
		});

		test('strings within the limit are kept as-is', () => {
			// arrange
			const result = serialize(
				'short',
				new Graph(0),
				new Set(),
				cfg({ truncate: 10 }),
			);

			// act
			// assert
			assert.strictEqual(result, 'short');
		});
	});

	describe('combined depth, redact, truncation', () => {
		test('serialization controls: depth, redact, and truncate compose without error', () => {
			// arrange
			const result = serialize(
				{ secret: 'password', label: 'hello world', nested: { a: 1 } },
				new Graph(0),
				new Set(),
				cfg({
					depth: 1,
					redactors: [(key) => key === 'secret'],
					truncate: 5,
				}),
			) as Record<string, unknown>;

			// act
			// assert
			assert.strictEqual(result.secret, '[redacted]');
			assert.strictEqual(result.label, 'hello…');
			assert.strictEqual(result.nested, '[…]');
		});
	});

	describe('references', () => {
		test('circular references are serialised as { $proxy: "?" }', () => {
			// arrange
			const circular: Record<string, unknown> = {};

			// act
			// assert
			circular.self = circular;
			const result = serialize(circular, new Graph(0)) as Record<
				string,
				unknown
			>;
			assert.deepStrictEqual(result.self, { $proxy: '?' });
		});

		test('an array that contains itself is serialised as { $proxy: "?" }', () => {
			// arrange
			const circular: Array<unknown> = [1];
			circular.push(circular);

			// act
			const result = serialize(circular, new Graph(0));

			// assert
			assert.deepStrictEqual(result, [1, { $proxy: '?' }]);
		});

		test('an array and an object that contain each other are serialised as { $proxy: "?" }', () => {
			// arrange
			const list: Array<unknown> = [];
			const object = { list };
			list.push(object);

			// act
			const result = serialize(list, new Graph(0));

			// assert
			assert.deepStrictEqual(result, [{ list: { $proxy: '?' } }]);
		});

		test('a value referenced twice without a cycle is serialised in full both times', () => {
			// arrange
			const shared = [1, 2];

			// act
			const result = serialize({ a: shared, b: [shared] }, new Graph(0));

			// assert
			assert.deepStrictEqual(result, { a: [1, 2], b: [[1, 2]] });
		});
	});

	describe('values JSON cannot hold', () => {
		test('a bigint is tagged with its decimal digits', () => {
			// arrange
			each<{ value: bigint; label: string }>`
				value          | label
				-------------- | ----------------------------
				${42n}         | positive
				${-7n}         | negative
				${2n ** 64n}   | beyond Number.MAX_SAFE_INTEGER
			`(({ value, label }) => {
				// act
				const serialized = serialize(value, new Graph(0));

				// assert
				assert.deepStrictEqual(
					serialized,
					{ $bigint: String(value) },
					label,
				);
				assert.strictEqual(
					BigInt((serialized as { $bigint: string }).$bigint),
					value,
					`${label} reads back as the same bigint`,
				);
			});
		});

		const plain = (v: unknown) => serialize(v, new Graph(0));

		test('numbers JSON cannot write are tagged by their text', () => {
			// arrange
			each<{ value: number; text: string }>`
				value          | text
				-------------- | ----------
				${Number.NaN}  | NaN
				${Infinity}    | Infinity
				${-Infinity}   | -Infinity
				${-0}          | -0
			`(({ value, text }) => {
				// act
				// assert
				assert.deepStrictEqual(plain(value), { $number: text }, text);
			});
		});

		test('other numbers stay numbers', () => {
			// arrange
			each<{ value: number; label: string }>`
				value                      | label
				-------------------------- | -------------
				${0}                       | zero
				${-1.5}                    | negative
				${Number.MAX_SAFE_INTEGER} | large
			`(({ value, label }) => {
				// act
				// assert
				assert.strictEqual(plain(value), value, label);
			});
		});

		test('a symbol is tagged by its description', () => {
			// arrange
			// act
			// assert
			assert.deepStrictEqual(plain(Symbol('s')), { $symbol: 's' });
			assert.deepStrictEqual(plain(Symbol()), { $symbol: '' });
		});

		test('undefined is tagged inside a value, including holes in an array', () => {
			// arrange
			// act
			// assert
			assert.deepStrictEqual(plain(undefined), { $undefined: true });
			const holey: Array<unknown> = [1, undefined];
			holey[3] = 4; // index 2 is a hole
			assert.deepStrictEqual(plain(holey), [
				1,
				{ $undefined: true },
				{ $undefined: true },
				4,
			]);
			assert.deepStrictEqual(plain({ a: undefined }), {
				a: { $undefined: true },
			});
		});

		test('an undefined result stays undefined: a missing result means undefined', () => {
			// arrange
			// act
			// assert
			assert.strictEqual(
				result('apply', undefined, new Graph(0), defaults),
				undefined,
			);
		});

		test('built-ins that hold a single value are tagged by type', () => {
			// arrange
			each<{
				value: Improbability;
				expected: Improbability;
				label: string;
			}>`
				value                                | expected                                                       | label
				------------------------------------ | -------------------------------------------------------------- | -------------
				${new Date('2026-10-31T00:00:00Z')}  | ${{ $date: '2026-10-31T00:00:00.000Z' }}                       | Date
				${new Date('nope')}                  | ${{ $date: 'Invalid Date' }}                                   | invalid Date
				${/a+/gi}                            | ${{ $regexp: { source: 'a+', flags: 'gi' } }}                  | RegExp
				${new TypeError('boom')}             | ${{ $error: { name: 'TypeError', message: 'boom' } }}          | Error
				${new URL('https://x.test/a?b=1')}   | ${{ $url: 'https://x.test/a?b=1' }}                            | URL
				${function named() {}}               | ${{ $function: 'named' }}                                      | function
				${new WeakMap()}                     | ${{ $weakmap: null }}                                          | WeakMap
				${new WeakSet()}                     | ${{ $weakset: null }}                                          | WeakSet
			`(({ value, expected, label }) => {
				// act
				// assert
				assert.deepStrictEqual(plain(value), expected, label);
			});
		});

		test('binary data is tagged with its type and its bytes as base64', () => {
			// arrange
			const bytes = [104, 105];
			each<{ value: Improbability; type: string }>`
				value                                         | type
				--------------------------------------------- | -----------
				${new Uint8Array(bytes)}                      | Uint8Array
				${Buffer.from(bytes)}                         | Buffer
				${new Uint8Array(bytes).buffer}               | ArrayBuffer
				${new DataView(new Uint8Array(bytes).buffer)} | DataView
			`(({ value, type }) => {
				// act
				// assert
				assert.deepStrictEqual(
					plain(value),
					{ $binary: { type, base64: 'aGk=' } },
					type,
				);
			});
		});

		test('a view only covers its own bytes, not the whole buffer', () => {
			// arrange
			const view = new Uint8Array([0, 104, 105, 0]).subarray(1, 3);

			// act
			// assert
			assert.deepStrictEqual(plain(view), {
				$binary: { type: 'Uint8Array', base64: 'aGk=' },
			});
		});

		test('base64 is truncated like any other string', () => {
			// arrange
			// act
			const serialized = serialize(
				new Uint8Array(30),
				new Graph(0),
				new Set(),
				cfg({ truncate: 8 }),
			);

			// assert
			assert.deepStrictEqual(serialized, {
				$binary: { type: 'Uint8Array', base64: 'AAAAAAAA…' },
			});
		});

		test('Map and Set keep their entries, serialized like any other value', () => {
			// arrange
			const when = new Date(0);

			// act
			// assert
			assert.deepStrictEqual(
				plain(
					new Map<unknown, unknown>([
						['k', when],
						[1n, { a: 1 }],
					]),
				),
				{
					$map: [
						['k', { $date: '1970-01-01T00:00:00.000Z' }],
						[{ $bigint: '1' }, { a: 1 }],
					],
				},
			);
			assert.deepStrictEqual(plain(new Set([1, 'two'])), {
				$set: [1, 'two'],
			});
		});

		test('a Map that contains itself is cut like any other circular value', () => {
			// arrange
			const map = new Map<string, unknown>();
			map.set('self', map);

			// act
			// assert
			assert.deepStrictEqual(plain(map), {
				$map: [['self', { $proxy: '?' }]],
			});
		});

		test('depth limits Map and Set like objects, but not single-value built-ins', () => {
			// arrange
			const shallow = cfg({ depth: 1 });
			const value = {
				map: new Map([['k', 1]]),
				date: new Date(0),
			};

			// act
			const serialized = serialize(
				value,
				new Graph(0),
				new Set(),
				shallow,
			);

			// assert
			assert.deepStrictEqual(serialized, {
				map: '[…]',
				date: { $date: '1970-01-01T00:00:00.000Z' },
			});
		});

		test('any value comes out of a JSON round trip unchanged (property)', () => {
			// arrange
			// act
			// assert
			fc.assert(
				fc.property(
					fc.anything({
						withBigInt: true,
						withDate: true,
						withMap: true,
						withSet: true,
						withTypedArray: true,
						withSparseArray: true,
						withNullPrototype: true,
						withBoxedValues: true,
					}),
					(value) => {
						const serialized = plain(value);

						assert.deepStrictEqual(
							JSON.parse(JSON.stringify(serialized)),
							serialized,
						);
					},
				),
			);
		});
	});

	describe('values: false', () => {
		const omit = cfg({ values: false });

		test('a value is described by its typeof', () => {
			// arrange
			each<{ value: Improbability; label: string }>`
				value                | label
				-------------------- | ---------
				${undefined}         | undefined
				${'secret'}          | string
				${5432}              | number
				${true}              | boolean
				${42n}               | bigint
				${Symbol('s')}       | symbol
				${{ password: 'x' }} | object
				${() => 'x'}         | function
			`(({ value, label }) => {
				// act
				// assert
				assert.deepStrictEqual(
					serialize(value, new Graph(0), new Set(), omit),
					{ $omitted: typeof value },
					label,
				);
			});
		});

		test('null is described as null', () => {
			// arrange
			// act
			// assert
			assert.deepStrictEqual(
				serialize(null, new Graph(0), new Set(), omit),
				{ $omitted: 'null' },
			);
		});

		test('an array is described by its length', () => {
			// arrange
			each<{ value: Array<unknown>; label: string }>`
				value                 | label
				--------------------- | ------------------------
				${[]}                 | empty
				${[1, 'two', {}]}     | mixed — elements are not read
			`(({ value, label }) => {
				// act
				// assert
				assert.deepStrictEqual(
					serialize(value, new Graph(0), new Set(), omit),
					{ $omitted: `Array<${value.length}>` },
					label,
				);
			});
		});

		test('binary data is described by its type and length', () => {
			// arrange
			each<{ value: Improbability; description: string }>`
				value                                | description
				------------------------------------ | -------------------
				${new Uint8Array(32)}                | Uint8Array<32>
				${new Float64Array(4)}               | Float64Array<4>
				${new ArrayBuffer(16)}               | ArrayBuffer<16>
				${new DataView(new ArrayBuffer(8))}  | DataView<8>
			`(({ value, description }) => {
				// act
				// assert
				assert.deepStrictEqual(
					serialize(value, new Graph(0), new Set(), omit),
					{ $omitted: description },
					description,
				);
			});
		});

		test('references remain: a proxy by its ID, a known target by the ID of its proxy', () => {
			// arrange
			const graph = new Graph(0);
			const target = { secret: 'x' };
			const proxy = new Proxy(target, {});
			graph.register(proxy, target, null, graph.nextId());

			// act
			// assert
			assert.deepStrictEqual(serialize(proxy, graph, new Set(), omit), {
				$proxy: '#1',
			});
			assert.deepStrictEqual(serialize(target, graph, new Set(), omit), {
				$unwrap: { $proxy: '#1' },
			});
		});

		test('the key of a property trap remains', () => {
			// arrange
			const target = {};

			// act
			// assert
			assert.deepStrictEqual(
				args('set', [target, 'port', 5433, target], new Graph(0), omit),
				[
					{ $omitted: 'object' },
					'port',
					{ $omitted: 'number' },
					{ $omitted: 'object' },
				],
			);
		});

		test('a call keeps one entry per argument', () => {
			// arrange
			const fn = () => {};

			// act
			// assert
			each<{ trap: string; list: Array<unknown> }>`
				trap              | list
				----------------- | --------------------------------------
				apply             | ${[fn, null, [{ active: true }, 2]]}
				apply:native      | ${[fn, null, [{ active: true }, 2]]}
				construct         | ${[fn, [{ active: true }, 2], fn]}
			`(({ trap, list }) => {
				const listed = args(trap, list, new Graph(0), omit);
				const index = trap === 'construct' ? 1 : 2;

				assert.deepStrictEqual(
					listed[index],
					[{ $omitted: 'object' }, { $omitted: 'number' }],
					trap,
				);
			});
		});

		test('the keys ownKeys lists remain', () => {
			// arrange
			// act
			// assert
			assert.deepStrictEqual(
				result('ownKeys', ['port', 'host'], new Graph(0), omit),
				['port', 'host'],
			);
		});

		test('values are serialized as before by default', () => {
			// arrange
			// act
			// assert
			assert.deepStrictEqual(
				args('set', [{}, 'port', 5433], new Graph(0), defaults),
				[{}, 'port', 5433],
			);
		});
	});
});
