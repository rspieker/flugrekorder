// Positions in this file are asserted in test/trace.spec.ts — move nothing.
export function plain() {}
export class Located {}
export const arrow = () => {};
export const object = { method() {} };
export function call(fn: () => unknown): unknown {
	return fn();
}
