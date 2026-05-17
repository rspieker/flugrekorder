import type { Writable } from 'node:stream';

// ─── Types ────────────────────────────────────────────────────────────────────

// biome-ignore lint/complexity/noBannedTypes: Function is intentional — Proxiable must accept any callable
export type Proxiable = object | Function;

export type Origin =
	| {
			trap: 'get' | 'set' | 'defineProperty' | 'getOwnPropertyDescriptor';
			parent: string;
			key: string | symbol;
	  }
	| {
			trap: 'apply' | 'construct';
			source: string;
	  }
	| null;

type SerializedOrigin =
	| {
			trap: 'get' | 'set' | 'defineProperty' | 'getOwnPropertyDescriptor';
			parent: string;
			key: string;
	  }
	| { trap: 'apply' | 'construct'; source: string }
	| null;

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

export type Rekording = {
	id: string;
	trap: string;
	origin: SerializedOrigin;
	args: Array<Serialized>;
	result: Serialized;
};

type Config = {
	write: (r: Rekording) => void;
	recursive: boolean;
	only: Set<string> | null;
};

type WrapFn = (v: unknown) => unknown;

type Spec = {
	pre?: (
		args: Array<unknown>,
		wrap: WrapFn,
		wrapKnown: WrapFn,
	) => Array<unknown>;
	post?: (result: unknown, args: Array<unknown>, wrap: WrapFn) => unknown;
};

// ─── Graph ────────────────────────────────────────────────────────────────────

interface GNode {
	readonly id: string;
	readonly proxy: Proxiable;
	readonly target: Proxiable;
	readonly origin: Origin;
}

class Graph {
	private byId = new Map<string, GNode>();
	private byProxy = new WeakMap<Proxiable, GNode>();
	private byTarget = new WeakMap<Proxiable, GNode>();
	private n: number;
	private genId: () => string;

	constructor(id: number | (() => string)) {
		this.n = typeof id === 'number' ? id : 0;
		this.genId = typeof id === 'function' ? id : () => `#${++this.n}`;
	}

	nextId(): string {
		return this.genId();
	}

	getByProxy(v: Proxiable): GNode | undefined {
		return this.byProxy.get(v);
	}
	getByTarget(v: Proxiable): GNode | undefined {
		return this.byTarget.get(v);
	}
	getById(id: string): GNode | undefined {
		return this.byId.get(id);
	}

	register(
		proxy: Proxiable,
		target: Proxiable,
		origin: Origin,
		id: string,
	): GNode {
		const node: GNode = { id, proxy, target, origin };
		this.byId.set(id, node);
		this.byProxy.set(proxy, node);
		this.byTarget.set(target, node);
		return node;
	}
}

// Module-level weak index: proxy → owning graph.
// WeakMap — does not prevent GC of either the proxy or the graph.
const graphOf = new WeakMap<Proxiable, Graph>();

// All known proxies across all graphs — guards against double-wrapping.
// WeakSet — does not prevent GC.
const allProxies = new WeakSet<Proxiable>();

// ─── Utility ──────────────────────────────────────────────────────────────────

const isProxiable = (v: unknown): v is Proxiable =>
	v !== null && (typeof v === 'object' || typeof v === 'function');

function serialize(
	v: unknown,
	graph: Graph,
	seen = new Set<unknown>(),
): Serialized {
	if (v === null || v === undefined) return v;
	switch (typeof v) {
		case 'string':
		case 'number':
		case 'boolean':
		case 'bigint':
			return v;
		case 'symbol':
			return String(v);
		case 'object':
		case 'function': {
			// Check for a known proxy BEFORE Array.isArray: iterating a proxied
			// array via its proxy triggers get traps which call serialize again,
			// causing infinite recursion. A proxy is always tagged by ID.
			const node =
				graph.getByProxy(v as Proxiable) ??
				graph.getByTarget(v as Proxiable);
			if (node !== undefined) return { $proxy: node.id };
			// Plain (unproxied) arrays are safe to iterate directly.
			if (Array.isArray(v))
				return (v as Array<unknown>).map((item) =>
					serialize(item, graph, seen),
				);
			// Plain (unproxied) objects: serialize by value with a circular-reference guard.
			if (seen.has(v)) return { $proxy: '?' };
			seen.add(v);
			const result = Object.fromEntries(
				Object.entries(v as object).map(([k, val]) => [
					k,
					serialize(val, graph, seen),
				]),
			);
			seen.delete(v);
			return result;
		}
	}
	/* istanbul ignore next */
	return String(v);
}

function serializeOrigin(o: Origin): SerializedOrigin {
	if (!o) return null;
	if ('key' in o)
		return { trap: o.trap, parent: o.parent, key: String(o.key) };
	return o;
}

// ─── Specs ────────────────────────────────────────────────────────────────────

