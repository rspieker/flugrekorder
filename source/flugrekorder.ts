import type { Writable } from 'node:stream';

// ─── Types ────────────────────────────────────────────────────────────────────

/** Any value that can be wrapped in a Proxy — objects and functions. */
// biome-ignore lint/complexity/noBannedTypes: Function is intentional — Proxiable must accept any callable
export type Proxiable = object | Function;

/** Reflect traps that operate on a property — carry a parent ID and key in their origin. */
export type PropertyTrap =
	| 'get'
	| 'set'
	| 'defineProperty'
	| 'getOwnPropertyDescriptor';

/** Reflect traps that invoke a callable — carry a source ID in their origin. */
export type CallTrap = 'apply' | 'construct';

/** Describes how a proxy was created — which trap fired, on which parent, and under which key or source. Null for root proxies. */
export type Origin =
	| { trap: PropertyTrap; parent: string; key: string | symbol }
	| { trap: CallTrap; source: string }
	| null;

/** Origin with symbol keys coerced to strings — safe to include in a Rekording. */
type SerializedOrigin =
	| { trap: PropertyTrap; parent: string; key: string }
	| { trap: CallTrap; source: string }
	| null;

/** A JSON-safe representation of any value. Proxiable values are replaced with `{ $proxy: id }` tags. */
export type Serialized =
	| string
	| number
	| boolean
	| bigint
	| null
	| undefined
	| { readonly $proxy: string }
	| Array<Serialized>
	| { [key: string]: Serialized };

/** A single recorded interaction — one Reflect trap firing on one proxy. */
export type Rekording = {
	id: string;
	trap: string;
	origin: SerializedOrigin;
	args: Array<Serialized>;
	result: Serialized;
};

/** Resolved runtime configuration — derived from CreateOptions and passed through the proxy factory. */
type Config = {
	write: (r: Rekording) => void;
	recursive: boolean;
	only: Set<string> | null;
};

/** A function that conditionally wraps a value in a proxy. */
type Wrapper = (v: unknown) => unknown;

/** Pre/post hooks for a Reflect trap — transform args before dispatch and/or wrap the result. */
type Spec = {
	pre?: (
		args: Array<unknown>,
		wrap: Wrapper,
		known: Wrapper,
	) => Array<unknown>;
	post?: (result: unknown, args: Array<unknown>, wrap: Wrapper) => unknown;
};

// ─── Graph ────────────────────────────────────────────────────────────────────

/** A node in the proxy graph — links a proxy to its original target, its origin, and its ID. */
type GraphNode = {
	readonly id: string;
	readonly proxy: Proxiable;
	readonly target: Proxiable;
	readonly origin: Origin;
};

/**
 * Session-scoped proxy registry.
 * Each `create()` call produces its own Graph so proxied trees are
 * independent and GC-eligible once no longer referenced.
 */
class Graph {
	#byId = new Map<string, GraphNode>();
	#byProxy = new WeakMap<Proxiable, GraphNode>();
	#byTarget = new WeakMap<Proxiable, GraphNode>();
	#generator: () => string;

	constructor(id: number | (() => string)) {
		let counter = typeof id === 'number' ? id : 0;

		this.#generator = typeof id === 'function' ? id : () => `#${++counter}`;
	}

	nextId(): string {
		return this.#generator();
	}

	getByProxy(v: Proxiable): GraphNode | undefined {
		return this.#byProxy.get(v);
	}
	getByTarget(v: Proxiable): GraphNode | undefined {
		return this.#byTarget.get(v);
	}
	getById(id: string): GraphNode | undefined {
		return this.#byId.get(id);
	}

	register(
		proxy: Proxiable,
		target: Proxiable,
		origin: Origin,
		id: string,
	): GraphNode {
		const node: GraphNode = { id, proxy, target, origin };

		this.#byId.set(id, node);
		this.#byProxy.set(proxy, node);
		this.#byTarget.set(target, node);

		return node;
	}
}

// Module-level weak index: proxy → owning graph.
// WeakMap — does not prevent GC of either the proxy or the graph.
const graphOf = new WeakMap<Proxiable, Graph>();

// All known proxies across all graphs — guards against double-wrapping.
// WeakSet — does not prevent GC.
const allProxies = new WeakSet<Proxiable>();

// Per-prototype cache: true if any getter on this prototype (or its chain)
// throws TypeError when called through a blank Proxy — the signature of an
// internal slot check.  Keyed by the direct prototype of the proxied target
// so all instances of the same type share one probe result.
const slotProtos = new WeakMap<object, boolean>();

