import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { each } from 'template-literal-each';
import type { Improbability } from '../test/test-helpers';
import { createErrorGuard, isError } from './errors';

describe('source/errors', () => {
	describe('isError', () => {
		test('returns false for non-Error values', () => {
			each<{ value: Improbability; label: string }>`
				value                               | label
				----------------------------------- | ------------
				${true}                             | boolean true
				${false}                            | boolean false
				${undefined}                        | undefined
				${null}                             | null
				${123}                              | number
				${'I am an Error'}                  | string
				${{}}                               | plain object
				${[]}                               | array
				${/regex/}                          | inline RegExp
				${new RegExp(`RegExp${12}`)}        | new RegExp
				${new String('boxed')}              | boxed String — object, not primitive
				${new Number(42)}                   | boxed Number — object, not primitive
				${new Boolean(false)}               | boxed Boolean — object, not primitive
				${new ArrayBuffer(8)}               | ArrayBuffer
				${new DataView(new ArrayBuffer(8))} | DataView
				${new Int8Array()}                  | Int8Array
				${new Uint8Array()}                 | Uint8Array
				${new Uint8ClampedArray()}          | Uint8ClampedArray
				${new Int16Array()}                 | Int16Array
				${new Uint16Array()}                | Uint16Array
				${new Int32Array()}                 | Int32Array
				${new Uint32Array()}                | Uint32Array
				${new Float32Array()}               | Float32Array
				${new Float64Array()}               | Float64Array
				${new BigInt64Array()}              | BigInt64Array
				${new BigUint64Array()}             | BigUint64Array
				${() => {}}                         | arrow function
				${async () => {}}                   | async arrow function
				${function () {}}                   | anonymous function expression
				${function* () {}}                  | anonymous generator function expression
				${async function () {}}             | async anonymous function expression
				${async function* () {}}            | async anonymous generator function expression
				${function q() {}}                  | named function expression
				${function* q() {}}                 | named generator function expression
				${async function q() {}}            | async named function expression
				${async function* q() {}}           | async named generator function expression
				${class {}}                         | anonymous class
				${class Q {}}                       | named class
			`(({ value, label }: Improbability) => {
				assert.ok(!isError(value), label);
			});
		});

		test('returns true for Error instances', () => {
			class CustomError extends Error {}

			each<{ value: Improbability; label: string }>`
				value                          | label
				------------------------------ | ----------------
				${new Error()}                 | Error
				${new Error('with message')}   | Error with message
				${new TypeError()}             | TypeError
				${new RangeError()}            | RangeError
				${new SyntaxError()}           | SyntaxError
				${new CustomError()}           | custom Error subclass
			`(({ value, label }: Improbability) => {
				assert.ok(isError(value), label);
			});
		});
	});

	describe('createErrorGuard', () => {
		describe('without contains', () => {
			const isTypeError = createErrorGuard('TypeError');

			test('returns false for non-Error values', () => {
				each<{ value: Improbability; label: string }>`
					value              | label
					------------------ | ---------------
					${null}            | null
					${undefined}       | undefined
					${'TypeError: x'}  | string
					${{name:'TypeError'}} | plain object with matching name
				`(({ value, label }: Improbability) => {
					assert.ok(!isTypeError(value), label);
				});
			});

			test('returns false for Error with non-matching name', () => {
				each<{ value: Improbability; label: string }>`
					value               | label
					------------------- | ---------------
					${new Error()}      | Error (name "Error")
					${new RangeError()} | RangeError
				`(({ value, label }: Improbability) => {
					assert.ok(!isTypeError(value), label);
				});
			});

			test('returns true for Error with matching name', () => {
				each<{ value: Improbability; label: string }>`
					value                         | label
					----------------------------- | ---------------------------
					${new TypeError()}            | TypeError no message
					${new TypeError('bad input')} | TypeError with message
				`(({ value, label }: Improbability) => {
					assert.ok(isTypeError(value), label);
				});
			});
		});

		describe('with contains', () => {
			const isIllegalInvocation = createErrorGuard(
				'TypeError',
				/illegal invocation/i,
			);

			test('returns false when message does not match', () => {
				each<{ value: Improbability; label: string }>`
					value                                        | label
					-------------------------------------------- | ---------------------------
					${new TypeError('bad input')}                | TypeError, wrong message
					${new TypeError()}                           | TypeError, no message
					${new RangeError('Illegal invocation')}      | wrong name, matching message
				`(({ value, label }: Improbability) => {
					assert.ok(!isIllegalInvocation(value), label);
				});
			});

			test('returns true when name and message both match', () => {
				each<{ value: Improbability; label: string }>`
					value                                           | label
					----------------------------------------------- | ------------------
					${new TypeError('Illegal invocation')}          | exact phrase
					${new TypeError('Illegal invocation: fn.call')} | phrase with suffix
				`(({ value, label }: Improbability) => {
					assert.ok(isIllegalInvocation(value), label);
				});
			});
		});
	});
});
