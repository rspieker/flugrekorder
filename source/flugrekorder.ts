import type { Writable } from 'node:stream';
import type { GraphNode } from './graph.ts';
import { Graph } from './graph.ts';
import type { SerialConfig } from './serialize.ts';
import { serialize, origin as serializeOrigin } from './serialize.ts';
import type { Spec, Wrapper } from './specs.ts';
import { makeSpecs } from './specs.ts';
import type {
	CallTrap,
	Origin,
	PropertyTrap,
	Proxiable,
	Redactor,
	Rekording,
} from './types.ts';
import { isProxiable } from './types.ts';
import { retryFlows } from './retry.ts';

export { format } from './format.ts';
export {
	getAncestors,
	getOrigin,
	getPath,
	getProxyById,
	getTarget,
} from './inspection.ts';
export type {
	CallTrap,
	Origin,
	PropertyTrap,
	Proxiable,
	Redactor,
	Rekording,
	Serialized,
} from './types.ts';
export { isProxiable } from './types.ts';

/** Resolved runtime configuration — derived from CreateOptions and passed through the proxy factory. */
type Config = {
	write: (r: Rekording) => void;
	recursive: boolean;
	only: Set<string> | null;
	filter: ((r: Rekording) => boolean) | null;
	serial: SerialConfig;
	specs: Partial<Record<string, Spec>>;
	bind: boolean | undefined;
};

type CommonCreateOptions = {
	id?: number | (() => string);
	recursive?: boolean;
	only?: Array<string>;
	filter?: (rekording: Rekording) => boolean;
	depth?: number;
	redact?: Redactor | Array<Redactor>;
	truncate?: number;
	bind?: boolean;
};

type StreamCreateOptions = CommonCreateOptions & { stream: Writable };
type CallbackCreateOptions = CommonCreateOptions & {
	callback: (record: Rekording) => void;
};
type CreateOptions = StreamCreateOptions | CallbackCreateOptions;

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
	if (Graph.isProxy(target as Proxiable)) return target;

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

		graph.register(chained as Proxiable, target as Proxiable, origin, id);

		return chained;
	}

	const proxyId = graph.nextId();

	const traps = (
		Object.getOwnPropertyNames(Reflect) as Array<keyof typeof Reflect>
	).filter((trap) => config.only === null || config.only.has(trap));

	const handler: ProxyHandler<Proxiable> = Object.fromEntries(
		traps.map((trap) => [
			trap,
			(...rawArgs: Array<unknown>) => {
				const selfId = (graph.getByTarget(target) as GraphNode).id;

				let childOrigin: Origin =
					/get|set|defineProperty|getOwnPropertyDescriptor/.test(trap)
						? {
								trap: trap as PropertyTrap,
								parent: selfId,
								key: rawArgs[1] as string | symbol,
							}
						: /apply|construct/.test(trap)
							? { trap: trap as CallTrap, source: selfId }
							: null;

				const wrap: Wrapper = (v) => {
					if (!isProxiable(v) || Graph.isProxy(v as Proxiable))
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
				const known: Wrapper = (v) => {
					if (!isProxiable(v)) return v;
					if (Graph.isProxy(v as Proxiable)) return v;

					const existing = graph.getByTarget(v as Proxiable);

					if (existing) return existing.proxy;

					return v;
				};

				const spec = config.specs[trap] ?? {};
				const preArgs = spec.pre
					? spec.pre(rawArgs, wrap, known)
					: rawArgs;

				let effectiveTrap: string = trap;
				let effectiveArgs = preArgs;
				let result: unknown;

				try {
					result = (
						Reflect[trap] as (...args: Array<unknown>) => unknown
					)(...preArgs);
				} catch (e) {
					const flow = retryFlows.find(({ is }) =>
						is(trap, e, config.bind),
					);

					if (flow) {
						// is() matched preArgs to this flow's parameter shape at runtime;
						// the union can't express that statically.
						const invoke = flow.handle as (
							g: Graph | undefined,
							...a: Array<unknown>
						) => { args?: Array<unknown>; result: unknown };
						const output = invoke(graph, ...preArgs);
						if (flow.trap) {
							effectiveTrap = flow.trap;
							childOrigin = {
								trap: flow.trap as CallTrap,
								source: selfId,
							};
						}
						if (output?.args) effectiveArgs = output.args;
						result = output.result;
					} else {
						throw e;
					}
				}

				const output = spec.post
					? spec.post(result, effectiveArgs, wrap)
					: result;

				const rekording: Rekording = {
					id: graph.nextId(),
					trap: effectiveTrap,
					origin: serializeOrigin(childOrigin),
					args: effectiveArgs.map((arg) =>
						serialize(arg, graph, new Set(), config.serial),
					),
					result: serialize(output, graph, new Set(), config.serial),
					timestamp: Date.now(),
				};
				if (!config.filter || config.filter(rekording))
					config.write(rekording);

				return output;
			},
		]),
	);

	const pxy = new Proxy(target as Proxiable, handler) as unknown as T;

	graph.register(pxy as Proxiable, target as Proxiable, origin, proxyId);
	Graph.track(pxy as Proxiable);

	return pxy;
}

/**
 * Wraps `target` in a transparent recording proxy.
 * Every Reflect trap that fires emits a `Rekording` to `callback` or `stream`.
 */
export function create<T extends Proxiable>(
	target: T,
	options: CreateOptions,
): T {
	const write: (r: Rekording) => void =
		'stream' in options
			? (r) => options.stream.write(`${JSON.stringify(r)}\n`)
			: options.callback;
	const recursive = options.recursive !== false;
	const only = options.only ? new Set(options.only) : null;
	const filter = options.filter ?? null;
	const { redact } = options;
	const serial: SerialConfig = {
		depth: options.depth ?? Infinity,
		redactors: redact ? (Array.isArray(redact) ? redact : [redact]) : [],
		truncate: options.truncate ?? Infinity,
	};
	const graph = new Graph(options.id ?? 0);
	const specs = makeSpecs(options.bind);

	return makeProxy(
		target,
		graph,
		{ write, recursive, only, filter, serial, specs, bind: options.bind },
		null,
	);
}

/** Returns `true` if `value` is a proxy created by this module. */
export function isFlugrekorder(value: unknown): value is Proxiable {
	return isProxiable(value) && Graph.isProxy(value as Proxiable);
}
