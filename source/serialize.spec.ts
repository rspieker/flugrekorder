import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { Graph } from './graph';
import type { SerialConfig } from './serialize';
import { defaults, serialize } from './serialize';

function cfg(overrides: Partial<SerialConfig>): SerialConfig {
	return { ...defaults, ...overrides };
}

describe('source/serialize', () => {
	describe('maxDepth', () => {
		test('nested objects beyond the limit are replaced with "[…]"', () => {
			// arrange
			const result = serialize(
				{ a: { b: 'deep' } },
				new Graph(0),
				new Set(),
				cfg({ maxDepth: 1 }),
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
				cfg({ maxDepth: 2 }),
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

	describe('combined maxDepth, redact, truncation', () => {
		test('serialization controls: maxDepth, redact, and truncate compose without error', () => {
			// arrange
			const result = serialize(
				{ secret: 'password', label: 'hello world', nested: { a: 1 } },
				new Graph(0),
				new Set(),
				cfg({
					maxDepth: 1,
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
	});
});
