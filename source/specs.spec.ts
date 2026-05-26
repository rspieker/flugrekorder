import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { each } from 'template-literal-each';
import type { Improbability } from '../test/test-helpers';
import { isECMABuiltin, isUnsafeBinding } from './specs';

describe('source/specs', () => {
	describe('isECMABuiltin', () => {
		test('returns true for ECMAScript built-in instances', () => {
			each<{ value: Improbability; label: string }>`
				value                               | label
				----------------------------------- | ----------------
				${new Map()}                        | Map
				${new Set()}                        | Set
				${new WeakMap()}                    | WeakMap
				${new WeakSet()}                    | WeakSet
				${new Promise(() => {})}            | Promise
				${new Date()}                       | Date
				${/regex/}                          | RegExp literal
				${new RegExp(`x${12}`)}             | new RegExp
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
			`(({ value, label }: Improbability) => {
				assert.ok(isECMABuiltin(value), label);
			});
		});

		test('returns true for subclasses of ECMAScript built-ins', () => {
			// instanceof walks the prototype chain — a JS subclass of Map has the
			// same internal-slot behaviour and must be treated the same way.
			class MyMap extends Map {}
			class MySet extends Set {}
			class MyUint8Array extends Uint8Array {}

			each<{ value: Improbability; label: string }>`
				value                  | label
				---------------------- | -----------------
				${new MyMap()}         | subclass of Map
				${new MySet()}         | subclass of Set
				${new MyUint8Array()}  | subclass of Uint8Array
			`(({ value, label }: Improbability) => {
				assert.ok(isECMABuiltin(value), label);
			});
		});

		test('returns false for plain objects, functions, and primitives', () => {
			each<{ value: Improbability; label: string }>`
				value              | label
				------------------ | ---------------
				${{}}              | plain object
				${[]}              | array
				${() => {}}        | arrow function
				${class Foo {}}    | class
				${null}            | null
				${undefined}       | undefined
				${42}              | number
				${'string'}        | string
				${true}            | boolean
			`(({ value, label }: Improbability) => {
				assert.strictEqual(isECMABuiltin(value), false, label);
			});
		});
	});

	describe('isUnsafeBinding', () => {
		test('returns false for ECMAScript built-ins (safe to proxy despite internal slots)', () => {
			each<{ value: Improbability; label: string }>`
				value                               | label
				----------------------------------- | -------
				${new Map()}                        | Map
				${new Set()}                        | Set
				${new WeakMap()}                    | WeakMap
				${new WeakSet()}                    | WeakSet
				${new Date()}                       | Date
			`(({ value, label }: Improbability) => {
				assert.strictEqual(isUnsafeBinding(value), false, label);
			});
		});

		test('returns false for plain objects and primitives (no internal slots)', () => {
			each<{ value: Improbability; label: string }>`
				value       | label
				----------- | ----------
				${{}}       | plain object
				${[]}       | array
				${null}     | null
				${42}       | number
			`(({ value, label }: Improbability) => {
				assert.strictEqual(isUnsafeBinding(value), false, label);
			});
		});
	});
});
