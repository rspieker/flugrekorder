import type { Writable } from 'node:stream';
import type { GraphNode } from './graph';
import { Graph } from './graph';
import type { SerialConfig } from './serialize';
import { serialize, origin as serializeOrigin } from './serialize';
import type { Wrapper } from './specs';
import { specs } from './specs';
import type {
	CallTrap,
	Origin,
	PropertyTrap,
	Proxiable,
	Redactor,
	Rekording,
} from './types';
import { isProxiable } from './types';

export { format } from './format';
export {
	getAncestors,
	getOrigin,
	getPath,
	getProxyById,
	getTarget,
} from './inspection';
export type {
	CallTrap,
	Origin,
	PropertyTrap,
	Proxiable,
	Redactor,
	Rekording,
	Serialized,
} from './types';
export { isProxiable } from './types';

/** Resolved runtime configuration — derived from CreateOptions and passed through the proxy factory. */
type Config = {
	write: (r: Rekording) => void;
	recursive: boolean;
	only: Set<string> | null;
	filter: ((r: Rekording) => boolean) | null;
	serial: SerialConfig;
};

type CreateOptions = {
	id?: number | (() => string);
	recursive?: boolean;
	only?: Array<string>;
	filter?: (rekording: Rekording) => boolean;
	maxDepth?: number;
	redact?: Redactor | Array<Redactor>;
	truncate?: number;
} & (
	| { stream: Writable; callback?: never }
	| { callback: (record: Rekording) => void; stream?: never }
);

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
	if (Graph.isProxy(<Proxiable>target)) return target;

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

				let childOrigin: Origin =
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
					if (!isProxiable(v) || Graph.isProxy(<Proxiable>v))
						return v;
					if (!config.recursive) return v;

					return makeProxy(<Proxiable>v, graph, config, childOrigin);
				};

				// Only wraps values already in the graph — new plain data passes through.
				const known: Wrapper = (v) => {
					if (!isProxiable(v)) return v;
					if (Graph.isProxy(<Proxiable>v)) return v;

					const existing = graph.getByTarget(<Proxiable>v);

					if (existing) return existing.proxy;

					return v;
				};

				const spec = specs[trap] ?? {};
				const preArgs = spec.pre
					? spec.pre(rawArgs, wrap, known)
					: rawArgs;

				let effectiveTrap: string = trap;
				let effectiveArgs = preArgs;
				let result: unknown;

				try {
					result = (<(...args: Array<unknown>) => unknown>Reflect[trap])(...preArgs);
				} catch (e) {
					if (trap === 'apply' && e instanceof TypeError && /illegal invocation/i.test(String(e))) {
						effectiveTrap = 'apply:native';
						const realThis = isProxiable(preArgs[1])
							? (graph.getByProxy(<Proxiable>preArgs[1])
									?.target ?? preArgs[1])
							: preArgs[1];
						effectiveArgs = [preArgs[0], realThis, preArgs[2]];
						childOrigin = { trap: <CallTrap>effectiveTrap, source: selfId };
						result = Reflect.apply(
							<(...a: Array<unknown>) => unknown>preArgs[0],
							realThis,
							<Array<unknown>>preArgs[2],
						);
					} else if (trap === 'apply' && e instanceof DOMException && e.name === 'DataCloneError') {
						effectiveTrap = 'apply:structure';
						const unwrappedArgs = (<Array<unknown>>preArgs[2]).map((arg) =>
							isProxiable(arg) ? (graph.getByProxy(<Proxiable>arg)?.target ?? arg) : arg,
						);
						effectiveArgs = [preArgs[0], preArgs[1], unwrappedArgs];
						childOrigin = { trap: <CallTrap>effectiveTrap, source: selfId };
						result = Reflect.apply(
							<(...a: Array<unknown>) => unknown>preArgs[0],
							<object>preArgs[1],
							unwrappedArgs,
						);
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

	pxy = <T>(<unknown>new Proxy(<Proxiable>target, handler));

	graph.register(<Proxiable>pxy, <Proxiable>target, origin, proxyId);
	Graph.track(<Proxiable>pxy);

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
	const { stream, callback } = options;
	const write: (r: Rekording) => void = stream
		? (r) => stream.write(`${JSON.stringify(r)}\n`)
		: // biome-ignore lint/style/noNonNullAssertion: CreateOptions guarantees stream or callback is set — TypeScript cannot express this mutual exclusion
			callback!;
	const recursive = options.recursive !== false;
	const only = options.only ? new Set(options.only) : null;
	const filter = options.filter ?? null;
	const { redact } = options;
	const serial: SerialConfig = {
		maxDepth: options.maxDepth ?? Infinity,
		redactors: redact ? (Array.isArray(redact) ? redact : [redact]) : [],
		truncate: options.truncate ?? Infinity,
	};
	const graph = new Graph(options.id ?? 0);

	return makeProxy(
		target,
		graph,
		{ write, recursive, only, filter, serial },
		null,
	);
}

/** Returns `true` if `value` is a proxy created by this module. */
export function isFlugrekorder(value: unknown): value is Proxiable {
	return isProxiable(value) && Graph.isProxy(<Proxiable>value);
}
