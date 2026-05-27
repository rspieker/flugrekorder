import { isProxiable } from './types';
import type { Origin, Proxiable } from './types';

/** A node in the proxy graph — links a proxy to its original target, its origin, and its ID. */
export type GraphNode = {
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
export class Graph {
	static #index = new WeakMap<Proxiable, Graph>();
	static #all = new WeakSet<Proxiable>();

	/** Returns the Graph that owns `pxy`, or `undefined` for non-proxies. */
	static for(pxy: Proxiable): Graph | undefined {
		return Graph.#index.get(pxy);
	}

	/** Returns `true` if `pxy` is a proxy created by this module. */
	static isProxy(pxy: Proxiable): boolean {
		return Graph.#all.has(pxy);
	}

	/** Marks `pxy` as a known proxy across all graphs (double-wrap guard). */
	static track(pxy: Proxiable): void {
		Graph.#all.add(pxy);
	}

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

	/** Returns the underlying target if `value` is a proxy known to this graph, otherwise `value` unchanged. */
	unwrap(value: unknown): unknown {
		if (!isProxiable(value)) return value;
		return this.#byProxy.get(value)?.target ?? value;
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
		Graph.#index.set(proxy, this);

		return node;
	}
}
