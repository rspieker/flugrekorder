import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { describe, test } from 'node:test';
import fc from 'fast-check';
import { each } from 'template-literal-each';
import {
	create,
	isFlugrekorder,
	type Rekording,
} from '../source/flugrekorder.ts';
import { bytes, type Instantiate } from './fixtures/module.ts';
import {
	createTestProxyRecorder,
	type Improbability,
	isProxyTag,
} from './test-helpers.ts';

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

const primitive = fc.oneof(
	fc.string(),
	fc.integer(),
	fc.boolean(),
	fc.constant(null),
	fc.constant(undefined),
);

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
			const { records, proxy } = createTestProxyRecorder(
				new Map<string, typeof obj>(),
			);

			// act
			proxy.set('k', obj);
			const retrieved = proxy.get('k');
			const deleted = proxy.delete('k');

			// assert
			const [setRec] = appliesFor(records, 'set');
			assert.ok(setRec, 'set call recorded');
			assert.strictEqual(
				(setRec.args[2] as Improbability)[0],
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
				(getRec.args[2] as Improbability)[0],
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
				(deleteRec.args[2] as Improbability)[0],
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
			const { records, proxy } = createTestProxyRecorder(
				new Set<typeof obj>(),
			);

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
			const { records, proxy } = createTestProxyRecorder(
				new WeakMap<typeof key, typeof value>(),
			);

			// act
			proxy.set(key, value);
			const retrieved = proxy.get(key);
			const deleted = proxy.delete(key);

			// assert
			const [setRec] = appliesFor(records, 'set');
			assert.ok(setRec, 'set call recorded');
			assert.ok(
				(setRec.args[2] as Improbability)[0],
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
			const { records, proxy: p } = createTestProxyRecorder(
				new WeakSet<typeof obj>(),
			);

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
			const { records, proxy: p } = createTestProxyRecorder(
				obj as Improbability,
			);

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

		test('apply:native with non-proxiable thisArg passes it directly to retry', () => {
			// When thisArg is null (not proxiable), isProxiable() is false and the retry
			// uses it unchanged — no graph lookup needed.
			const target = {
				fn() {
					throw new TypeError('Illegal invocation');
				},
			};
			const p = create(target, { callback: () => {} });
			const fnProxy = (p as Improbability).fn as (
				...args: never
			) => unknown;
			assert.throws(() => Reflect.apply(fnProxy, null, []), TypeError);
		});

		test('apply:native with thisArg from a different graph falls back to the proxy', () => {
			// When thisArg is a proxy from a different create() session, getByProxy()
			// returns undefined for it — the ?? fallback reuses the proxy as-is.
			const foreignProxy = create(
				{ id: 'foreign' },
				{ callback: () => {} },
			);
			const isReal = new WeakSet<object>();
			const obj: Record<string, unknown> = {
				fn(this: object) {
					if (!isReal.has(this))
						throw new TypeError('Illegal invocation');
					return 'ok';
				},
			};
			isReal.add(obj);
			const p = create(obj, { callback: () => {} });
			const fnProxy = (p as Improbability).fn as (
				...args: never
			) => unknown;
			assert.throws(
				() => Reflect.apply(fnProxy, foreignProxy, []),
				TypeError,
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

	describe('Node.js classes that check `this` themselves (ERR_INVALID_THIS)', () => {
		// URLSearchParams is written in JavaScript and rejects a receiver that is
		// not a URLSearchParams with a TypeError coded ERR_INVALID_THIS.
		const params = () => new URLSearchParams('a=1&b=2');

		test('methods retry with the real this and are recorded as apply:native', () => {
			// arrange
			each<{ act: (p: Improbability) => unknown; label: string }>`
				act                                                  | label
				---------------------------------------------------- | --------
				${(p: Improbability) => p.get('b')}                  | get
				${(p: Improbability) => p.has('a')}                  | has
				${(p: Improbability) => p.toString()}                | toString
				${(p: Improbability) => JSON.stringify([...p])}      | spread
			`(({ act, label }) => {
				const { records, proxy } = createTestProxyRecorder(params());

				// act
				const result = act(proxy);

				// assert
				assert.deepStrictEqual(result, act(params()), label);
				assert.ok(
					records.some((r) => r.trap === 'apply:native'),
					`${label} recorded as apply:native`,
				);
			});
		});

		test('getters retry with the real target as receiver and are recorded as get', () => {
			// arrange
			const { records, proxy } = createTestProxyRecorder(params());

			// act
			const size = (proxy as Improbability).size;

			// assert
			assert.strictEqual(size, 2);
			assert.deepStrictEqual(
				records.map((r) => [r.trap, r.result]),
				[['get', 2]],
			);
		});

		test('a TypeError with another code is not retried', () => {
			// arrange
			const target = {
				fn() {
					throw Object.assign(new TypeError('nope'), {
						code: 'ERR_INVALID_ARG_TYPE',
					});
				},
			};
			const p = create(target, { callback: () => {} });

			// act
			// assert
			assert.throws(() => (p as Improbability).fn(), {
				code: 'ERR_INVALID_ARG_TYPE',
			});
		});
	});

	describe('private fields (#)', () => {
		class Counter {
			#count = 0;
			increment() {
				this.#count++;
			}
			get value() {
				return this.#count;
			}
		}

		test('default (undefined): methods calling a #private method retry and emit apply:private', () => {
			// V8 reports these differently from #private fields: "Receiver must be
			// an instance of class Tally", rather than "… private member …".
			class Tally {
				#count = 1;
				read() {
					return this.#current();
				}
				#current() {
					return this.#count;
				}
			}
			const { records, proxy } = createTestProxyRecorder(new Tally());

			assert.strictEqual(proxy.read(), 1);
			assert.ok(records.some((r) => r.trap === 'apply:private'));
		});

		test('default (undefined): method calls retry automatically and emit apply:private', () => {
			const records: Array<Rekording> = [];
			const p = create(new Counter(), {
				callback: (r) => records.push(r),
			});

			(p as Improbability).increment();
			(p as Improbability).increment();

			const internals = records.filter((r) => r.trap === 'apply:private');
			assert.strictEqual(
				internals.length,
				2,
				'both calls retried as apply:private',
			);
		});

		test('default (undefined): getter reads retry automatically and record as get', () => {
			const records: Array<Rekording> = [];
			const p = create(new Counter(), {
				callback: (r) => records.push(r),
			});

			(p as Improbability).increment();
			const result = (p as Improbability).value;

			assert.strictEqual(result, 1, 'getter returns correct value');
			const getRecords = records.filter(
				(r) =>
					r.trap === 'get' &&
					r.origin &&
					'key' in r.origin &&
					r.origin.key === 'value',
			);
			assert.strictEqual(
				getRecords.length,
				1,
				'getter access recorded as get',
			);
		});

		test('bind: false — no retry, throws on #private field access', () => {
			const p = create(new Counter(), {
				bind: false,
				callback: () => {},
			});

			assert.throws(() => (p as Improbability).increment(), TypeError);
		});

		test('default (undefined): setter writing #private field is not retried — TypeError propagates', () => {
			// The private-member retry only handles apply and get; a set trap that
			// triggers a private-field TypeError is intentionally re-thrown.
			class PrivateSetter {
				#value = 0;
				get val(): number {
					return this.#value;
				}
				set val(v: number) {
					this.#value = v;
				}
			}
			const p = create(new PrivateSetter(), { callback: () => {} });

			assert.throws(() => {
				(p as Improbability).val = 42;
			}, TypeError);
		});

		test('bind: true — pre-binds methods, records as apply (no retry)', () => {
			const records: Array<Rekording> = [];
			const p = create(new Counter(), {
				bind: true,
				callback: (r) => records.push(r),
			});

			(p as Improbability).increment();
			(p as Improbability).increment();

			const applies = appliesFor(records, 'increment');
			assert.strictEqual(
				applies.length,
				2,
				'both calls recorded as apply',
			);
			const internals = records.filter((r) => r.trap === 'apply:private');
			assert.strictEqual(
				internals.length,
				0,
				'no apply:private — no retry needed',
			);
		});

		test('bind: true — getters work and record as get', () => {
			const records: Array<Rekording> = [];
			const p = create(new Counter(), {
				bind: true,
				callback: (r) => records.push(r),
			});

			(p as Improbability).increment();
			const result = (p as Improbability).value;

			assert.strictEqual(result, 1, 'getter returns correct value');
		});

		test('apply:private with non-proxiable thisArg (null) passes it directly to retry', () => {
			// When a method is called with this = null, the private brand check fails with a
			// "private member" TypeError. isProxiable(null) is false so the retry uses null
			// directly without a graph lookup.
			class HasPrivate {
				#value = 0;
				increment() {
					return ++this.#value;
				}
			}
			const p = create(new HasPrivate(), { callback: () => {} });
			const fnProxy = (p as Improbability).increment as (
				...args: never
			) => unknown;
			assert.throws(() => Reflect.apply(fnProxy, null, []), TypeError);
		});

		test('apply:private with thisArg from a different graph falls back to the proxy', () => {
			// When thisArg is a proxy from a different create() session, getByProxy()
			// returns undefined for it — the ?? fallback reuses the proxy as the receiver.
			class HasPrivate {
				#value = 0;
				increment() {
					return ++this.#value;
				}
			}
			const foreignProxy = create(
				{ unrelated: true },
				{ callback: () => {} },
			);
			const p = create(new HasPrivate(), { callback: () => {} });
			const fnProxy = (p as Improbability).increment as (
				...args: never
			) => unknown;
			assert.throws(
				() => Reflect.apply(fnProxy, foreignProxy, []),
				TypeError,
			);
		});

		test('internal #field reads inside methods are not recorded regardless of bind', () => {
			each`
				label             | bind
				----------------- | ------------
				default           | ${undefined}
				bind:true  | ${true}
			`(({ bind }: Improbability) => {
				const records: Array<Rekording> = [];
				const p = create(new Counter(), {
					bind,
					callback: (r) => records.push(r),
				});

				(p as Improbability).increment();

				const privateReads = records.filter(
					(r) =>
						r.origin &&
						'key' in r.origin &&
						String(r.origin.key).startsWith('#'),
				);
				assert.strictEqual(
					privateReads.length,
					0,
					'no #field access in recording',
				);
			});
		});
	});

	describe('apply:structure', () => {
		test('apply:structure is emitted when structuredClone rejects a proxied arg and retries with real target', () => {
			// arrange
			// structuredClone throws DataCloneError when given a Proxy — V8 detects it at
			// the C++ level. When the proxied arg is in our graph we can unwrap and retry.
			const records: Array<Rekording> = [];
			const target = {
				getData() {
					return { value: 42 };
				},
				cloneArg(arg: unknown) {
					return structuredClone(arg);
				},
			};
			const p = create(target, {
				callback: (r) => records.push(r),
				recursive: true,
			});

			// act
			// p.getData() returns a proxy (recursive mode); passing it to cloneArg
			// causes structuredClone to throw DataCloneError inside cloneArg.
			const dataProxy = (p as Improbability).getData();
			const result = (p as Improbability).cloneArg(dataProxy);

			// assert
			const expected = { value: 42 };
			assert.ok(
				Object.entries(expected).every(
					([key, value]) => (result as Improbability)[key] === value,
				),
				'cloned value matches original',
			);

			const structureRec = records.find(
				(r) => r.trap === 'apply:structure',
			);
			assert.ok(
				structureRec,
				'apply:structure record emitted for the DataCloneError retry',
			);

			const isUnwrapTag = (
				v: unknown,
			): v is { $unwrap: { $proxy: string } } =>
				typeof v === 'object' &&
				v !== null &&
				!Array.isArray(v) &&
				'$unwrap' in (v as object);

			assert.ok(
				Array.isArray(structureRec?.args[2]) &&
					isUnwrapTag(structureRec.args[2][0]),
				'unwrapped proxy arg serialized as $unwrap in args[2][0]',
			);
		});

		test('apply:structure passes primitive args through unchanged during unwrapping', () => {
			// When the args list contains a mix of proxied objects and primitives (numbers,
			// strings), isProxiable() is false for primitives — they pass through unchanged.
			const records: Array<Rekording> = [];
			const target = {
				getData() {
					return { x: 1 };
				},
				process(proxied: unknown, _label: string, _count: number) {
					return structuredClone([proxied, _label, _count]);
				},
			};
			const p = create(target, {
				callback: (r) => records.push(r),
				recursive: true,
			});

			const dataProxy = (p as Improbability).getData();
			(p as Improbability).process(dataProxy, 'hello', 42);

			const structureRec = records.find(
				(r) => r.trap === 'apply:structure',
			);
			assert.ok(structureRec, 'apply:structure record emitted');
		});

		test('apply:structure re-throws DataCloneError when retry also fails (arg not in graph)', () => {
			// arrange
			// If the DataCloneError arg is not a proxy in our graph, unwrapping is a
			// no-op and the retry will throw again — the error must propagate unchanged.
			const target = {
				clone(arg: unknown) {
					return structuredClone(arg);
				},
			};
			const p = create(target, { callback: () => {} });

			// act / assert
			assert.throws(
				() => (p as Improbability).clone(() => {}),
				(e: unknown) =>
					e instanceof DOMException && e.name === 'DataCloneError',
			);
		});
	});

	describe('binary data', () => {
		// Built-ins that read the bytes behind binary data check its internal
		// slots, which a proxy does not have: through a proxy they threw, or
		// silently read an empty array-like. Binary data is passed on unwrapped.
		const make = () => ({
			buffer: new Uint8Array([1, 2, 3, 4]).buffer,
			bytes: new Uint8Array([1, 2, 3, 4]),
			view: new DataView(new Uint8Array([1, 2, 3, 4]).buffer),
		});
		const hash = (data: Improbability) =>
			createHash('sha1').update(data).digest('hex');

		test('binary data reached through a proxy works in other built-ins as the real thing', () => {
			each`
				message                              | read
				------------------------------------ | ----
				new Uint8Array(buffer)               | ${(o: Improbability) => Array.from(new Uint8Array(o.buffer))}
				buffer.slice()                       | ${(o: Improbability) => Array.from(new Uint8Array(o.buffer.slice(1, 3)))}
				new DataView(buffer)                 | ${(o: Improbability) => new DataView(o.buffer).getUint8(2)}
				new Uint8Array(view.buffer)          | ${(o: Improbability) => Array.from(new Uint8Array(o.view.buffer))}
				TextDecoder on a buffer              | ${(o: Improbability) => new TextDecoder().decode(o.buffer)}
				TextDecoder on a typed array         | ${(o: Improbability) => new TextDecoder().decode(o.bytes)}
				Buffer.from(buffer)                  | ${(o: Improbability) => Array.from(Buffer.from(o.buffer))}
				a hash of a typed array              | ${(o: Improbability) => hash(o.bytes)}
				structuredClone(typed array)         | ${(o: Improbability) => Array.from(structuredClone(o.bytes))}
			`(({ message, read }: Improbability) => {
				// arrange
				const p = create(make(), { callback: () => {} });

				// act / assert
				assert.deepStrictEqual(read(p), read(make()), message);
			});
		});

		test('binary data is passed on unwrapped, and reading it is recorded', () => {
			// arrange
			const { records, proxy } = createTestProxyRecorder(make());

			// act
			const value = proxy.bytes;

			// assert
			assert.ok(!isFlugrekorder(value), 'not a proxy');
			assert.ok(
				records.some(
					(r) =>
						r.trap === 'get' &&
						r.origin &&
						'key' in r.origin &&
						r.origin.key === 'bytes',
				),
				'the read is recorded',
			);
		});
	});

	describe('WebAssembly', () => {
		// The module in fixtures/module.ts imports `host.log`, exports `add` and
		// its memory, and writes its second argument to memory as it adds.
		async function load(callback: (r: Rekording) => void) {
			const instantiate = (globalThis as Improbability).WebAssembly
				.instantiate as Instantiate;
			const host = create({ log: (_value: number) => {} }, { callback });
			const { instance } = await instantiate(bytes, { host });

			return create(instance.exports, { callback });
		}

		test('calls in both directions are recorded: into the module, and from it', async () => {
			// arrange
			const records: Array<Rekording> = [];
			const exports = await load((r) => records.push(r));

			// act
			const sum = exports.add(2, 3);

			// assert
			// `log` returns first: the module calls it while `add` runs
			assert.strictEqual(sum, 5);
			assert.deepStrictEqual(
				records
					.filter((r) => r.trap === 'apply')
					.map((r) => r.args[2] as Array<number>),
				[[2], [2, 3]],
			);
		});

		test('memory works through the proxy, and growing it is recorded', async () => {
			// arrange
			const records: Array<Rekording> = [];
			const exports = await load((r) => records.push(r));

			// act
			exports.add(2, 3);
			const written = new Uint32Array(exports.memory.buffer)[0];
			const pages = exports.memory.grow(1);

			// assert
			assert.strictEqual(written, 3, 'reads what the module wrote');
			assert.strictEqual(pages, 1, 'grows from one page');
			assert.ok(
				records.some(
					(r) =>
						r.trap === 'apply' &&
						(r.args[2] as Array<number>)[0] === 1 &&
						r.result === 1,
				),
				'grow(1) is recorded',
			);
		});
	});

	describe('proxy invariants', () => {
		// The engine checks every trap result against the proxy's own target: a
		// non-configurable property must be reported exactly as it is there, and
		// so must non-extensibility. flugrekorder proxies wrap an empty stand-in
		// instead of the real target, and copy onto it only what the invariants
		// demand — so pinned values can be reported as proxies, and recorded.
		const inner = { v: 1 };
		const getter = () => inner;
		const frozen = () => Object.freeze({ inner });
		const readonly = () =>
			Object.defineProperty({}, 'inner', {
				value: inner,
				enumerable: true,
			});
		// The shape TypeScript and Babel emit for re-exports.
		const reexport = () =>
			Object.defineProperty({}, 'inner', {
				get: getter,
				enumerable: true,
			});

		test('operations on pinned properties do not throw', () => {
			each`
				message                                       | target         | options            | operation
				--------------------------------------------- | -------------- | ------------------ | ---------
				get frozen property                           | ${frozen}      | ${{}}              | ${(p: Improbability) => p.inner}
				get read-only property                        | ${readonly}    | ${{}}              | ${(p: Improbability) => p.inner}
				get frozen method with bind: true             | ${() => Object.freeze({ m() {} })} | ${{ bind: true }} | ${(p: Improbability) => p.m}
				get nested frozen property                    | ${() => ({ cfg: Object.freeze({ a: frozen() }) })} | ${{}} | ${(p: Improbability) => p.cfg.a.inner}
				getOwnPropertyDescriptor of frozen property   | ${frozen}      | ${{}}              | ${(p: Improbability) => Object.getOwnPropertyDescriptor(p, 'inner')}
				getOwnPropertyDescriptor of re-export         | ${reexport}    | ${{}}              | ${(p: Improbability) => Object.getOwnPropertyDescriptor(p, 'inner')}
				spread of frozen object                       | ${frozen}      | ${{}}              | ${(p: Improbability) => ({ ...p })}
				spread of re-exports                          | ${reexport}    | ${{}}              | ${(p: Improbability) => ({ ...p })}
				spread of a class                             | ${() => class {}} | ${{}}           | ${(p: Improbability) => ({ ...p })}
				Object.isFrozen of frozen object              | ${frozen}      | ${{}}              | ${(p: Improbability) => Object.isFrozen(p)}
				Object.freeze through the proxy               | ${() => ({ inner })} | ${{}}        | ${(p: Improbability) => Object.keys(Object.freeze(p))}
				redefine frozen property with its own value   | ${frozen}      | ${{}}              | ${(p: Improbability) => Object.defineProperty(p, 'inner', Object.getOwnPropertyDescriptor(p, 'inner') as PropertyDescriptor)}
				redefine re-export with its own getter        | ${reexport}    | ${{}}              | ${(p: Improbability) => Object.defineProperty(p, 'inner', Object.getOwnPropertyDescriptor(p, 'inner') as PropertyDescriptor)}
				redefine when only describing is recorded     | ${frozen}      | ${{ only: ['getOwnPropertyDescriptor'] }} | ${(p: Improbability) => Object.defineProperty(p, 'inner', Object.getOwnPropertyDescriptor(p, 'inner') as PropertyDescriptor)}
			`(({ message, target, options, operation }: Improbability) => {
				// arrange
				const p = create(target(), { ...options, callback: () => {} });

				// act / assert
				assert.doesNotThrow(() => operation(p), message);
			});
		});

		test('pinned values are proxied', () => {
			each`
				message                                      | target       | operation
				-------------------------------------------- | ------------ | ---------
				get frozen property                          | ${frozen}    | ${(p: Improbability) => p.inner}
				get read-only property                       | ${readonly}  | ${(p: Improbability) => p.inner}
				get through a re-export                      | ${reexport}  | ${(p: Improbability) => p.inner}
				get element of a frozen array                | ${() => Object.freeze([inner])} | ${(p: Improbability) => p[0]}
				getOwnPropertyDescriptor of frozen property  | ${frozen}    | ${(p: Improbability) => Object.getOwnPropertyDescriptor(p, 'inner')?.value}
				getOwnPropertyDescriptor of re-export        | ${reexport}  | ${(p: Improbability) => Object.getOwnPropertyDescriptor(p, 'inner')?.get}
			`(({ message, target, operation }: Improbability) => {
				// arrange
				const p = create(target(), { callback: () => {} });

				// act
				const value = operation(p);

				// assert
				assert.ok(isFlugrekorder(value), message);
			});
		});

		test('every trap reports a pinned value as the same proxy', () => {
			// arrange
			const p = create(frozen(), { callback: () => {} });

			// act
			const described = Object.getOwnPropertyDescriptor(
				p,
				'inner',
			)?.value;

			// assert
			assert.strictEqual(p.inner, described);
		});

		test('calls through a frozen object are recorded', () => {
			// arrange
			// e.g. a dependency that freezes its exports
			const exports = Object.freeze({ hello: () => 'hi' });
			const { records, proxy } = createTestProxyRecorder(exports);

			// act
			proxy.hello();

			// assert
			assert.deepStrictEqual(
				records.map(({ trap }) => trap),
				['get', 'apply'],
			);
		});

		test('reading a pinned property records the proxy it returns', () => {
			// arrange
			const { records, proxy } = createTestProxyRecorder(frozen());

			// act
			proxy.inner;

			// assert
			const read = records.find((r) => r.trap === 'get');
			assert.ok(isProxyTag(read?.result));
		});

		test('the proxy reports the integrity, kind and prototype of its target', () => {
			each`
				message                        | target                                         | operation
				------------------------------ | ---------------------------------------------- | ---------
				frozen object is frozen        | ${frozen}                                      | ${Object.isFrozen}
				sealed object is sealed        | ${() => Object.seal({ inner })}                | ${Object.isSealed}
				non-extensible object          | ${() => Object.preventExtensions({ inner })}   | ${Object.isExtensible}
				extensible object              | ${() => ({ inner })}                           | ${Object.isExtensible}
				own keys of a frozen array     | ${() => Object.freeze([1, inner])}             | ${Reflect.ownKeys}
				arrays are arrays              | ${() => [inner]}                               | ${Array.isArray}
				functions are functions        | ${() => () => {}}                              | ${(v: unknown) => typeof v}
				prototype of frozen instance   | ${() => Object.freeze(new Date(0))}            | ${Object.getPrototypeOf}
			`(({ message, target, operation }: Improbability) => {
				// arrange
				const real = target();
				const p = create(real, { callback: () => {} });

				// act
				const reported = operation(p);

				// assert
				assert.deepStrictEqual(reported, operation(real), message);
			});
		});

		test('the proxy follows its target when it is frozen around the proxy', () => {
			// arrange
			const real: Record<string, unknown> = { inner, n: 1 };
			const p = create(real, { callback: () => {} });

			// act
			Object.freeze(real);

			// assert
			assert.ok(Object.isFrozen(p), 'frozen');
			assert.deepStrictEqual(Object.keys(p), ['inner', 'n'], 'keys');
			assert.ok(isFlugrekorder(p.inner), 'values still proxied');
		});

		test('constructing follows the target', () => {
			each`
				message              | target
				-------------------- | ------
				class                | ${class {}}
				function             | ${function () {}}
			`(({ message, target }: Improbability) => {
				const P = create(target, { callback: () => {} });

				assert.doesNotThrow(() => new P(), message);
			});
		});

		test('constructing a non-constructor throws, as on the target', () => {
			each`
				message              | target
				-------------------- | ------
				arrow function       | ${() => {}}
				method               | ${{ m() {} }.m}
				async function       | ${async () => {}}
			`(({ message, target }: Improbability) => {
				const P = create(target, { callback: () => {} });

				assert.throws(() => new P(), TypeError, message);
			});
		});

		test('known limitation: redefining a pinned property with a value obtained around the proxy is refused', () => {
			// arrange
			// Once the proxy has described `inner` (as a proxy), the engine holds
			// any redefinition to exactly that. On the real target, redefining
			// with the raw value is a no-op that succeeds; through the proxy it
			// is refused, as `Reflect.defineProperty` reports with `false`.
			const real = frozen();
			const p = create(real, { callback: () => {} });

			Object.getOwnPropertyDescriptor(p, 'inner');

			// act
			const defined = Reflect.defineProperty(p, 'inner', {
				value: real.inner,
			});

			// assert
			assert.strictEqual(defined, false);
		});

		test('behaves as a transparent proxy for any integrity level and property shape (property)', () => {
			// Builds the same target twice — once behind a transparent proxy, once
			// behind flugrekorder — runs the same operations on both and compares
			// the outcomes. The reference is a proxy rather than the target itself:
			// engines take shortcuts no handler can reproduce, e.g. V8 reports an
			// empty non-extensible array as frozen, while its length is writable.
			const key = fc.constantFrom('a', 'b', '0', 'length');
			const property = fc.record({
				accessor: fc.boolean(),
				configurable: fc.boolean(),
				enumerable: fc.boolean(),
				writable: fc.boolean(),
				value: fc.oneof(primitive, fc.constantFrom('{}', '() => {}')),
			});
			const blueprint = fc.record({
				array: fc.boolean(),
				properties: fc.dictionary(
					fc.constantFrom('a', 'b', '0'),
					property,
				),
				integrity: fc.constantFrom(
					'none',
					'preventExtensions',
					'seal',
					'freeze',
				),
			});
			const operation = fc.oneof(
				key.map((k) => (o: Improbability) => o[k]),
				key.map((k) => (o: Improbability) => k in o),
				key.map(
					(k) => (o: Improbability) =>
						Object.getOwnPropertyDescriptor(o, k),
				),
				key.map((k) => (o: Improbability) => Reflect.set(o, k, 1)),
				key.map(
					(k) => (o: Improbability) => Reflect.deleteProperty(o, k),
				),
				key.map((k) => (o: Improbability) => {
					const descriptor = Object.getOwnPropertyDescriptor(o, k);

					return (
						descriptor && Reflect.defineProperty(o, k, descriptor)
					);
				}),
				fc.constant((o: Improbability) => Reflect.ownKeys(o)),
				fc.constant((o: Improbability) => ({ ...o })),
				fc.constant((o: Improbability) => Object.isExtensible(o)),
				fc.constant((o: Improbability) => Object.isFrozen(o)),
				fc.constant((o: Improbability) => Object.isSealed(o)),
				fc.constant((o: Improbability) => Object.freeze(o) && 'frozen'),
				fc.constant(
					(o: Improbability) =>
						Object.preventExtensions(o) && 'locked',
				),
			);

			function build({ array, properties, integrity }: Improbability) {
				const target = array ? [] : {};

				for (const [name, spec] of Object.entries<Improbability>(
					properties,
				)) {
					const value =
						spec.value === '{}'
							? {}
							: spec.value === '() => {}'
								? () => {}
								: spec.value;
					const { configurable, enumerable } = spec;

					Object.defineProperty(
						target,
						name,
						spec.accessor
							? { configurable, enumerable, get: () => value }
							: {
									configurable,
									enumerable,
									value,
									writable: spec.writable,
								},
					);
				}

				if (integrity === 'preventExtensions')
					Object.preventExtensions(target);
				if (integrity === 'seal') Object.seal(target);
				if (integrity === 'freeze') Object.freeze(target);

				return target;
			}

			// Proxies are compared as what they stand for, objects by kind.
			function outcome(run: () => unknown): unknown {
				const shape = (v: unknown): unknown =>
					v === null ||
					(typeof v !== 'object' && typeof v !== 'function')
						? v
						: Array.isArray(v)
							? v.map(shape)
							: typeof v === 'function'
								? 'function'
								: Object.getPrototypeOf(v) === Object.prototype
									? Object.fromEntries(
											Object.entries(v).map(([k, x]) => [
												k,
												shape(x),
											]),
										)
									: 'object';

				try {
					return { value: shape(run()) };
				} catch (error) {
					return { error: (error as Error).constructor.name };
				}
			}

			fc.assert(
				fc.property(
					blueprint,
					fc.array(operation, { maxLength: 8 }),
					(spec, operations) => {
						const transparent = new Proxy(build(spec), {});
						const p = create(build(spec), { callback: () => {} });

						for (const op of operations)
							assert.deepStrictEqual(
								outcome(() => op(p)),
								outcome(() => op(transparent)),
							);
					},
				),
			);
		});
	});
});
