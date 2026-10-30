import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
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
