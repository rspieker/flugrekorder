import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { describe, test } from 'node:test';
import { each } from 'template-literal-each';
import { create, isFlugrekorder, type Rekording } from '../source/flugrekorder';
import { createTestProxyRecorder, type Improbability, isProxyTag } from './test-helpers';

// Finds all apply records for a given method name by cross-referencing the
// preceding get record's $proxy result with apply origin.source.
function appliesFor(
	records: Array<Rekording>,
	method: string,
): Array<Rekording> {
	const found = records.find(
		(r) =>
			r.trap === 'get' &&
			r.origin !== null &&
			'key' in r.origin &&
			r.origin.key === method,
	);
	if (isProxyTag(found?.result)) {
		const fnId = found.result.$proxy;

		return records.filter(
			(r) =>
				r.trap === 'apply' &&
				r.origin !== null &&
				'source' in r.origin &&
				r.origin.source === fnId,
		);
	}

	return [];
}

describe('test/boundary', () => {
	describe('native objects', () => {
		test('objects with internal slots', () => {
			each`
				message        | input                       | access                                 | expect
				-------------- | --------------------------- | -------------------------------------- | -------
				Array.length   | ${[1, 2, 3]}                | ${(f: Improbability) => f.length}      | ${3}
				Map.size       | ${new Map([['a', 1]])}      | ${(f: Improbability) => f.size}        | ${1}
				Map.get        | ${new Map([['a', 1]])}      | ${(f: Improbability) => f.get('a')}    | ${1}
				Set.size       | ${new Set([1, 2, 3])}       | ${(f: Improbability) => f.size}        | ${3}
				Set.has        | ${new Set([1, 2, 3])}       | ${(f: Improbability) => f.has(1)}      | ${true}
				Date.getTime   | ${new Date(0)}              | ${(f: Improbability) => f.getTime()}   | ${0}
			`(({ message, input, access, expect }: Improbability) => {
				// arrange
				const p = create(input, { callback: () => {} });

				// act
				// assert
				assert.strictEqual(access(p), expect, message);
			});
		});

		test('Map: set/get/delete of an object value are recorded', () => {
			// arrange
			const obj = { id: 1 };
			const { records, proxy } = createTestProxyRecorder(new Map<string, typeof obj>())

			// act
			proxy.set('k', obj);
			const retrieved = proxy.get('k');
			const deleted = proxy.delete('k');

			// assert
			const [setRec] = appliesFor(records, 'set');
			assert.ok(setRec, 'set call recorded');
			assert.strictEqual(
				(setRec?.args[2] as Improbability)[0],
				'k',
				'set key in args',
			);
			assert.ok(
				isProxyTag(setRec?.result),
				'set returns the Map as proxy',
			);

			const [getRec] = appliesFor(records, 'get');
			assert.ok(getRec, 'get call recorded');
			assert.strictEqual(
				(getRec?.args[2] as Improbability)[0],
				'k',
				'get key in args',
			);
			assert.ok(
				isProxyTag(getRec?.result),
				'get result is the stored object (proxied)',
			);
			assert.ok(
				isFlugrekorder(retrieved as object),
				'retrieved value is a proxy',
			);

			const [deleteRec] = appliesFor(records, 'delete');
			assert.ok(deleteRec, 'delete call recorded');
			assert.strictEqual(
				(deleteRec?.args[2] as Improbability)[0],
				'k',
				'delete key in args',
			);
			assert.strictEqual(
				deleteRec?.result,
				true,
				'delete result recorded as true',
			);
			assert.strictEqual(deleted, true, 'delete return value is true');
		});

		test('Set: add/has/delete of an object are recorded', () => {
			// arrange
			const obj = { id: 1 };
			const { records, proxy } = createTestProxyRecorder(new Set<typeof obj>());

			// act
			proxy.add(obj);
			const before = proxy.has(obj);
			proxy.delete(obj);
			const after = proxy.has(obj);

			// assert
			const [addRec] = appliesFor(records, 'add');
			assert.ok(addRec, 'add call recorded');
			assert.ok(
				isProxyTag(addRec?.result),
				'add returns the Set as proxy',
			);

			const hasRecs = appliesFor(records, 'has');
			assert.strictEqual(
				hasRecs.length,
				2,
				'has called twice — both recorded',
			);
			assert.strictEqual(
				hasRecs[0]?.result,
				true,
				'first has: true (after add)',
			);
			assert.strictEqual(
				hasRecs[1]?.result,
				false,
				'second has: false (after delete)',
			);
			assert.strictEqual(
				before,
				true,
				'has return value correct before delete',
			);
			assert.strictEqual(
				after,
				false,
				'has return value correct after delete',
			);

			const [deleteRec] = appliesFor(records, 'delete');
			assert.ok(deleteRec, 'delete call recorded');
			assert.strictEqual(
				deleteRec?.result,
				true,
				'delete result recorded as true',
			);
		});

		test('WeakMap: set/get/delete of an object value are recorded', () => {
			// arrange
			const key = { id: 'key' };
			const value = { data: 42 };
			const { records, proxy } = createTestProxyRecorder(new WeakMap<typeof key, typeof value>());

			// act
			proxy.set(key, value);
			const retrieved = proxy.get(key);
			const deleted = proxy.delete(key);

			// assert
			const [setRec] = appliesFor(records, 'set');
			assert.ok(setRec, 'set call recorded');
			assert.ok(
				(setRec?.args[2] as Improbability)[0],
				'key arg present in recording',
			);
			assert.ok(
				isProxyTag(setRec?.result),
				'set returns the WeakMap as proxy',
			);

			const [getRec] = appliesFor(records, 'get');
			assert.ok(getRec, 'get call recorded');
			assert.ok(
				isProxyTag(getRec?.result),
				'get result is the stored value (proxied)',
			);
			assert.ok(
				isFlugrekorder(retrieved as object),
				'retrieved value is a proxy',
			);
			assert.strictEqual(
				(retrieved as typeof value)?.data,
				42,
				'retrieved value is correct',
			);

			const [deleteRec] = appliesFor(records, 'delete');
			assert.ok(deleteRec, 'delete call recorded');
			assert.strictEqual(
				deleteRec?.result,
				true,
				'delete result recorded as true',
			);
			assert.strictEqual(deleted, true, 'delete return value is true');
		});

		test('WeakSet: add/has/delete of an object are recorded', () => {
			// arrange
			const obj = { id: 1 };
			const { records, proxy: p } = createTestProxyRecorder(new WeakSet<typeof obj>());

			// act
			p.add(obj);
			const before = p.has(obj);
			p.delete(obj);
			const after = p.has(obj);

			// assert
			const [addRec] = appliesFor(records, 'add');
			assert.ok(addRec, 'add call recorded');
			assert.ok(
				isProxyTag(addRec?.result),
				'add returns the WeakSet as proxy',
			);

			const hasRecs = appliesFor(records, 'has');
			assert.strictEqual(
				hasRecs.length,
				2,
				'has called twice — both recorded',
			);
			assert.strictEqual(
				hasRecs[0]?.result,
				true,
				'first has: true (after add)',
			);
			assert.strictEqual(
				hasRecs[1]?.result,
				false,
				'second has: false (after delete)',
			);
			assert.strictEqual(
				before,
				true,
				'has return value correct before delete',
			);
			assert.strictEqual(
				after,
				false,
				'has return value correct after delete',
			);

			const [deleteRec] = appliesFor(records, 'delete');
			assert.ok(deleteRec, 'delete call recorded');
			assert.strictEqual(
				deleteRec?.result,
				true,
				'delete result recorded as true',
			);
		});
	});

	describe('C++ binding boundary', () => {
		test('wrapping http.Server and completing a full request lifecycle does not crash', async () => {
			// arrange
			// Before the fix, wrapping an http.Server caused a fatal V8 abort:
			// GetAlignedPointerFromInternalField on a Proxy has no internal fields.
			const raw = createServer((_req, res) => res.end('ok'));
			const server = create(raw, { only: ['apply'], callback: () => {} });

			// act
			// assert
			await new Promise<void>((resolve) => {
				server.listen(0, () => {
					const { port } = raw.address() as { port: number };
					fetch(`http://127.0.0.1:${port}/`).then(() => {
						server.close(() => resolve());
					});
				});
			});
		});

		test('C++ binding objects returned via get are not proxied', async () => {
			// arrange
			// The isECMABuiltin guard lets Map/Set/Date be proxied safely but returns
			// C++ binding objects (TCP handles, ConnectionsList, …) unwrapped. If they
			// were proxied, passing them to native code would crash V8 fatally.
			const raw = createServer();

			// act
			// assert
			await new Promise<void>((resolve) => {
				raw.listen(0, () => {
					const server = create(raw, { callback: () => {} });
					const handle = (server as Improbability)._handle;

					assert.ok(
						handle != null,
						'server has a handle after listening',
					);
					assert.strictEqual(
						isFlugrekorder(handle),
						false,
						'TCP handle is not a flugrekorder proxy',
					);

					raw.close(() => resolve());
				});
			});
		});

		test('defineProperty: C++ binding values in descriptors are not wrapped', async () => {
			// arrange
			// When listen() runs with `this = serverProxy`, Node.js assigns this._handle = new TCP()
			// which routes through Reflect.set → defineProperty trap with descriptor.value = tcpHandle.
			const raw = createServer((_req, res) => res.end('ok'));
			const server = create(raw, { callback: () => {} });

			// act
			// assert
			await new Promise<void>((resolve) => {
				server.listen(0, () => {
					assert.strictEqual(
						isFlugrekorder((server as Improbability)._handle),
						false,
						'TCP handle stored via defineProperty is not proxied',
					);
					server.close(() => resolve());
				});
			});
		});

		test('getOwnPropertyDescriptor: C++ binding values in returned descriptors are not wrapped', async () => {
			// arrange
			const raw = createServer();

			// act
			// assert
			await new Promise<void>((resolve) => {
				raw.listen(0, () => {
					const server = create(raw, { callback: () => {} });
					const desc = Object.getOwnPropertyDescriptor(
						server as Improbability,
						'_handle',
					);

					assert.ok(
						desc?.value != null,
						'descriptor has a value after listening',
					);
					assert.strictEqual(
						isFlugrekorder(desc?.value),
						false,
						'TCP handle in descriptor is not proxied',
					);
					raw.close(() => resolve());
				});
			});
		});
	});

	describe('slot detection', () => {
		test('slot detection: non-TypeError exceptions during probe do not misclassify the target', () => {
			// arrange
			// The slot probe catches TypeErrors with specific messages; any other exception
			// (e.g. RangeError) must not be mistaken for a slot check failure.
			class ThrowsOnProbe {
				get value(): number {
					throw new RangeError('not a slot error');
				}
			}
			const p = create(new ThrowsOnProbe(), { callback: () => {} });

			// act
			// assert
			assert.throws(() => (p as Improbability).value, RangeError);
		});
	});

	describe('apply:native', () => {
		test('apply:native is emitted when a function throws "Illegal invocation" and retries with real this', () => {
			// arrange
			// A WeakSet keyed by the real object: a Proxy has distinct identity from its
			// target, so has(proxy) returns false while has(realTarget) returns true.
			const isReal = new WeakSet<object>();
			const obj: Record<string, unknown> = {
				nativeLike: function (this: Improbability) {
					if (!isReal.has(this))
						throw new TypeError('Illegal invocation');
					return 'ok';
				},
			};
			isReal.add(obj);
			const { records, proxy: p } = createTestProxyRecorder(obj as Improbability);

			// act
			// assert
			const result = (p as Improbability).nativeLike();
			assert.strictEqual(
				result,
				'ok',
				'correct return value from the retry',
			);

			const nativeRec = records.find((r) => r.trap === 'apply:native');
			assert.ok(nativeRec, 'apply:native record emitted');

			const isUnwrapTag = (
				v: unknown,
			): v is { $unwrap: { $proxy: string } } =>
				typeof v === 'object' &&
				v !== null &&
				!Array.isArray(v) &&
				'$unwrap' in (v as object);

			assert.ok(
				isUnwrapTag(nativeRec?.args[1]),
				'raw target (real this) serialized as $unwrap in args',
			);
		});

		test('apply trap re-throws errors that are not "illegal invocation" TypeErrors', () => {
			// arrange
			// Only TypeErrors matching /illegal invocation/ trigger the apply:native retry;
			// all other errors must propagate unchanged.
			const target = {
				fn() {
					throw new TypeError('something went wrong');
				},
			};
			const p = create(target, { callback: () => {} });

			// act
			// assert
			assert.throws(
				() => (p as Improbability).fn(),
				(e: unknown) =>
					e instanceof TypeError &&
					String(e).includes('something went wrong'),
			);
		});
	});
});
