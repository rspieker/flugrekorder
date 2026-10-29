import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { each } from 'template-literal-each';
import type { Improbability } from '../test/test-helpers.ts';
import { isCallTrap, isPropertyTrap, isProxiable } from './types.ts';

describe('source/types', () => {
	describe('isProxiable', () => {
		test('returns true for proxiable values', () => {
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

		test('returns false for non-proxiable values', () => {
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
	});

	describe('isPropertyTrap', () => {
		test('returns true for the traps about a property key', () => {
			// arrange
			each<{ trap: string }>`
				trap
				------------------------
				get
				set
				has
				deleteProperty
				defineProperty
				getOwnPropertyDescriptor
			`(({ trap }) => {
				// act
				// assert
				assert.ok(isPropertyTrap(trap), trap);
			});
		});

		test('returns false for every other trap', () => {
			// arrange
			each<{ trap: string; label: string }>`
				trap               | label
				------------------ | ------------------------------------------
				ownKeys            | about keys, not one key
				getPrototypeOf     | starts with "get"
				setPrototypeOf     | starts with "set"
				isExtensible       | about the object
				preventExtensions  | about the object
				apply              | call trap
				construct          | call trap
				Get                | names are case-sensitive
			`(({ trap, label }) => {
				// act
				// assert
				assert.strictEqual(isPropertyTrap(trap), false, label);
			});
		});
	});

	describe('isCallTrap', () => {
		test('returns true for the traps that invoke a callable', () => {
			// arrange
			each<{ trap: string; label: string }>`
				trap              | label
				----------------- | ------------------------------------------------
				apply             | Reflect trap
				construct         | Reflect trap
				apply:native      | synthetic: native method retried on the unwrapped receiver
				construct:native  | synthetic: reserved, not emitted yet
				apply:structure   | synthetic: structured clone retried on unwrapped arguments
				apply:private     | synthetic: private field access retried on the unwrapped instance
			`(({ trap, label }) => {
				// act
				// assert
				assert.ok(isCallTrap(trap), label);
			});
		});

		test('returns false for every other trap', () => {
			// arrange
			each<{ trap: string; label: string }>`
				trap           | label
				-------------- | ----------------------------------------
				get            | property trap
				ownKeys        | about keys
				getPrototypeOf | about the object
				apply:unknown  | not a synthetic variant
				Apply          | names are case-sensitive
			`(({ trap, label }) => {
				// act
				// assert
				assert.strictEqual(isCallTrap(trap), false, label);
			});
		});
	});
});
