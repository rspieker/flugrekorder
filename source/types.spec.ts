import assert from 'node:assert/strict';
import { test } from 'node:test';
import { each } from 'template-literal-each';
import { isProxiable } from './types';

// biome-ignore lint/suspicious/noExplicitAny: Improbability is the intentional escape hatch for test assertions that cannot be typed otherwise
type Improbability = any;

test('isProxiable: returns true for proxiable values', () => {
	// arrange
	each<{ value: Improbability; label: string }>`
		value                               | label
		----------------------------------- | ------------
		${{}}                               | plain object
		${[]}                               | array
		${new Map()}                        | Map
		${new Set()}                        | Set
		${new WeakMap()}                    | WeakMap
		${new WeakSet()}                    | WeakSet
		${new Date()}                       | Date
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
		// act
		// assert
		assert.ok(isProxiable(value), label);
	});
});

test('isProxiable: returns false for non-proxiable values', () => {
	// arrange
	each<{ value: Improbability; label: string }>`
		value         | label
		------------- | ----------------------------------------------------
		${null}       | null — typeof null === "object" but Proxy rejects it
		${undefined}  | undefined
		${1}          | number
		${NaN}        | NaN — typeof NaN === "number", not an object
		${'string'}   | string
		${true}       | boolean
		${Symbol()}   | symbol
		${42n}        | bigint
		${BigInt(42)} | deceptively similar to the boxed string/number/booleans
	`(({ value, label }: Improbability) => {
		// act
		// assert
		assert.strictEqual(isProxiable(value), false, label);
	});
});
