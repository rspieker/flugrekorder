import test from 'tape';
import { boundMethod, hasInternalSlots } from './slots';

// ─── hasInternalSlots: probe trap handlers ────────────────────────────────────
//
// The probe Proxy inside hasInternalSlots traps set/defineProperty/deleteProperty/
// setPrototypeOf so that a getter which mutates its own receiver doesn't corrupt
// the original target during probing. These traps are unreachable through the
// integration layer: no real-world proxied target has a getter that does this.

test('hasInternalSlots: probe set trap prevents mutation of the original during probing', (t) => {
	class Target {
		get x() {
			(this as unknown as Record<string, unknown>).side = true;
			return 1;
		}
	}
	const obj = new Target();
	const result = hasInternalSlots(obj);

	t.equal(
		result,
		false,
		'getter that does not throw a slot TypeError → false',
	);
	t.equal(
		(obj as unknown as Record<string, unknown>).side,
		undefined,
		'set trap blocks getter from mutating the original',
	);
	t.end();
});

test('hasInternalSlots: probe defineProperty trap prevents mutation of the original during probing', (t) => {
	class Target {
		get x() {
			Object.defineProperty(this, 'side', { value: true });
			return 1;
		}
	}
	const obj = new Target();
	const result = hasInternalSlots(obj);

	t.equal(
		result,
		false,
		'getter that does not throw a slot TypeError → false',
	);
	t.equal(
		Object.getOwnPropertyDescriptor(obj, 'side'),
		undefined,
		'defineProperty trap blocks mutation of the original',
	);
	t.end();
});

test('hasInternalSlots: probe deleteProperty trap prevents mutation of the original during probing', (t) => {
	class Target {
		side = true;
		get x() {
			delete (this as unknown as Record<string, unknown>).side;
			return 1;
		}
	}
	const obj = new Target();
	const result = hasInternalSlots(obj);

	t.equal(
		result,
		false,
		'getter that does not throw a slot TypeError → false',
	);
	t.equal(
		obj.side,
		true,
		'deleteProperty trap blocks deletion from the original',
	);
	t.end();
});

test('hasInternalSlots: probe setPrototypeOf trap prevents prototype mutation of the original during probing', (t) => {
	class Target {
		get x() {
			Object.setPrototypeOf(this, null);
			return 1;
		}
	}
	const obj = new Target();
	const originalProto = Object.getPrototypeOf(obj);
	const result = hasInternalSlots(obj);

	t.equal(
		result,
		false,
		'getter that does not throw a slot TypeError → false',
	);
	t.equal(
		Object.getPrototypeOf(obj),
		originalProto,
		'setPrototypeOf trap blocks prototype change on the original',
	);
	t.end();
});

// ─── boundMethod ──────────────────────────────────────────────────────────────

test('boundMethod: returns the same function instance on repeated calls', (t) => {
	const target = {};
	const fn = () => {};
	const first = boundMethod(target, 'key', fn);
	const second = boundMethod(target, 'key', fn);

	t.equal(first, second, 'same instance returned from cache on second call');
	t.end();
});

test('boundMethod: binds fn to the target as its this', (t) => {
	let captured: unknown;
	function fn(this: unknown) {
		captured = this;
	}
	const target = {};
	const bound = boundMethod(target, 'key', fn);
	(bound as () => void)();

	t.equal(captured, target, 'this inside bound call is the original target');
	t.end();
});
