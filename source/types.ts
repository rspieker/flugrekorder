import type { Graph } from './graph.ts';
export type Proxiable = object;

const propertyTraps = [
	'get',
	'set',
	'has',
	'deleteProperty',
	'defineProperty',
	'getOwnPropertyDescriptor',
] as const;

const callTraps = [
	'apply',
	'construct',
	'apply:native',
	'construct:native',
	'apply:structure',
	'apply:private',
] as const;

/** Reflect traps that operate on a property — carry a parent ID and key in their origin. */
export type PropertyTrap = (typeof propertyTraps)[number];

/** Reflect traps that invoke a callable — carry a source ID in their origin. Includes synthetic variants for native boundary crossings. */
export type CallTrap = (typeof callTraps)[number];

const propertyTrapSet: ReadonlySet<string> = new Set(propertyTraps);
const callTrapSet: ReadonlySet<string> = new Set(callTraps);

/** Returns true for the traps whose origin names a parent and a key. */
export function isPropertyTrap(trap: string): trap is PropertyTrap {
	return propertyTrapSet.has(trap);
}

/** Returns true for the traps whose origin names a source, synthetic variants included. */
export function isCallTrap(trap: string): trap is CallTrap {
	return callTrapSet.has(trap);
}

/** Describes how a proxy was created — which trap fired, on which parent, and under which key or source. Null for root proxies. */
export type Origin =
	| { trap: PropertyTrap; parent: string; key: string | symbol }
	| { trap: CallTrap; source: string }
	| null;

/** Origin with symbol keys coerced to strings — safe to include in a Rekording. */
export type SerializedOrigin =
	| { trap: PropertyTrap; parent: string; key: string }
	| { trap: CallTrap; source: string }
	| null;

/** A JSON-safe representation of any value. Proxiable values are replaced with `{ $proxy: id }` tags. Raw targets (proxiable values known to the graph but passed unwrapped) are tagged `{ $unwrap: { $proxy: id } }`. */
export type Serialized =
	| string
	| number
	| boolean
	| bigint
	| null
	| undefined
	| { readonly $proxy: string }
	| { readonly $unwrap: { readonly $proxy: string } }
	| Array<Serialized>
	| { [key: string]: Serialized };

/** Returns true for any value that can meaningfully be wrapped in a Proxy. */
export function isProxiable(value: unknown): value is Proxiable {
	return (
		value !== null &&
		(typeof value === 'object' || typeof value === 'function')
	);
}

/**
 * Determines whether and how a key/value pair should be redacted during serialization.
 * Return `false` to keep as-is, `true` to replace with `"[redacted]"`,
 * a string to use as a custom replacement, or `null` to drop the key entirely.
 */
export type Redactor = (
	key: string | symbol,
	value: unknown,
	target: object,
) => string | boolean | null;

/** A position in a source file: a path in unix notation relative to `process.cwd()` (or a name such as `node:fs`), with a 1-based line and column. */
export type SourceLocation = {
	file: string;
	line: number;
	column: number;
};

/** One frame of a call stack: the position of the call and the name of the function it is in (`''` for anonymous code). */
export type StackFrame = SourceLocation & {
	function: string;
};

/** A single recorded interaction — one Reflect trap firing on one proxy. */
export type Rekording = {
	id: string;
	trap: string;
	origin: SerializedOrigin;
	args: Array<Serialized>;
	result: Serialized;
	timestamp: number;
	/** With the `location` option, on apply and construct records: where the called function is defined; `null` for native functions. */
	location?: SourceLocation | null;
	/** With the `stack` option: the call stack that made the trap fire, nearest frame first. */
	stack?: Array<StackFrame>;
};

type Fn = (...args: Array<unknown>) => unknown;

/** Describes a retry handler for an apply trap boundary crossing. */
type ApplyRetryFlow = {
	is: (trap: string, error: unknown, bind?: boolean) => boolean;
	trap?: string;
	handle: (
		graph: Graph | undefined,
		fn: Fn,
		thisArg: unknown,
		argList: Array<unknown>,
	) => { args: [Fn, unknown, Array<unknown>]; result: unknown };
};

/** Describes a retry handler for a get trap boundary crossing. */
type GetRetryFlow = {
	is: (trap: string, error: unknown, bind?: boolean) => boolean;
	trap?: never;
	handle: (
		graph: Graph | undefined,
		target: object,
		propertyKey: PropertyKey,
		receiver: unknown,
	) => { result: unknown };
};

/** Describes a native boundary crossing retry handler. */
export type RetryFlow = ApplyRetryFlow | GetRetryFlow;
