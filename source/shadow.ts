import type { Proxiable } from './types.ts';

/** Reports the descriptor the proxy presents for one of its target's own keys. */
export type Describer = (key: PropertyKey) => PropertyDescriptor | undefined;

/** Returns the real target behind a proxy, or the value itself. */
export type Unwrapper = (value: unknown) => unknown;

const accessors = ['value', 'get', 'set'] as const;

/**
 * Returns true when a property is pinned to its value, getter and setter:
 * non-configurable and not a writable data property — frozen and read-only
 * values, and accessors such as the getters TypeScript and Babel emit for
 * re-exports. A proxy must report a pinned property of its target exactly.
 */
export function isPinned(descriptor: PropertyDescriptor): boolean {
	return !descriptor.configurable && descriptor.writable !== true;
}

/**
 * Creates an empty stand-in of the same kind as `target`: an array for arrays
 * (`Array.isArray`), and for callables a function that is constructable only
 * when `target` has its own `prototype`, so `new` behaves as on the target.
 * Stand-ins are strict-mode functions: sloppy ones carry non-configurable
 * `arguments` and `caller` properties the target may not have.
 */
function blank(target: Proxiable): Proxiable {
	if (Array.isArray(target)) return [];
	if (typeof target !== 'function') return {};

	return Object.hasOwn(target, 'prototype')
		? // biome-ignore lint/complexity/useArrowFunction: arrow functions are not constructable
			function () {
				// biome-ignore lint/suspicious/noRedundantUseStrict: the IIFE build is not a module
				'use strict';
			}
		: () => {};
}

/**
 * The stand-in a proxy wraps instead of its real target.
 *
 * The engine checks every trap result against the proxy's own target: a
 * non-configurable property must be reported as it is there, and so must
 * non-extensibility. Wrapping the real target would pin those properties to
 * their real, unwrapped values. Against an empty stand-in nothing is pinned.
 * The stand-in follows the real target only as far as the invariants
 * demand: non-configurable properties are copied once a trap reports them,
 * and once the real target is no longer extensible, the stand-in takes all
 * its properties and its prototype and stops being extensible too.
 *
 * Copies hold the values as the proxy reports them, so once a property is
 * pinned on the stand-in, every trap reports that copy.
 */
export class Shadow {
	readonly object: Proxiable;
	#target: Proxiable;
	#describe: Describer;
	#unwrap: Unwrapper;
	// Nothing copied yet: no property can be pinned. A blank stand-in's own
	// properties (`length`, `name`, `prototype`) are configurable or writable.
	#blank = true;

	constructor(target: Proxiable, describe: Describer, unwrap: Unwrapper) {
		this.object = blank(target);
		this.#target = target;
		this.#describe = describe;
		this.#unwrap = unwrap;
	}

	/**
	 * The arguments `trap` passes on to the real target. Redefining a pinned
	 * property only succeeds with its real value, getter and setter; the
	 * proxy reports those wrapped, so what was read through it is unwrapped.
	 */
	forward(trap: string, args: Array<unknown>): Array<unknown> {
		if (trap !== 'defineProperty') return args;

		const [target, key, descriptor] = args as [
			Proxiable,
			PropertyKey,
			PropertyDescriptor,
		];
		const own = Reflect.getOwnPropertyDescriptor(target, key);

		if (!own || !isPinned(own)) return args;

		const real = accessors.filter(
			(field) =>
				field in descriptor &&
				descriptor[field] !== own[field] &&
				this.#unwrap(descriptor[field]) === own[field],
		);

		return real.length > 0
			? [
					target,
					key,
					{
						...descriptor,
						...Object.fromEntries(
							real.map((field) => [field, own[field]]),
						),
					},
				]
			: args;
	}

	/**
	 * Brings the stand-in in line with what `trap` reported for the real
	 * target, and returns the result the engine will accept for it. `key` and
	 * `caller` are the caller's own key and descriptor for property traps.
	 */
	report(
		trap: string,
		key: PropertyKey,
		result: unknown,
		caller?: PropertyDescriptor,
	): unknown {
		switch (trap) {
			case 'get': {
				const pinned = this.#pinned(key);

				if (!pinned) return result;

				return 'value' in pinned
					? pinned.value
					: pinned.get
						? result
						: undefined;
			}

			case 'getOwnPropertyDescriptor': {
				const descriptor = result as PropertyDescriptor | undefined;

				if (!descriptor) {
					this.#remove(key);

					return result;
				}

				const pinned = this.#pinned(key);

				if (pinned) return pinned;

				this.#copy(key, descriptor);

				return result;
			}

			case 'defineProperty': {
				if (!result) return result;

				// The engine holds the caller's descriptor against the stand-in.
				// A pinned copy reports the proxy's value; a caller redefining it
				// with any other value (only a no-op on the real target) is refused.
				const pinned = this.#pinned(key);

				if (pinned)
					return accessors.every(
						(field) =>
							!caller ||
							!(field in caller) ||
							Object.is(caller[field], pinned[field]),
					);

				const descriptor = this.#describe(key);

				// The copy takes the caller's value, getter and setter.
				if (descriptor) this.#copy(key, { ...descriptor, ...caller });

				return result;
			}

			case 'deleteProperty':
				if (result) this.#remove(key);

				return result;

			case 'has':
				if (!result) this.#remove(key);

				return result;

			case 'ownKeys':
			case 'isExtensible':
			case 'preventExtensions':
			case 'getPrototypeOf':
			case 'setPrototypeOf':
				this.#lock();

				return result;
		}

		return result;
	}

	/** The stand-in's own property, when the invariants pin it to exactly that. */
	#pinned(key: PropertyKey): PropertyDescriptor | undefined {
		if (this.#blank) return undefined;

		const own = Reflect.getOwnPropertyDescriptor(this.object, key);

		return own && isPinned(own) ? own : undefined;
	}

	/** Copies a property the stand-in is required to have. */
	#copy(key: PropertyKey, descriptor: PropertyDescriptor): void {
		if (!descriptor.configurable || !Reflect.isExtensible(this.object)) {
			this.#blank = false;
			Reflect.defineProperty(this.object, key, descriptor);
		}
	}

	/** Drops a copy of a property the real target no longer has. */
	#remove(key: PropertyKey): void {
		if (Object.hasOwn(this.object, key))
			Reflect.deleteProperty(this.object, key);
	}

	/** Follows the real target into non-extensibility. */
	#lock(): void {
		if (Reflect.isExtensible(this.#target)) return;

		this.#blank = false;

		const keys = Reflect.ownKeys(this.#target);
		const present = new Set<PropertyKey>(keys);

		for (const key of Reflect.ownKeys(this.object))
			if (!present.has(key)) Reflect.deleteProperty(this.object, key);

		for (const key of keys) {
			const descriptor = this.#pinned(key)
				? undefined
				: this.#describe(key);

			if (descriptor)
				Reflect.defineProperty(this.object, key, descriptor);
		}

		if (Reflect.isExtensible(this.object)) {
			Reflect.setPrototypeOf(
				this.object,
				Reflect.getPrototypeOf(this.#target),
			);
			Reflect.preventExtensions(this.object);
		}
	}
}
