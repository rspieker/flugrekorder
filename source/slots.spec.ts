import { test } from 'node:test';
import assert from 'node:assert/strict';
import { boundMethod, hasInternalSlots } from './slots';

// ─── hasInternalSlots: probe trap handlers ────────────────────────────────────
//
// The probe Proxy inside hasInternalSlots traps set/defineProperty/deleteProperty/
// setPrototypeOf so that a getter which mutates its own receiver doesn't corrupt
// the original target during probing. These traps are unreachable through the
// integration layer: no real-world proxied target has a getter that does this.

test('hasInternalSlots: probe set trap prevents mutation of the original during probing', () => {
	class Target {
		get x() {
			(this as unknown as Record<string, unknown>).side = true;
			return 1;
		}
	}
	const obj = new Target();
	const result = hasInternalSlots(obj);

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

test('hasInternalSlots: probe defineProperty trap prevents mutation of the original during probing', () => {
	class Target {
		get x() {
			Object.defineProperty(this, 'side', { value: true });
			return 1;
		}
	}
	const obj = new Target();
	const result = hasInternalSlots(obj);

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

test('hasInternalSlots: probe deleteProperty trap prevents mutation of the original during probing', () => {
	class Target {
		side = true;
		get x() {
			delete (this as unknown as Record<string, unknown>).side;
			return 1;
		}
	}
	const obj = new Target();
	const result = hasInternalSlots(obj);

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

test('hasInternalSlots: probe setPrototypeOf trap prevents prototype mutation of the original during probing', () => {
	class Target {
		get x() {
			Object.setPrototypeOf(this, null);
			return 1;
		}
	}
	const obj = new Target();
	const originalProto = Object.getPrototypeOf(obj);
	const result = hasInternalSlots(obj);

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

// ─── boundMethod ──────────────────────────────────────────────────────────────

test('boundMethod: returns the same function instance on repeated calls', () => {
	const target = {};
	const fn = () => {};
	const first = boundMethod(target, 'key', fn);
	const second = boundMethod(target, 'key', fn);

	assert.strictEqual(first, second, 'same instance returned from cache on second call');
});

test('boundMethod: binds fn to the target as its this', () => {
	let captured: unknown;
	function fn(this: unknown) {
		captured = this;
	}
	const target = {};
	const bound = boundMethod(target, 'key', fn);
	(bound as () => void)();

	assert.strictEqual(captured, target, 'this inside bound call is the original target');
});