const specs: Partial<Record<string, Spec>> = {
	get: {
		post: (result, args, wrap) =>
			args[1] === 'prototype' ? result : wrap(result),
	},
	set: {
		pre: (args, wrap) => [args[0], args[1], wrap(args[2]), args[3]],
	},
	apply: {
		// thisArg is wrapped normally (it's always a graph node).
		// Call arguments are wrapped with wrapKnown — only existing graph nodes
		// get proxied; plain data passes through and is inlined by serialize().
		pre: (args, wrap, wrapKnown) => [
			args[0],
			wrap(args[1]),
			(args[2] as Array<unknown>).map(wrapKnown),
		],
		post: (result, _args, wrap) => wrap(result),
	},
	construct: {
		pre: (args, wrap) => [
			args[0],
			(args[1] as Array<unknown>).map(wrap),
			args[2],
		],
		post: (result, _args, wrap) => wrap(result),
	},
	defineProperty: {
		pre: (args, wrap) => {
			const desc = args[2] as PropertyDescriptor;
			const patch: PropertyDescriptor = {};
			if (desc.value != null) patch.value = wrap(desc.value);
			if (typeof desc.get === 'function')
				patch.get = wrap(desc.get) as () => unknown;
			if (typeof desc.set === 'function')
				patch.set = wrap(desc.set) as (v: unknown) => void;
			return Object.keys(patch).length > 0
				? [args[0], args[1], { ...desc, ...patch }]
				: args;
		},
	},
	getOwnPropertyDescriptor: {
		post: (result, _args, wrap) => {
			const desc = result as PropertyDescriptor | undefined;
			if (!desc) return result;
			const patch: PropertyDescriptor = {};
			if (desc.value != null) patch.value = wrap(desc.value);
			if (typeof desc.get === 'function')
				patch.get = wrap(desc.get) as () => unknown;
			if (typeof desc.set === 'function')
				patch.set = wrap(desc.set) as (v: unknown) => void;
			return Object.keys(patch).length > 0
				? { ...desc, ...patch }
				: result;
		},
	},
};

// ─── Core proxy factory ───────────────────────────────────────────────────────

function makeProxy<T extends Proxiable>(
	target: T,
	graph: Graph,
	config: Config,
	origin: Origin,
): T {
	// Already a proxy (in any graph) — return unchanged, preventing double-wrapping.
	if (allProxies.has(target as Proxiable)) return target;

	// Already have a proxy for this original — reuse it (stability guarantee).
	const existing = graph.getByTarget(target as Proxiable);
	if (existing) return existing.proxy as T;

	// Promises cannot be proxied directly: native methods like .then() check for
	// the [[PromiseState]] internal slot and throw if `this` is a Proxy. Instead,
	// return a new Promise that resolves to a proxy of the settled value.
	if (target instanceof Promise) {
		const chained = target.then((value) =>
			isProxiable(value)
				? makeProxy(value as Proxiable, graph, config, origin)
				: value,
		) as unknown as T;
		// Register with a placeholder node so stability lookups work.
		const id = graph.nextId();
		graph.register(
			chained as unknown as Proxiable,
			target as Proxiable,
			origin,
			id,
		);
		graphOf.set(chained as unknown as Proxiable, graph);
		return chained;
	}

	const proxyId = graph.nextId();

	let pxy!: T;

	const traps = (
		Object.getOwnPropertyNames(Reflect) as Array<keyof typeof Reflect>
	).filter((trap) => config.only === null || config.only.has(trap));

	const handler: ProxyHandler<Proxiable> = Object.fromEntries(
		traps.map((trap) => [
			trap,
			(...rawArgs: Array<unknown>) => {
				// biome-ignore lint/style/noNonNullAssertion: pxy is always registered — this handler only runs inside a proxy we created
				const selfId = graph.getByProxy(pxy as Proxiable)!.id;

				const childOrigin: Origin = (() => {
					switch (trap) {
						case 'get':
						case 'set':
						case 'defineProperty':
						case 'getOwnPropertyDescriptor':
							return {
								trap,
								parent: selfId,
								key: rawArgs[1] as string | symbol,
							};
						case 'apply':
						case 'construct':
							return { trap, source: selfId };
						default:
							return null;
					}
				})();

				const wrap: WrapFn = (v) => {
					if (!isProxiable(v) || allProxies.has(v as Proxiable))
						return v;
					if (!config.recursive) return v;
					return makeProxy(
						v as Proxiable,
						graph,
						config,
						childOrigin,
					);
				};

				// Only wraps values already in the graph — new plain data passes through.
				const wrapKnown: WrapFn = (v) =>
					isProxiable(v) && allProxies.has(v as Proxiable) ? v : v;

				const spec = specs[trap] ?? {};
				const args = spec.pre
					? spec.pre(rawArgs, wrap, wrapKnown)
					: rawArgs;
				// biome-ignore lint/complexity/noBannedTypes: dynamic Reflect dispatch requires Function cast
				const result = (Reflect[trap] as Function)(...args);
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

	pxy = new Proxy(target as Proxiable, handler) as unknown as T;

	graph.register(pxy as Proxiable, target as Proxiable, origin, proxyId);
	graphOf.set(pxy as Proxiable, graph);
	allProxies.add(pxy as Proxiable);

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

export function create<T extends Proxiable>(
	target: T,
	options: CreateOptions,
): T {
	const write: (r: Rekording) => void = options.stream
		? (r) => options.stream?.write(`${JSON.stringify(r)}\n`)
		: // biome-ignore lint/style/noNonNullAssertion: CreateOptions guarantees stream or callback is set — TypeScript cannot express this mutual exclusion
			options.callback!;
	const recursive = options.recursive !== false;
	const only = options.only ? new Set(options.only) : null;
	const graph = new Graph(options.id ?? 0);

	return makeProxy(target, graph, { write, recursive, only }, null);
}

export function isFlugrekorder(value: unknown): value is Proxiable {
	return isProxiable(value) && allProxies.has(value as Proxiable);
}

export function getTarget(pxy: Proxiable): Proxiable | null {
	return graphOf.get(pxy)?.getByProxy(pxy)?.target ?? null;
}

export function getProxyById(
	id: string,
	pxy: Proxiable,
): Proxiable | undefined {
	return graphOf.get(pxy)?.getById(id)?.proxy;
}

export function getOrigin(pxy: Proxiable): Origin {
	return graphOf.get(pxy)?.getByProxy(pxy)?.origin ?? null;
}

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
