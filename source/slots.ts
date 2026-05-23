import type { Proxiable } from './types';

// Per-prototype cache: true if any getter on this prototype (or its chain)
// throws TypeError when called through a blank Proxy — the signature of an
// internal slot check.  Keyed by the direct prototype of the proxied target
// so all instances of the same type share one probe result.
const slotProtos = new WeakMap<object, boolean>();

// Stable bound-method cache: (target, key) → fn.bind(target).
// Ensures the same proxied bound function is returned every time the same
// method is accessed on the same target — required for graph proxy stability.
// biome-ignore lint/complexity/noBannedTypes: bind cache must hold any function type
const bindCache = new WeakMap<object, Map<PropertyKey, Function>>();

// Slot-check TypeErrors have specific messages; filter by them to avoid
// misclassifying TypeErrors thrown for other reasons (e.g. wrong arg count).
const slotError = /incompatible receiver|this is not/i;

/**
 * Returns true if `target`'s prototype chain contains a getter that throws
 * TypeError when called through a Proxy — the JS-observable signature of an
 * ECMAScript internal slot check (e.g. Map, Set, WeakMap, WeakSet, Date).
 * Result is cached per prototype so the probe runs at most once per type.
 */
export function hasInternalSlots(target: Proxiable): boolean {
	if (typeof target !== 'object' || target === null) return false;

	const direct = Object.getPrototypeOf(target as object) as object | null;
	if (!direct) return false;
	const cached = slotProtos.get(direct);
	if (cached !== undefined) return cached;

	const probe = new Proxy(target as object, {
		set: () => true,
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
				(typeof desc?.value === 'function'
					? // biome-ignore lint/complexity/noBannedTypes: desc.value is narrowed to function by the typeof check above; Function is the only type that exposes .call()
						(desc.value as Function)
					: null);
			if (fn) {
				let slots = false;
				try {
					fn.call(probe);
				} catch (e) {
					if (e instanceof TypeError && slotError.test(String(e)))
						slots = true;
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
export function boundMethod(
	target: object,
	key: PropertyKey,
	// biome-ignore lint/complexity/noBannedTypes: needs .bind(); no narrower callable type exposes it
	fn: Function,
	// biome-ignore lint/complexity/noBannedTypes: return type must match fn; narrowing to a specific signature would be incorrect here
): Function {
	let cache = bindCache.get(target);
	if (!cache) {
		cache = new Map();
		bindCache.set(target, cache);
	}
	const existing = cache.get(key);
	if (existing) return existing;
	const bound = fn.bind(target);
	cache.set(key, bound);
	return bound;
}
