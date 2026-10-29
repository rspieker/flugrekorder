import type { Writable } from 'node:stream';
import type { GraphNode } from './graph.ts';
import { Graph } from './graph.ts';
import { retryFlows } from './retry.ts';
import type { SerialConfig } from './serialize.ts';
import { serialize, origin as serializeOrigin } from './serialize.ts';
import { Shadow } from './shadow.ts';
import type { Spec, Wrapper } from './specs.ts';
import { isBinary, makeSpecs } from './specs.ts';
import * as trace from './trace.ts';
import type {
	CallTrap,
	Origin,
	Proxiable,
	Redactor,
	Rekording,
} from './types.ts';
import { isCallTrap, isPropertyTrap, isProxiable } from './types.ts';

export { format } from './format.ts';
export type { StackParser } from './frames.ts';
export { register as registerStackParser } from './frames.ts';
export {
	getAncestors,
	getLocation,
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
	SourceLocation,
	StackFrame,
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
	location: boolean;
	stack: number;
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
	location?: boolean;
	stack?: boolean | number;
};

// Records go to either a stream or a callback: `never` rules out passing both.
type StreamCreateOptions = CommonCreateOptions & {
	stream: Writable;
	callback?: never;
};
type CallbackCreateOptions = CommonCreateOptions & {
	callback: (record: Rekording) => void;
	stream?: never;
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
			isProxiable(value) && !isBinary(value)
				? makeProxy(value as Proxiable, graph, config, origin)
				: value,
		) as unknown as T;
		// Register with a placeholder node so stability lookups work.
		const id = graph.nextId();

		graph.register(chained as Proxiable, target as Proxiable, origin, id);

		return chained;
	}

	const proxyId = graph.nextId();

	const wrapper =
		(origin: () => Origin): Wrapper =>
		(v) => {
			if (!isProxiable(v) || Graph.isProxy(v as Proxiable)) return v;
			if (!config.recursive || isBinary(v)) return v;

			return makeProxy(v as Proxiable, graph, config, origin());
		};

	const listed = (trap: string): boolean =>
		config.only === null || config.only.has(trap);

	// The descriptor the proxy reports for an own key of the target — the
	// form the stand-in holds once the invariants pin that key.
	const describe = (key: PropertyKey): PropertyDescriptor | undefined => {
		const descriptor = Reflect.getOwnPropertyDescriptor(target, key);
		const post = listed('getOwnPropertyDescriptor')
			? config.specs.getOwnPropertyDescriptor?.post
			: undefined;

		if (!descriptor || !post) return descriptor;

		const wrap = wrapper(() => ({
			trap: 'getOwnPropertyDescriptor',
			parent: proxyId,
			key: key as string | symbol,
		}));

		return post(descriptor, [target, key], wrap) as PropertyDescriptor;
	};

	const shadow = new Shadow(target, describe, (v) => graph.unwrap(v));

	// Every trap is installed, listed in `only` or not: without a handler the
	// engine would act on the stand-in rather than on the target.
	const traps = Object.getOwnPropertyNames(Reflect) as Array<
		keyof typeof Reflect
	>;

	// Traps not listed in `only` are relayed to the target unrecorded. The
	// engine calls each trap with its full argument list, so relaying three
	// arguments is the same as spreading them, without allocating.
	const relay = (trap: keyof typeof Reflect) => {
		const reflect = Reflect[trap] as (...args: Array<unknown>) => unknown;

		return trap === 'defineProperty'
			? (
					_shadow: Proxiable,
					key: PropertyKey,
					descriptor: PropertyDescriptor,
				) =>
					shadow.report(
						trap,
						key,
						reflect(
							...shadow.forward(trap, [target, key, descriptor]),
						),
						descriptor,
					)
			: (_shadow: Proxiable, a: unknown, b: unknown, c: unknown) =>
					shadow.report(
						trap,
						a as PropertyKey,
						reflect(target, a, b, c),
					);
	};

	// Traps listed in `only` (all by default) are recorded.
	const record =
		(trap: keyof typeof Reflect) =>
		(_shadow: Proxiable, ...args: Array<unknown>) => {
			// The engine checks the result against the caller's own arguments.
			const caller = [target, ...args];
			const rawArgs = shadow.forward(trap, caller);
			const selfId = (graph.getByTarget(target) as GraphNode).id;

			let childOrigin: Origin = isPropertyTrap(trap)
				? { trap, parent: selfId, key: rawArgs[1] as string | symbol }
				: isCallTrap(trap)
					? { trap, source: selfId }
					: null;

			const wrap = wrapper(() => childOrigin);

			// Only wraps values already in the graph — new plain data passes through.
			const known: Wrapper = (v) => {
				if (!isProxiable(v)) return v;
				if (Graph.isProxy(v as Proxiable)) return v;

				const existing = graph.getByTarget(v as Proxiable);

				if (existing) return existing.proxy;

				return v;
			};

			const spec = config.specs[trap] ?? {};
			const preArgs = spec.pre ? spec.pre(rawArgs, wrap, known) : rawArgs;

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

			const output = shadow.report(
				trap,
				caller[1] as PropertyKey,
				spec.post ? spec.post(result, effectiveArgs, wrap) : result,
				caller[2] as PropertyDescriptor,
			);

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

			if (config.location && isCallTrap(trap))
				rekording.location = trace.location(target);
			if (config.stack > 0) rekording.stack = trace.stack(config.stack);

			if (!config.filter || config.filter(rekording))
				config.write(rekording);

			return output;
		};

	const handler: ProxyHandler<Proxiable> = Object.fromEntries(
		traps.map((trap) => [trap, listed(trap) ? record(trap) : relay(trap)]),
	);

	const pxy = new Proxy(shadow.object, handler) as unknown as T;

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
		options.stream !== undefined
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
	const location = options.location === true;
	// `true` records every frame there is; a number records up to that many.
	const stack =
		options.stack === true
			? Infinity
			: options.stack === false || options.stack === undefined
				? 0
				: options.stack;

	if (stack !== Infinity && !(Number.isInteger(stack) && stack >= 0))
		throw new RangeError(
			`flugrekorder: \`stack\` takes true or a frame count, not ${stack}`,
		);
	if (location && !trace.hasLocation())
		throw new Error(
			'flugrekorder: `location` needs node:inspector, which this runtime does not provide',
		);
	if (stack > 0 && !trace.hasStack())
		throw new Error(
			'flugrekorder: `stack` needs a runtime that reports call stacks',
		);

	const graph = new Graph(options.id ?? 0);
	const specs = makeSpecs(options.bind);

	return makeProxy(
		target,
		graph,
		{
			write,
			recursive,
			only,
			filter,
			serial,
			specs,
			bind: options.bind,
			location,
			stack,
		},
		null,
	);
}

/** Returns `true` if `value` is a proxy created by this module. */
export function isFlugrekorder(value: unknown): value is Proxiable {
	return isProxiable(value) && Graph.isProxy(value as Proxiable);
}
