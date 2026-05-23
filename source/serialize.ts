import type { Graph } from './graph';
import type { Origin, Proxiable, Serialized, SerializedOrigin } from './types';

/** Maps a typeof pattern to a serialization handler. */
type Mapping = {
	match: RegExp;
	map: (v: unknown, graph: Graph, seen: Set<unknown>) => Serialized;
};

/** Serializes an object or function value — tags known proxies by ID, inlines arrays and plain objects. */
function serializeProxiable(
	v: unknown,
	graph: Graph,
	seen: Set<unknown>,
): Serialized {
	// Check for a known proxy BEFORE Array.isArray: iterating a proxied
	// array via its proxy triggers get traps which call serialize again,
	// causing infinite recursion. A proxy is always tagged by ID.
	const node =
		graph.getByProxy(<Proxiable>v) ?? graph.getByTarget(<Proxiable>v);

	if (node !== undefined) return { $proxy: node.id };
	// Plain (unproxied) arrays are safe to iterate directly.
	if (Array.isArray(v))
		return (<Array<unknown>>v).map((item) => serialize(item, graph, seen));
	// Plain (unproxied) objects: serialize by value with a circular-reference guard.
	if (seen.has(v)) return { $proxy: '?' };

	seen.add(v);

	const result = Object.fromEntries(
		Object.entries(<object>v).map(([k, val]) => [
			k,
			serialize(val, graph, seen),
		]),
	);

	seen.delete(v);

	return result;
}

/** Ordered serialization handlers — first match wins; unmatched values fall through to String(). */
const mappings: Array<Mapping> = [
	{ match: /number|boolean|bigint/, map: (v) => <Serialized>v },
	{ match: /object|function/, map: serializeProxiable },
];

/** Converts any value to a JSON-safe Serialized form, tagging graph members by ID. */
export function serialize(
	v: unknown,
	graph: Graph,
	seen = new Set<unknown>(),
): Serialized {
	if (v === null || v === undefined) return v;

	const { map = String } =
		mappings.find(({ match }) => match.test(typeof v)) ?? {};

	return map(v, graph, seen);
}

/** Converts an Origin to its serialized form — coerces symbol keys to strings. */
export function serializeOrigin(o: Origin): SerializedOrigin {
	if (!o) return null;
	if ('key' in o)
		return { trap: o.trap, parent: o.parent, key: String(o.key) };

	return o;
}
