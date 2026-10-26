import { createErrorGuard } from './errors.ts';
import type { Graph } from './graph.ts';
import type { RetryFlow } from './types.ts';

/** Returns the underlying target if `value` is a proxy known to `graph`, otherwise `value` unchanged. */
export function unwrap(graph: Graph | undefined, value: unknown): unknown {
	return graph?.unwrap(value) ?? value;
}

const isDataCloneDOMException = createErrorGuard('DataCloneError');
// What engines report when `this` is a proxy rather than the instance that
// holds a `#private` field or method:
//   V8:             "Cannot read private member #x from an object whose class
//                   did not declare it", "Receiver must be an instance of class X"
//   SpiderMonkey:   "can't access private field or method: object is not the right class"
//   JavaScriptCore: "Cannot access invalid private field", "Cannot access private method"
const isTypeErrorPrivateMember = createErrorGuard(
	'TypeError',
	/private member|private field|private method|receiver must be an instance of class/i,
);
// What engines report when a host method (DOM, Node.js) is called on a proxy:
//   V8:             "Illegal invocation"
//   SpiderMonkey:   "'querySelector' called on an object that does not implement interface Document."
//   JavaScriptCore: "Can only call Document.querySelector on instances of Document",
//                   "The Document.body getter can only be used on instances of Document"
const isTypeErrorIllegalInvocation = createErrorGuard(
	'TypeError',
	/illegal invocation|does not implement interface|can only call .+ on instances of|can only be used on instances of/i,
);

/** Retry handlers for native boundary crossings — defined once at module level. */
export const retryFlows: Array<RetryFlow> = [
	{
		// Native methods (console.log, DOM APIs, http.Server) check the internal
		// [[Receiver]] slot and throw "Illegal invocation" when called through a
		// proxy. Unwrap the real target from the graph and retry as the receiver.
		is: (trap, error) =>
			trap === 'apply' && isTypeErrorIllegalInvocation(error),
		trap: 'apply:native',
		handle: (graph, fn, thisArg, argList) => {
			const realThis = unwrap(graph, thisArg);
			return {
				args: [fn, realThis, argList],
				result: Reflect.apply(fn, realThis, argList),
			};
		},
	},
	{
		// structuredClone and postMessage can't clone proxy objects — they throw a
		// DataCloneError. Unwrap any proxy arguments to their real targets and retry.
		is: (trap, error) => trap === 'apply' && isDataCloneDOMException(error),
		trap: 'apply:structure',
		handle: (graph, fn, thisArg, argList) => {
			const unwrappedArgs = argList.map((arg) => unwrap(graph, arg));
			return {
				args: [fn, thisArg, unwrappedArgs],
				result: Reflect.apply(fn, thisArg, unwrappedArgs),
			};
		},
	},
	{
		// Private fields (#field) use brand checking — accessing #field on a proxy
		// (rather than the original instance) throws "Cannot read private member".
		// Unwrap the real instance from the graph and use it as the receiver.
		is: (trap, error, bind) =>
			bind !== false &&
			trap === 'apply' &&
			isTypeErrorPrivateMember(error),
		trap: 'apply:private',
		handle: (graph, fn, thisArg, argList) => {
			const realThis = unwrap(graph, thisArg);
			return {
				args: [fn, realThis, argList],
				result: Reflect.apply(fn, realThis, argList),
			};
		},
	},
	{
		// A getter that reads a #private field hits the same brand check, but the
		// apply retry doesn't apply here. Re-invoke Reflect.get with the real target
		// as its own receiver so the brand check passes.
		is: (trap, error, bind) =>
			bind !== false && trap === 'get' && isTypeErrorPrivateMember(error),
		handle: (_graph, target, propertyKey) => ({
			result: Reflect.get(target, propertyKey, target),
		}),
	},
];