// Stable bound-method cache: (target, key) → fn.bind(target).
// Ensures the same proxied bound function is returned every time the same
// method is accessed on the same target — required for graph proxy stability.
const bindCache = new WeakMap<object, Map<PropertyKey, Function>>();

// ─── Utility ──────────────────────────────────────────────────────────────────

/** Returns true for any value that can meaningfully be wrapped in a Proxy. */
function isProxiable(value: unknown): value is Proxiable {
	return (
		value !== null &&
		(typeof value === 'object' || typeof value === 'function')
	);
}

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
function serialize(
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
function serializeOrigin(o: Origin): SerializedOrigin {
	if (!o) return null;
	if ('key' in o)
		return { trap: o.trap, parent: o.parent, key: String(o.key) };

	return o;
}

// ─── Internal slot detection ──────────────────────────────────────────────────

/**
 * Returns true if `target`'s prototype chain contains a getter that throws
 * TypeError when called through a Proxy — the JS-observable signature of an
 * ECMAScript internal slot check (e.g. Map, Set, WeakMap, WeakSet, Date).
 * Result is cached per prototype so the probe runs at most once per type.
 */
// Slot-check TypeErrors have specific messages; filter by them to avoid
// misclassifying TypeErrors thrown for other reasons (e.g. wrong arg count).
const slotError = /incompatible receiver|this is not/i;

function hasInternalSlots(target: Proxiable): boolean {
	if (typeof target !== 'object' || target === null) return false;

	const direct = Object.getPrototypeOf(target as object) as object | null;
	if (!direct) return false;
	if (slotProtos.has(direct)) return slotProtos.get(direct)!;

	const probe = new Proxy(target as object, {
		set:            () => true,
		defineProperty: () => true,
		deleteProperty: () => true,
		setPrototypeOf: () => true,
	});
	let proto: object | null = direct;

	while (proto && proto !== Object.prototype) {
		for (const key of Object.getOwnPropertyNames(proto)) {
			if (key === 'constructor') continue;
			const desc = Object.getOwnPropertyDescriptor(proto, key);
			const fn =
				desc?.get ??
				(typeof desc?.value === 'function' ? (desc.value as Function) : null);
			if (fn) {
				let slots = false;
				try {
					fn.call(probe);
				} catch (e) {
					if (e instanceof TypeError && slotError.test(String(e))) slots = true;
				}
				slotProtos.set(direct, slots);
				return slots;
			}
		}
		proto = Object.getPrototypeOf(proto) as object | null;
	}

	slotProtos.set(direct, false);
	return false;
}

/** Returns a stable bound version of `fn` for `(target, key)` — created once, reused on every access. */
function boundMethod(target: object, key: PropertyKey, fn: Function): Function {
	if (!bindCache.has(target)) bindCache.set(target, new Map());
	const cache = bindCache.get(target)!;
	if (!cache.has(key)) cache.set(key, fn.bind(target));
	return cache.get(key)!;
}

// ─── Specs ────────────────────────────────────────────────────────────────────

/** Per-trap hooks that transform arguments and results to maintain proxy transparency. */
const specs: Partial<Record<string, Spec>> = {
	get: {
		// For targets with internal slots (Map, Set, WeakMap, WeakSet, Date …),
		// use the real target as the Reflect.get receiver so that getter-based
		// slot checks (e.g. Map.prototype.size) don't throw TypeError.
		pre: ([target, key, receiver], _wrap, _known) => [
			target,
			key,
			hasInternalSlots(target as Proxiable) ? target : receiver,
		],
		// For the same targets, bind method results to the real target before
		// wrapping so that apply-level slot checks (e.g. Map.prototype.get)
		// also pass.  The bind cache ensures proxy stability.
		post: (result, [target, key], wrap) => {
			if (key === 'prototype') return result;
			if (typeof result === 'function' && hasInternalSlots(target as Proxiable)) {
				return wrap(boundMethod(target as object, key as PropertyKey, result));
			}
			return wrap(result);
		},
	},
	set: {
		pre: ([target, key, value, receiver], wrap) => [
			target,
			key,
			wrap(value),
			receiver,
		],
	},
	apply: {
		// thisArg is wrapped normally (it's always a graph node).
		// Call arguments are wrapped with known — only existing graph nodes
		// get proxied; plain data passes through and is inlined by serialize().
		pre: ([target, thisArg, callArgs], wrap, known) => [
			target,
			wrap(thisArg),
			(<Array<unknown>>callArgs).map(known),
		],
		post: (result, _args, wrap) => wrap(result),
	},
	construct: {
		pre: ([target, callArgs, newTarget], wrap) => [
			target,
			(<Array<unknown>>callArgs).map(wrap),
			newTarget,
		],
		post: (result, _args, wrap) => wrap(result),
	},
	defineProperty: {
		pre: (args, wrap) => {
			const [target, key, descriptor] = <
				[unknown, unknown, PropertyDescriptor]
			>args;
			const patch: PropertyDescriptor = {};

			if (descriptor.value != null) patch.value = wrap(descriptor.value);
			if (typeof descriptor.get === 'function')
				patch.get = <() => unknown>wrap(descriptor.get);
			if (typeof descriptor.set === 'function')
				patch.set = <(v: unknown) => void>wrap(descriptor.set);

			return Object.keys(patch).length > 0
				? [target, key, { ...descriptor, ...patch }]
				: args;
		},
	},
	getOwnPropertyDescriptor: {
		post: (result, _args, wrap) => {
			const desc = <PropertyDescriptor | undefined>result;

			if (!desc) return result;

			const patch: PropertyDescriptor = {};

			if (desc.value != null) patch.value = wrap(desc.value);
			if (typeof desc.get === 'function')
				patch.get = <() => unknown>wrap(desc.get);
			if (typeof desc.set === 'function')
				patch.set = <(v: unknown) => void>wrap(desc.set);

			return Object.keys(patch).length > 0
				? { ...desc, ...patch }
				: result;
		},
	},
};

// ─── Core proxy factory ───────────────────────────────────────────────────────

/**
 * Creates a recording proxy for `target` within `graph`.
 * Reuses existing proxies for stability, handles Promises specially,
 * and registers every new proxy in both the graph and the module-level index.
 */
function makeProxy<T extends Proxiable>(
	target: T,
	graph: Graph,
	config: Config,
	origin: Origin,
): T {
	// Already a proxy (in any graph) — return unchanged, preventing double-wrapping.
	if (allProxies.has(<Proxiable>target)) return target;

	// Already have a proxy for this original — reuse it (stability guarantee).
	const existing = graph.getByTarget(<Proxiable>target);

	if (existing) return <T>existing.proxy;

	// Promises cannot be proxied directly: native methods like .then() check for
	// the [[PromiseState]] internal slot and throw if `this` is a Proxy. Instead,
	// return a new Promise that resolves to a proxy of the settled value.
	if (target instanceof Promise) {
		const chained = <T>(
			(<unknown>(
				target.then((value) =>
					isProxiable(value)
						? makeProxy(<Proxiable>value, graph, config, origin)
						: value,
				)
			))
		);
		// Register with a placeholder node so stability lookups work.
		const id = graph.nextId();

		graph.register(<Proxiable>chained, <Proxiable>target, origin, id);
		graphOf.set(<Proxiable>chained, graph);

		return chained;
	}

	const proxyId = graph.nextId();

	let pxy!: T;

	const traps = (<Array<keyof typeof Reflect>>(
		Object.getOwnPropertyNames(Reflect)
	)).filter((trap) => config.only === null || config.only.has(trap));

	const handler: ProxyHandler<Proxiable> = Object.fromEntries(
		traps.map((trap) => [
			trap,
			(...rawArgs: Array<unknown>) => {
				const selfId = (<GraphNode>graph.getByProxy(pxy)).id;

				const childOrigin: Origin =
					/get|set|defineProperty|getOwnPropertyDescriptor/.test(trap)
						? {
								trap: <PropertyTrap>trap,
								parent: selfId,
								key: <string | symbol>rawArgs[1],
							}
						: /apply|construct/.test(trap)
							? { trap: <CallTrap>trap, source: selfId }
							: null;

				const wrap: Wrapper = (v) => {
					if (!isProxiable(v) || allProxies.has(<Proxiable>v))
						return v;
					if (!config.recursive) return v;

					return makeProxy(<Proxiable>v, graph, config, childOrigin);
				};

				// Only wraps values already in the graph — new plain data passes through.
				const known: Wrapper = (v) => {
					if (!isProxiable(v)) return v;
					if (allProxies.has(<Proxiable>v)) return v;

					const existing = graph.getByTarget(<Proxiable>v);

					if (existing) return existing.proxy;

					return v;
				};

				const spec = specs[trap] ?? {};
				const args = spec.pre
					? spec.pre(rawArgs, wrap, known)
					: rawArgs;
				// biome-ignore lint/complexity/noBannedTypes: dynamic Reflect dispatch requires Function cast
				const result = (<Function>Reflect[trap])(...args);
				const output = spec.post
					? spec.post(result, args, wrap)
					: result;

				config.write({
					id: graph.nextId(),
					trap,
					origin: serializeOrigin(childOrigin),
					args: args.map((arg) => serialize(arg, graph)),
					result: serialize(output, graph),
				});

				return output;
			},
		]),
	);

	pxy = <T>(<unknown>new Proxy(<Proxiable>target, handler));

	graph.register(<Proxiable>pxy, <Proxiable>target, origin, proxyId);
	graphOf.set(<Proxiable>pxy, graph);
	allProxies.add(<Proxiable>pxy);

	return pxy;
}

// ─── Public API ───────────────────────────────────────────────────────────────

type CreateOptions = {
	id?: number | (() => string);
	recursive?: boolean;
	only?: string[];
} & (
	| { stream: Writable; callback?: never }
	| { callback: (record: Rekording) => void; stream?: never }
);

/**
 * Wraps `target` in a transparent recording proxy.
 * Every Reflect trap that fires emits a `Rekording` to `callback` or `stream`.
 */
export function create<T extends Proxiable>(
	target: T,
	options: CreateOptions,
): T {
	const { stream, callback } = options;
	const write: (r: Rekording) => void = stream
		? (r) => stream.write(`${JSON.stringify(r)}\n`)
		: // biome-ignore lint/style/noNonNullAssertion: CreateOptions guarantees stream or callback is set — TypeScript cannot express this mutual exclusion
			callback!;
	const recursive = options.recursive !== false;
	const only = options.only ? new Set(options.only) : null;
	const graph = new Graph(options.id ?? 0);

	return makeProxy(target, graph, { write, recursive, only }, null);
}

/** Returns `true` if `value` is a proxy created by this module. */
export function isFlugrekorder(value: unknown): value is Proxiable {
	return isProxiable(value) && allProxies.has(<Proxiable>value);
}

/** Returns the original unwrapped target of a proxy, or `null` for non-proxies. */
export function getTarget(pxy: Proxiable): Proxiable | null {
	return graphOf.get(pxy)?.getByProxy(pxy)?.target ?? null;
}

/**
 * Looks up a proxy by its recorded ID within the same graph as `pxy`.
 * Use this to resolve `{ $proxy: id }` references in recorded args and results back to live proxies.
 */
export function getProxyById(
	id: string,
	pxy: Proxiable,
): Proxiable | undefined {
	return graphOf.get(pxy)?.getById(id)?.proxy;
}

/** Returns the `Origin` of a proxy — how and from where it was created. Returns `null` for root proxies and non-proxies. */
export function getOrigin(pxy: Proxiable): Origin {
	return graphOf.get(pxy)?.getByProxy(pxy)?.origin ?? null;
}

/**
 * Walks the origin chain from the root proxy down to `pxy`.
 * Returns an ordered array of `{ proxy, origin }` pairs, root first.
 * Returns an empty array for non-proxies.
 */
export function getAncestors(
	pxy: Proxiable,
): Array<{ proxy: Proxiable; origin: Origin }> {
	const graph = graphOf.get(pxy);

	if (!graph) return [];

	const result: Array<{ proxy: Proxiable; origin: Origin }> = [];
	let node = graph.getByProxy(pxy);

	while (node) {
		result.unshift({ proxy: node.proxy, origin: node.origin });
		if (!node.origin) break;

		const parentId =
			'parent' in node.origin ? node.origin.parent : node.origin.source;

		node = graph.getById(parentId);
	}

	return result;
}

/**
 * Returns a human-readable dotted path string for a proxy.
 * Function and constructor calls are annotated with `()`.
 * Returns an empty string for the root proxy and for non-proxies.
 */
export function getPath(pxy: Proxiable): string {
	const ancestors = getAncestors(pxy);
	const parts: Array<string> = [];

	for (const { origin: o } of ancestors) {
		if (!o) continue;
		if ('key' in o) {
			parts.push(String(o.key));
		} else {
			if (parts.length > 0) {
				parts[parts.length - 1] += '()';
			} else {
				parts.push('()');
			}
		}
	}

	return parts.join('.');
}
