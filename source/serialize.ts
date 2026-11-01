import type { Graph } from './graph.ts';
import { isBinary } from './specs.ts';
import {
	isCallTrap,
	isPropertyTrap,
	isProxiable,
	type Origin,
	type Redactor,
	type Serialized,
	type SerializedOrigin,
} from './types.ts';

export type SerialConfig = {
	depth: number;
	redactors: Array<Redactor>;
	truncate: number;
	values: boolean;
};

export const defaults: SerialConfig = {
	depth: Infinity,
	redactors: [],
	truncate: Infinity,
	values: true,
};

/** Describes a value without its contents: `null`, `Array<length>`, binary data as `Name<length>`, otherwise its `typeof`. */
function kind(v: unknown): string {
	if (v === null) return 'null';
	if (Array.isArray(v)) return `Array<${v.length}>`;
	if (isBinary(v)) {
		// The tag of a built-in comes from its prototype: no application code runs.
		const name = Object.prototype.toString.call(v).slice(8, -1);
		const length =
			'length' in (v as object)
				? (v as ArrayLike<unknown>).length
				: (v as ArrayBuffer | DataView).byteLength;

		return `${name}<${length}>`;
	}

	return typeof v;
}

/** Truncates a string to `serial.truncate` characters, marking the cut with `…`. */
function text(v: string, serial: SerialConfig): string {
	return v.length > serial.truncate ? `${v.slice(0, serial.truncate)}…` : v;
}

/** A number as JSON writes it, or tagged when JSON cannot: `NaN`, `±Infinity`, `-0`. */
function number(v: number): Serialized {
	if (Object.is(v, -0)) return { $number: '-0' };

	return Number.isFinite(v) ? v : { $number: String(v) };
}

/** The bytes of binary data as base64; empty for a detached buffer. */
function base64(v: ArrayBufferLike | ArrayBufferView): string {
	const buffer = ArrayBuffer.isView(v) ? v.buffer : v;
	if ((buffer as { detached?: boolean }).detached) return '';

	const bytes = ArrayBuffer.isView(v)
		? new Uint8Array(v.buffer, v.byteOffset, v.byteLength)
		: new Uint8Array(v);

	if (typeof Buffer === 'function')
		return Buffer.from(
			bytes.buffer,
			bytes.byteOffset,
			bytes.byteLength,
		).toString('base64');

	let binary = '';
	for (const byte of bytes) binary += String.fromCharCode(byte);

	return btoa(binary);
}

/**
 * Built-ins that hold a single value, tagged by type without walking them.
 * Values are read through the built-in's own prototype where an instance
 * could shadow them, so no application code runs.
 */
function builtin(v: object, serial: SerialConfig): Serialized | undefined {
	if (typeof v === 'function') {
		const name = Object.getOwnPropertyDescriptor(v, 'name')?.value;

		return { $function: typeof name === 'string' ? name : '' };
	}
	if (v instanceof Date) {
		const time = Date.prototype.getTime.call(v);

		return {
			$date: Number.isNaN(time)
				? 'Invalid Date'
				: Date.prototype.toISOString.call(v),
		};
	}
	if (v instanceof RegExp)
		return { $regexp: { source: v.source, flags: v.flags } };
	if (v instanceof Error)
		return { $error: { name: String(v.name), message: String(v.message) } };
	if (typeof URL === 'function' && v instanceof URL) return { $url: v.href };
	if (v instanceof WeakMap) return { $weakmap: null };
	if (v instanceof WeakSet) return { $weakset: null };
	if (isBinary(v)) {
		const type =
			typeof Buffer === 'function' && Buffer.isBuffer(v)
				? 'Buffer'
				: Object.prototype.toString.call(v).slice(8, -1);

		return {
			$binary: {
				type,
				base64: text(
					base64(v as ArrayBufferLike | ArrayBufferView),
					serial,
				),
			},
		};
	}

	return undefined;
}

/** Tags a proxy by its ID, and a target known to the graph by the ID of its proxy. */
function reference(v: unknown, graph: Graph): Serialized | undefined {
	if (!isProxiable(v)) return undefined;

	const proxyNode = graph.getByProxy(v);
	if (proxyNode !== undefined) return { $proxy: proxyNode.id };

	const targetNode = graph.getByTarget(v);
	if (targetNode !== undefined) return { $unwrap: { $proxy: targetNode.id } };

	return undefined;
}

/** Find and apply any redaction for the given key/value/target context */
function redact(
	redactors: Array<Redactor>,
	key: string | symbol,
	value: unknown,
	target: object,
): string | null | false {
	for (const redactor of redactors) {
		const result = redactor(key, value, target);
		if (result === false) continue;

		return result === true ? '[redacted]' : result;
	}

	return false;
}

