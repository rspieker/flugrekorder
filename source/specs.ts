import { boundMethod, hasInternalSlots } from './slots';
import type { Proxiable } from './types';

/** A function that conditionally wraps a value in a proxy. */
export type Wrapper = (v: unknown) => unknown;

/** Pre/post hooks for a Reflect trap — transform args before dispatch and/or wrap the result. */
type Spec = {
	pre?: (
		args: Array<unknown>,
		wrap: Wrapper,
		known: Wrapper,
	) => Array<unknown>;
	post?: (result: unknown, args: Array<unknown>, wrap: Wrapper) => unknown;
};

/** Per-trap hooks that transform arguments and results to maintain proxy transparency. */
export const specs: Partial<Record<string, Spec>> = {
	get: {
		// For targets with internal slots (Map, Set, WeakMap, WeakSet, Date …),
		// use the real target as the Reflect.get receiver so that getter-based
		// slot checks (e.g. Map.prototype.size) don't throw TypeError.
		pre: ([target, key, receiver], _wrap, _known) => [
			target,
			key,
			hasInternalSlots(target as Proxiable) ? target : receiver,
		],
		// For the same targets, bind method results to the real target before
		// wrapping so that apply-level slot checks (e.g. Map.prototype.get)
		// also pass.  The bind cache ensures proxy stability.
		post: (result, [target, key], wrap) => {
			if (key === 'prototype') return result;
			if (
				typeof result === 'function' &&
				hasInternalSlots(target as Proxiable)
			) {
				return wrap(
					boundMethod(target as object, key as PropertyKey, result),
				);
			}
			return wrap(result);
		},
	},
	set: {
		pre: ([target, key, value, receiver], wrap) => [
			target,
			key,
			wrap(value),
			receiver,
		],
	},
	apply: {
		// thisArg is wrapped normally (it's always a graph node).
		// Call arguments are wrapped with known — only existing graph nodes
		// get proxied; plain data passes through and is inlined by serialize().
		pre: ([target, thisArg, callArgs], wrap, known) => [
			target,
			wrap(thisArg),
			(<Array<unknown>>callArgs).map(known),
		],
		post: (result, _args, wrap) => wrap(result),
	},
	construct: {
		pre: ([target, callArgs, newTarget], wrap) => [
			target,
			(<Array<unknown>>callArgs).map(wrap),
			newTarget,
		],
		post: (result, _args, wrap) => wrap(result),
	},
	defineProperty: {
		pre: (args, wrap) => {
			const [target, key, descriptor] = <
				[unknown, unknown, PropertyDescriptor]
			>args;
			const patch: PropertyDescriptor = {};

			if (descriptor.value != null) patch.value = wrap(descriptor.value);
			if (typeof descriptor.get === 'function')
				patch.get = <() => unknown>wrap(descriptor.get);
			if (typeof descriptor.set === 'function')
				patch.set = <(v: unknown) => void>wrap(descriptor.set);

			return Object.keys(patch).length > 0
				? [target, key, { ...descriptor, ...patch }]
				: args;
		},
	},
	getOwnPropertyDescriptor: {
		post: (result, _args, wrap) => {
			const desc = <PropertyDescriptor | undefined>result;

			if (!desc) return result;

			const patch: PropertyDescriptor = {};

			if (desc.value != null) patch.value = wrap(desc.value);
			if (typeof desc.get === 'function')
				patch.get = <() => unknown>wrap(desc.get);
			if (typeof desc.set === 'function')
				patch.set = <(v: unknown) => void>wrap(desc.set);

			return Object.keys(patch).length > 0
				? { ...desc, ...patch }
				: result;
		},
	},
};
