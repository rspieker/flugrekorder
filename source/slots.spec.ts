import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { boundMethod, hasInternalSlots } from './slots';

// ─── hasInternalSlots: probe trap handlers ────────────────────────────────────
//
// The probe Proxy inside hasInternalSlots traps set/defineProperty/deleteProperty/
// setPrototypeOf so that a getter which mutates its own receiver doesn't corrupt
// the original target during probing. These traps are unreachable through the
// integration layer: no real-world proxied target has a getter that does this.

describe('source/slots', () => {
	describe('hasInternalSlots', () => {
		test('probe set trap prevents mutation of the original during probing', () => {
			// arrange
			class Target {
				get x() {
					(this as unknown as Record<string, unknown>).side = true;
					return 1;
				}
			}
			const obj = new Target();

			// act
			const result = hasInternalSlots(obj);

			// assert
			assert.strictEqual(
				result,
				false,
				'getter that does not throw a slot TypeError → false',
			);
			assert.strictEqual(
				(obj as unknown as Record<string, unknown>).side,
				undefined,
				'set trap blocks getter from mutating the original',
			);
		});

		test('probe defineProperty trap prevents mutation of the original during probing', () => {
			// arrange
			class Target {
				get x() {
					Object.defineProperty(this, 'side', { value: true });
					return 1;
				}
			}
			const obj = new Target();

			// act
			const result = hasInternalSlots(obj);

			// assert
			assert.strictEqual(
				result,
				false,
				'getter that does not throw a slot TypeError → false',
			);
			assert.strictEqual(
				Object.getOwnPropertyDescriptor(obj, 'side'),
				undefined,
				'defineProperty trap blocks mutation of the original',
			);
		});

		test('probe deleteProperty trap prevents mutation of the original during probing', () => {
			// arrange
			class Target {
				side = true;
				get x() {
					delete (this as unknown as Record<string, unknown>).side;
					return 1;
				}
			}
			const obj = new Target();

			// act
			const result = hasInternalSlots(obj);

			// assert
			assert.strictEqual(
				result,
				false,
				'getter that does not throw a slot TypeError → false',
			);
			assert.strictEqual(
				obj.side,
				true,
				'deleteProperty trap blocks deletion from the original',
			);
		});

		test('probe setPrototypeOf trap prevents prototype mutation of the original during probing', () => {
			// arrange
			class Target {
				get x() {
					Object.setPrototypeOf(this, null);
					return 1;
				}
			}
			const obj = new Target();
			const originalProto = Object.getPrototypeOf(obj);

			// act
			const result = hasInternalSlots(obj);

			// assert
			assert.strictEqual(
				result,
				false,
				'getter that does not throw a slot TypeError → false',
			);
			assert.strictEqual(
				Object.getPrototypeOf(obj),
				originalProto,
				'setPrototypeOf trap blocks prototype change on the original',
			);
		});
	});

	describe('boundMethod', () => {
		test('returns the same function instance on repeated calls', () => {
			// arrange
			const target = {};
			const fn = () => {};
			const first = boundMethod(target, 'key', fn);
			const second = boundMethod(target, 'key', fn);

			// act
			// assert
			assert.strictEqual(
				first,
				second,
				'same instance returned from cache on second call',
			);
		});

		test('binds fn to the target as its this', () => {
			// arrange
			let captured: unknown;
			function fn(this: unknown) {
				captured = this;
			}
			const target = {};

			// act
			const bound = boundMethod(target, 'key', fn);
			(bound as () => void)();

			// assert
			assert.strictEqual(
				captured,
				target,
				'this inside bound call is the original target',
			);
		});
	});
});
