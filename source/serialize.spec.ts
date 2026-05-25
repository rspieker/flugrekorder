import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { SerialConfig } from "./serialize";
import { Graph } from "./graph";
import { defaults, serialize } from "./serialize";

function cfg(overrides: Partial<SerialConfig>): SerialConfig {
	return { ...defaults, ...overrides };
}

// ─── maxDepth ─────────────────────────────────────────────────────────────────

test('maxDepth: nested objects beyond the limit are replaced with "[…]"', () => {
	const result = serialize(
		{ a: { b: "deep" } },
		new Graph(0),
		new Set(),
		cfg({ maxDepth: 1 }),
	) as Record<string, unknown>;

	assert.strictEqual(result.a, "[…]");
});

test("maxDepth: values within the limit are serialized normally", () => {
	const result = serialize(
		{ a: { b: "hi" } },
		new Graph(0),
		new Set(),
		cfg({ maxDepth: 2 }),
	) as Record<string, unknown>;

	assert.strictEqual((result.a as Record<string, unknown>)?.b, "hi");
});

// ─── redact ───────────────────────────────────────────────────────────────────

test('redact: returning true replaces the value with "[redacted]"', () => {
	const result = serialize(
		{ password: "secret", user: "alice" },
		new Graph(0),
		new Set(),
		cfg({ redactors: [(key) => key === "password"] }),
	) as Record<string, unknown>;

	assert.strictEqual(result.password, "[redacted]");
	assert.strictEqual(result.user, "alice");
});

test("redact: returning a string uses it as the replacement", () => {
	const result = serialize(
		{ token: "abc123" },
		new Graph(0),
		new Set(),
		cfg({
			redactors: [
				(key) => (key === "token" ? "[redacted:token]" : false),
			],
		}),
	) as Record<string, unknown>;

	assert.strictEqual(result.token, "[redacted:token]");
});

test("redact: returning null drops the key entirely", () => {
	const result = serialize(
		{ internal: "data", visible: "yes" },
		new Graph(0),
		new Set(),
		cfg({ redactors: [(key) => (key === "internal" ? null : false)] }),
	) as Record<string, unknown>;

	assert.strictEqual("internal" in result, false);
	assert.strictEqual(result.visible, "yes");
});

test("redact: multiple redactors — first non-false result wins", () => {
	const result = serialize(
		{ password: "secret", token: "abc", user: "alice" },
		new Graph(0),
		new Set(),
		cfg({
			redactors: [
				(key) => (key === "password" ? "[redacted:password]" : false),
				(key) => (key === "token" ? "[redacted:token]" : false),
			],
		}),
	) as Record<string, unknown>;

	assert.strictEqual(result.password, "[redacted:password]");
	assert.strictEqual(result.token, "[redacted:token]");
	assert.strictEqual(result.user, "alice");
});

test("redact: receives value and target as context", () => {
	const calls: Array<{ key: unknown; value: unknown; target: unknown }> = [];
	const input = { port: 5432 };
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

	assert.ok(calls.length > 0, "redactor called");
	assert.strictEqual(calls[0].key, "port");
	assert.strictEqual(calls[0].value, 5432);
	assert.strictEqual(calls[0].target, input);
});

// ─── truncate ─────────────────────────────────────────────────────────────────

test('truncate: strings longer than the limit are truncated with "…"', () => {
	const result = serialize(
		"hello world",
		new Graph(0),
		new Set(),
		cfg({ truncate: 5 }),
	);

	assert.strictEqual(result, "hello…");
});

test("truncate: strings within the limit are kept as-is", () => {
	const result = serialize(
		"short",
		new Graph(0),
		new Set(),
		cfg({ truncate: 10 }),
	);
	assert.strictEqual(result, "short");
});

test("serialization controls: maxDepth, redact, and truncate compose without error", () => {
	const result = serialize(
		{ secret: "password", label: "hello world", nested: { a: 1 } },
		new Graph(0),
		new Set(),
		cfg({
			maxDepth: 1,
			redactors: [(key) => key === "secret"],
			truncate: 5,
		}),
	) as Record<string, unknown>;
	assert.strictEqual(result.secret, "[redacted]");
	assert.strictEqual(result.label, "hello…");
	assert.strictEqual(result.nested, "[…]");
});

// ─── circular references ──────────────────────────────────────────────────────

test('circular references are serialised as { $proxy: "?" }', () => {
	const circular: Record<string, unknown> = {};
	circular.self = circular;
	const result = serialize(circular, new Graph(0)) as Record<string, unknown>;
	assert.deepStrictEqual(result.self, { $proxy: "?" });
});
