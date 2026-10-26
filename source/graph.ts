import type { Origin, Proxiable } from './types.ts';
import { isProxiable } from './types.ts';

/**
 * How a proxy was reached: its ID and origin, and how its parent was reached.
 * A lineage holds no application objects, so a proxy that is still in use
 * keeps the lineage of its ancestors — and with it its path — without
 * keeping the ancestors themselves alive.
 */
export type Lineage = {
	readonly id: string;
	readonly origin: Origin;
	readonly parent: Lineage | null;
};

/** A node in the proxy graph — links a proxy to its original target, its origin, and its ID. */
export type GraphNode = {
	readonly id: string;
	readonly proxy: Proxiable;
	readonly target: Proxiable;
	readonly origin: Origin;
	readonly lineage: Lineage;
};

/** An entry in the ID index: a `WeakRef`, or where the runtime has none, a strong stand-in for one. */
type Entry = { deref(): GraphNode | undefined };

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

	// Nodes by ID, held weakly: a node lives as long as its target does,
	// through #byTarget, so the session keeps nothing alive itself, and an ID
	// resolves for as long as its object exists. #collected removes the entries
	// of collected nodes; until it has, an emptied entry reads as missing.
	#byId = new Map<string, Entry>();
	// Runtimes without WeakRef or FinalizationRegistry keep nodes by ID
	// strongly, as every runtime did before.
	#weak =
		typeof WeakRef === 'function' &&
		typeof FinalizationRegistry === 'function';
	#collected = this.#weak
		? new FinalizationRegistry<string>((id) => {
				if (!this.#byId.get(id)?.deref()) this.#byId.delete(id);
			})
		: undefined;
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
	/** Returns the node with `id`, or `undefined` when there is none — never was, or no longer: its object has been collected. */
	getById(id: string): GraphNode | undefined {
		const node = this.#byId.get(id)?.deref();

		if (!node) this.#byId.delete(id);

		return node;
	}

	register(
		proxy: Proxiable,
		target: Proxiable,
		origin: Origin,
		id: string,
	): GraphNode {
		// The parent is alive: it is the proxy whose trap is creating this one.
		const parent = origin
			? this.getById('parent' in origin ? origin.parent : origin.source)
			: undefined;
		const lineage: Lineage = {
			id,
			origin,
			parent: parent?.lineage ?? null,
		};
		const node: GraphNode = { id, proxy, target, origin, lineage };

		this.#byId.set(
			id,
			this.#weak ? new WeakRef(node) : { deref: () => node },
		);
		this.#collected?.register(node, id);
		this.#byProxy.set(proxy, node);
		this.#byTarget.set(target, node);
		Graph.#index.set(proxy, this);

		return node;
	}
}
