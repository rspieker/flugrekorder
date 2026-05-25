// biome-ignore lint/complexity/noBannedTypes: Function is intentional — Proxiable must accept any callable
export type Proxiable = object | Function;

/** Reflect traps that operate on a property — carry a parent ID and key in their origin. */
export type PropertyTrap =
	| 'get'
	| 'set'
	| 'defineProperty'
	| 'getOwnPropertyDescriptor';

/** Reflect traps that invoke a callable — carry a source ID in their origin. Includes synthetic variants for native boundary crossings. */
export type CallTrap =
	| 'apply'
	| 'construct'
	| 'apply:native'
	| 'construct:native';

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

/** A single recorded interaction — one Reflect trap firing on one proxy. */
export type Rekording = {
	id: string;
	trap: string;
	origin: SerializedOrigin;
	args: Array<Serialized>;
	result: Serialized;
	timestamp: number;
};
