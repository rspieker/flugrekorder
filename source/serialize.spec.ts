import test from "tape";
import type { SerialConfig } from "./serialize";
import { Graph } from "./graph";
import { defaults, serialize } from "./serialize";

function cfg(overrides: Partial<SerialConfig>): SerialConfig {
	return { ...defaults, ...overrides };
}

// ─── maxDepth ─────────────────────────────────────────────────────────────────

test('maxDepth: nested objects beyond the limit are replaced with "[…]"', (t) => {
	// arrange
	const result = serialize(
		{ a: { b: "deep" } },
		new Graph(0),
		new Set(),
		cfg({ maxDepth: 1 }),
	) as Record<string, unknown>;

	// act
	// assert
	t.equal(result.a, "[…]");
	t.end();
});

test("maxDepth: values within the limit are serialized normally", (t) => {
	// arrange
	const result = serialize(
		{ a: { b: "hi" } },
		new Graph(0),
		new Set(),
		cfg({ maxDepth: 2 }),
	) as Record<string, unknown>;

	// act
	// assert
	t.equal((result.a as Record<string, unknown>)?.b, "hi");
	t.end();
});

// ─── redact ───────────────────────────────────────────────────────────────────

test('redact: returning true replaces the value with "[redacted]"', (t) => {
	// arrange
	const result = serialize(
		{ password: "secret", user: "alice" },
		new Graph(0),
		new Set(),
		cfg({ redactors: [(key) => key === "password"] }),
	) as Record<string, unknown>;

	// act
	// assert
	t.equal(result.password, "[redacted]");
	t.equal(result.user, "alice");
	t.end();
});

test("redact: returning a string uses it as the replacement", (t) => {
	// arrange
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

	// act
	// assert
	t.equal(result.token, "[redacted:token]");
	t.end();
});

test("redact: returning null drops the key entirely", (t) => {
	// arrange
	const result = serialize(
		{ internal: "data", visible: "yes" },
		new Graph(0),
		new Set(),
		cfg({ redactors: [(key) => (key === "internal" ? null : false)] }),
	) as Record<string, unknown>;

	// act
	// assert
	t.notOk("internal" in result);
	t.equal(result.visible, "yes");
	t.end();
});

test("redact: multiple redactors — first non-false result wins", (t) => {
	// arrange
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

	// act
	// assert
	t.equal(result.password, "[redacted:password]");
	t.equal(result.token, "[redacted:token]");
	t.equal(result.user, "alice");
	t.end();
});

test("redact: receives value and target as context", (t) => {
	// arrange
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

	// act
	// assert
	t.ok(calls.length > 0, "redactor called");
	t.equal(calls[0].key, "port");
	t.equal(calls[0].value, 5432);
	t.equal(calls[0].target, input);
	t.end();
});

// ─── truncate ─────────────────────────────────────────────────────────────────

test('truncate: strings longer than the limit are truncated with "…"', (t) => {
	// arrange
	const result = serialize(
		"hello world",
		new Graph(0),
		new Set(),
		cfg({ truncate: 5 }),
	);

	// act
	// assert
	t.equal(result, "hello…");
	t.end();
});

test("truncate: strings within the limit are kept as-is", (t) => {
	// arrange
	// act
	// assert
	const result = serialize(
		"short",
		new Graph(0),
		new Set(),
		cfg({ truncate: 10 }),
	);
	t.equal(result, "short");
	t.end();
});

test("serialization controls: maxDepth, redact, and truncate compose without error", (t) => {
	// arrange
	// act
	// assert
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
	t.equal(result.secret, "[redacted]");
	t.equal(result.label, "hello…");
	t.equal(result.nested, "[…]");
	t.end();
});

// ─── circular references ──────────────────────────────────────────────────────

test('circular references are serialised as { $proxy: "?" }', (t) => {
	// arrange
	// act
	// assert
	const circular: Record<string, unknown> = {};
	circular.self = circular;
	const result = serialize(circular, new Graph(0)) as Record<string, unknown>;
	t.deepEqual(result.self, { $proxy: "?" });
	t.end();
});