/** Serializes an object or function value — tags known proxies by ID, inlines arrays and plain objects. */
function proxiable(
	v: unknown,
	graph: Graph,
	seen: Set<unknown>,
	serial: SerialConfig,
	depth: number,
): Serialized {
	// Check for a known proxy BEFORE Array.isArray: iterating a proxied
	// array via its proxy triggers get traps which call serialize again,
	// causing infinite recursion. A proxy is always tagged by ID.
	const tag = reference(v, graph) ?? builtin(v as object, serial);
	if (tag !== undefined) return tag;
	if (depth >= serial.depth) return '[…]';

	// Plain (unproxied) arrays and objects are serialized by value, with a
	// circular-reference guard on the path from the root.
	if (seen.has(v)) return { $proxy: '?' };

	const item = (value: unknown) =>
		serialize(value, graph, seen, serial, depth + 1);

	seen.add(v);

	// Plain (unproxied) arrays are safe to iterate directly; a hole is read
	// as `undefined`, which JSON would otherwise write as `null`.
	if (Array.isArray(v)) {
		const items = Array.from(v as Array<unknown>, item);

		seen.delete(v);

		return items;
	}
	if (v instanceof Map) {
		const entries: Array<[Serialized, Serialized]> = [];
		Map.prototype.forEach.call(v, (value, key) =>
			entries.push([item(key), item(value)]),
		);

		seen.delete(v);

		return { $map: entries };
	}
	if (v instanceof Set) {
		const values: Array<Serialized> = [];
		Set.prototype.forEach.call(v, (value) => values.push(item(value)));

		seen.delete(v);

		return { $set: values };
	}

	const entries: Array<[string, Serialized]> = [];

	for (const [k, val] of Object.entries(v as object)) {
		if (serial.redactors.length > 0) {
			const decision = redact(serial.redactors, k, val, v as object);
			if (decision === null) continue;
			if (decision !== false) {
				entries.push([k, decision]);
				continue;
			}
		}

		entries.push([k, item(val)]);
	}

	seen.delete(v);

	return Object.fromEntries(entries);
}

/** Converts any value to a JSON-safe Serialized form, tagging graph members by ID. */
export function serialize(
	v: unknown,
	graph: Graph,
	seen = new Set<unknown>(),
	serial = defaults,
	depth = 0,
): Serialized {
	// Without values, only references remain: everything else is described.
	if (!serial.values) return reference(v, graph) ?? { $omitted: kind(v) };
	if (v === null) return null;
	// JSON drops `undefined`, or writes `null` inside an array.
	if (v === undefined) return { $undefined: true };
	if (isProxiable(v)) return proxiable(v, graph, seen, serial, depth);
	// JSON has no bigint: written as is, it makes JSON.stringify throw.
	if (typeof v === 'bigint') return { $bigint: String(v) };
	if (typeof v === 'symbol') return { $symbol: v.description ?? '' };
	if (typeof v === 'number') return number(v);

	return typeof v === 'string' ? text(v, serial) : (v as Serialized);
}

/**
 * Serializes the arguments of a trap. Without values, the record keeps its
 * structure: the key of a property trap, and the argument list of a call —
 * one entry per argument.
 */
export function args(
	trap: string,
	list: Array<unknown>,
	graph: Graph,
	serial: SerialConfig,
): Array<Serialized> {
	const value = (v: unknown) => serialize(v, graph, new Set(), serial);

	if (serial.values) return list.map(value);

	const callArgs = isCallTrap(trap)
		? trap.startsWith('construct')
			? 1
			: 2
		: -1;

	return list.map((arg, index) => {
		if (index === 1 && isPropertyTrap(trap))
			return serialize(arg, graph, new Set(), {
				...serial,
				values: true,
			});
		if (index === callArgs && Array.isArray(arg)) return arg.map(value);

		return value(arg);
	});
}

/** Serializes the result of a trap. Without values, the keys `ownKeys` lists are kept: keys are structure, not values. */
export function result(
	trap: string,
	output: unknown,
	graph: Graph,
	serial: SerialConfig,
): Serialized {
	// A missing `result` means `undefined`: void functions are everywhere.
	if (output === undefined && serial.values) return undefined;

	return serialize(
		output,
		graph,
		new Set(),
		trap === 'ownKeys' ? { ...serial, values: true } : serial,
	);
}

/** Converts an Origin to its serialized form — coerces symbol keys to strings. */
export function origin(o: Origin): SerializedOrigin {
	if (!o) return null;
	if ('key' in o)
		return { trap: o.trap, parent: o.parent, key: String(o.key) };

	return o;
}
