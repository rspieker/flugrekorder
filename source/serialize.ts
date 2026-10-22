import type { Graph } from './graph.ts';
import {
	isProxiable,
	type Origin,
	type Proxiable,
	type Redactor,
	type Serialized,
	type SerializedOrigin,
} from './types.ts';

export type SerialConfig = {
	depth: number;
	redactors: Array<Redactor>;
	truncate: number;
};

export const defaults: SerialConfig = {
	depth: Infinity,
	redactors: [],
	truncate: Infinity,
};

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
	const proxyNode = graph.getByProxy(v as Proxiable);
	if (proxyNode !== undefined) return { $proxy: proxyNode.id };

	const targetNode = graph.getByTarget(v as Proxiable);
	if (targetNode !== undefined) return { $unwrap: { $proxy: targetNode.id } };
	if (depth >= serial.depth) return '[…]';

	// Plain (unproxied) arrays are safe to iterate directly.
	if (Array.isArray(v)) {
		return (v as Array<unknown>).map((item) =>
			serialize(item, graph, seen, serial, depth + 1),
		);
	}

	// Plain (unproxied) objects: serialize by value with a circular-reference guard.
	if (seen.has(v)) return { $proxy: '?' };

	seen.add(v);

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

		entries.push([k, serialize(val, graph, seen, serial, depth + 1)]);
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
	if (v === null || v === undefined) return v;
	if (isProxiable(v)) return proxiable(v, graph, seen, serial, depth);

	return typeof v === 'string'
		? (v as string).length > serial.truncate
			? `${(v as string).slice(0, serial.truncate)}…`
			: (v as string)
		: (v as Serialized);
}

/** Converts an Origin to its serialized form — coerces symbol keys to strings. */
export function origin(o: Origin): SerializedOrigin {
	if (!o) return null;
	if ('key' in o)
		return { trap: o.trap, parent: o.parent, key: String(o.key) };

	return o;
}
