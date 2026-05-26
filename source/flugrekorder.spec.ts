import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import fc from 'fast-check';
import {
	createTestProxyRecorder,
	type Improbability,
} from '../test/test-helpers';
import * as flugrekorder from './flugrekorder';
import {
	create,
	getAncestors,
	getOrigin,
	getPath,
	getProxyById,
	getTarget,
	isFlugrekorder,
	type Rekording,
} from './flugrekorder';

const safeKey = fc
	.string({ minLength: 1, maxLength: 20 })
	.filter((k) => !['__proto__', 'constructor', 'prototype'].includes(k));

const primitive = fc.oneof(
	fc.string(),
	fc.integer(),
	fc.double({ noNaN: true }),
	fc.boolean(),
);

describe('source/flugrekorder', () => {
	test('module exports exactly the expected public API', () => {
		// arrange
		const expected: Array<keyof typeof flugrekorder> = [
			'create',
			'isFlugrekorder',
			'isProxiable',
			'format',
			'getAncestors',
			'getOrigin',
			'getPath',
			'getProxyById',
			'getTarget',
		] as const;

		// act
		// assert
		for (const name of expected) {
			assert.strictEqual(
				// biome-ignore lint/performance/noDynamicNamespaceImportAccess: tests aren't part of performance issues
				typeof flugrekorder[name],
				'function',
				`${name} is exported as a function`,
			);
		}

		const unexpected = Object.keys(flugrekorder).filter(
			(k) => !(expected as Array<string>).includes(k),
		);
		assert.strictEqual(
			unexpected.length,
			0,
			`unexpected exports: ${unexpected.join(', ')}`,
		);
	});

	describe('core proxy', () => {
		test('traps with no origin mapping (e.g. has) emit a rekording with null origin', () => {
			// arrange
			// act
			const { records } = createTestProxyRecorder({ x: 1 }, (p) => {
				'x' in p;
			});

			// assert
			const rec = records.find((r) => r.trap === 'has');
			assert.ok(rec, 'has record emitted');
			assert.strictEqual(
				rec?.origin,
				null,
				'origin is null for traps outside the origin mapping',
			);
		});

		test('primitives are returned unchanged through get', () => {
			// arrange
			const proxy = create(
				{ n: 42, s: 'hi', b: true },
				{ callback: () => {} },
			);

			// act
			// assert
			assert.strictEqual(proxy.n, 42, 'number');
			assert.strictEqual(proxy.s, 'hi', 'string');
			assert.strictEqual(proxy.b, true, 'boolean');
		});

		test('primitives are returned unchanged through get (property)', () => {
			// arrange
			// act
			// assert
			fc.assert(
				fc.property(safeKey, primitive, (key, value) => {
					const target: Record<string, unknown> = { [key]: value };
					const proxy = create(target, { callback: () => {} });

					return (proxy as Improbability)[key] === value;
				}),
			);
		});

		test('get trap emits one rekording per property access', () => {
			// arrange
			// act
			const { records, proxy: p } = createTestProxyRecorder(
				{
					a: 1,
					b: 2,
				},
				(p) => {
					p.a;
					p.b;
				},
			);

			// assert
			assert.strictEqual(
				records.filter((r) => r.trap === 'get').length,
				2,
				'two get records',
			);
		});

		test('get trap emits exactly one record per access for any key (property)', () => {
			// arrange
			// act
			// assert
			fc.assert(
				fc.property(safeKey, fc.integer(), (key, value) => {
					const records: Array<Rekording> = [];
					const target: Record<string, unknown> = { [key]: value };
					const p = create(target, {
						callback: (r) => records.push(r),
					});
					(p as Improbability)[key];
					return (
						records.filter(
							(r) =>
								r.trap === 'get' &&
								r.origin !== null &&
								'key' in r.origin &&
								r.origin.key === key,
						).length === 1
					);
				}),
			);
		});

		test('set trap emits a rekording and mutates the underlying value', () => {
			// arrange
			const target: { a: number } = { a: 1 };

			// act
			const { records } = createTestProxyRecorder(target, (p) => {
				p.a = 99;
			});

			// assert
			const rec = records.find(
				(r) =>
					r.trap === 'set' &&
					r.origin !== null &&
					'key' in r.origin &&
					r.origin.key === 'a',
			);
			assert.ok(rec, 'set record emitted');
			assert.strictEqual(target.a, 99, 'underlying value mutated');
		});

		test('set trap propagates any primitive value to the underlying target (property)', () => {
			// arrange
			// act
			// assert
			fc.assert(
				fc.property(safeKey, primitive, (key, value) => {
					const target: Record<string, unknown> = {};
					const p = create(target, { callback: () => {} });
					(p as Improbability)[key] = value;
					return target[key] === value;
				}),
			);
		});

		test('apply trap emits a rekording and returns the correct value', () => {
			// arrange
			const { records, proxy } = createTestProxyRecorder({
				double: (n: number) => n * 2,
			});

			// act
			// assert
			assert.strictEqual(proxy.double(5), 10, 'return value is correct');
			assert.ok(
				records.some((r) => r.trap === 'apply'),
				'apply record emitted',
			);
		});

		test('construct trap emits a rekording and returns an instance', () => {
			// arrange
			class Counter {
				count = 0;
			}
			const { records, proxy } = createTestProxyRecorder(Counter);

			// act
			const instance = new proxy();

			// assert
			assert.ok(
				records.some((r) => r.trap === 'construct'),
				'construct record emitted',
			);
			assert.strictEqual(
				instance.count,
				0,
				'instance has correct initial state',
			);
		});

		test('returned proxiable values are themselves proxied', () => {
			// arrange
			const { records, proxy } = createTestProxyRecorder({
				nested: { x: 1 },
			});
			const nested = proxy.nested;
			const before = records.length;

			// act
			nested.x;

			// assert
			assert.ok(
				records.length > before,
				'accessing a property on a returned nested proxy emits further records',
			);
		});

		test('proxy stability: the same underlying object always returns the same proxy', () => {
			// arrange
			const shared = { v: 1 };
			const { proxy } = createTestProxyRecorder({ a: shared, b: shared });

			// act
			// assert
			assert.strictEqual(
				proxy.a,
				proxy.b,
				'both references return the identical proxy instance',
			);
		});

		test('proxy stability: holds for any object (property)', () => {
			// arrange
			// act
			// assert
			fc.assert(
				fc.property(fc.object({ maxDepth: 1 }), (target) => {
					const p = create(target, { callback: () => {} });
					const q = create(p, { callback: () => {} });
					return p === q;
				}),
			);
		});

		test('a known target passed as a call argument is proxied, so interactions on it are recorded', () => {
			// arrange
			const child = { x: 42 };
			const target = {
				child,
				fn: (obj: typeof child) => obj.x,
			};
			const { records, proxy } = createTestProxyRecorder(target);
			proxy.child; // registers child in the graph
			const before = records.length;

			// act
			proxy.fn(child); // passes raw target — known() should return its proxy

			// assert
			const xAccess = records
				.slice(before)
				.find(
					(r) =>
						r.trap === 'get' &&
						r.origin !== null &&
						'key' in r.origin &&
						r.origin.key === 'x',
				);
			assert.ok(
				xAccess,
				'get trap for x fires when known target is passed as argument',
			);
		});

		test('no recursion when a method mutates this', () => {
			// arrange
			const target = {
				c: 0,
				inc() {
					return ++this.c;
				},
			};
			const { proxy } = createTestProxyRecorder(target);

			// act
			// assert
			assert.strictEqual(proxy.inc(), 1, 'returns 1');
			assert.strictEqual(target.c, 1, 'underlying counter incremented');
		});

		test('a known proxy passed back through a trap is not double-wrapped', () => {
			// arrange
			const target = {
				getSelf(): Improbability {
					return this;
				},
			};
			const { proxy } = createTestProxyRecorder(target);

			// act
			// assert
			assert.strictEqual(
				proxy.getSelf(),
				proxy,
				'getSelf() returns the same proxy instance',
			);
		});

		test('arrays are proxied and elements remain accessible', () => {
			// arrange
			const { proxy } = createTestProxyRecorder({ arr: [10, 20, 30] });
			const arr = proxy.arr;

			// act
			// assert
			assert.strictEqual(arr[0], 10, 'first element');
			assert.strictEqual(arr[2], 30, 'last element');
			assert.strictEqual(arr.length, 3, 'length');
		});

		test('prototype access is not wrapped and does not violate proxy invariants', () => {
			// arrange
			class Foo {
				bar() {
					return 1;
				}
			}
			const { proxy } = createTestProxyRecorder(new Foo());

			// act
			// assert
			assert.doesNotThrow(
				() => proxy.bar(),
				'calling a prototype method does not throw',
			);
		});

		test('instanceof still works after proxying', () => {
			// arrange
			class Foo {}
			const original = new Foo();
			const { proxy } = createTestProxyRecorder(original);

			// act
			// assert
			assert.ok(
				proxy instanceof Foo,
				'instanceof Foo is preserved on the proxy',
			);
		});

		test('create() called with an already-proxied target returns it unchanged', () => {
			// arrange
			const original = { x: 1 };
			const p1 = create(original, { callback: () => {} });
			const p2 = create(p1, { callback: () => {} });

			// act
			// assert
			assert.strictEqual(
				p2,
				p1,
				'returns the existing proxy, not a new wrapper',
			);
		});
	});

	describe('isFlugrekorder', () => {
		test('isFlugrekorder returns true for a proxy created by create()', () => {
			// arrange
			const p = create({ x: 1 }, { callback: () => {} });

			// act
			// assert
			assert.ok(isFlugrekorder(p), 'root proxy is recognised');
		});

		test('isFlugrekorder returns true for a child proxy', () => {
			// arrange
			const p = create({ a: { v: 1 } }, { callback: () => {} });

			// act
			// assert
			assert.ok(isFlugrekorder(p.a), 'child proxy is recognised');
		});

		test('isFlugrekorder returns false for plain objects and primitives', () => {
			// arrange
			// act
			// assert
			assert.strictEqual(isFlugrekorder({}), false, 'plain object');
			assert.strictEqual(isFlugrekorder(42), false, 'number');
			assert.strictEqual(isFlugrekorder(null), false, 'null');
			assert.strictEqual(isFlugrekorder('hi'), false, 'string');
		});

		test('isFlugrekorder returns true for any proxied object (property)', () => {
			// arrange
			// act
			// assert
			fc.assert(
				fc.property(fc.object({ maxDepth: 1 }), (target) => {
					return isFlugrekorder(
						create(target, { callback: () => {} }),
					);
				}),
			);
		});

		test('isFlugrekorder returns false for any primitive (property)', () => {
			// arrange
			// act
			// assert
			fc.assert(
				fc.property(primitive, (value) => !isFlugrekorder(value)),
			);
		});

		// ─── recursive option ─────────────────────────────────────────────────────────

		test('recursive: true (default) proxies nested values', () => {
			// arrange
			const {
				records,
				proxy: { a },
			} = createTestProxyRecorder({
				a: { b: 1 },
			});
			const before = records.length;

			// act
			a.b;

			// assert
			assert.ok(
				records.length > before,
				'nested access emits additional records',
			);
		});

		test('recursive: false does not proxy values returned from traps', () => {
			// arrange
			const p = create(
				{ a: { b: 1 } },
				{ callback: () => {}, recursive: false },
			);

			// act
			// assert
			assert.strictEqual(
				isFlugrekorder(p.a),
				false,
				'returned nested value is not a proxy',
			);
		});

		test('recursive: false still emits records for the root proxy', () => {
			// arrange
			const records: Array<Rekording> = [];
			const p = create(
				{ x: 1 },
				{ callback: (r) => records.push(r), recursive: false },
			);

			// act
			p.x;

			// assert
			assert.ok(
				records.some((r) => r.trap === 'get'),
				'get record still emitted on root',
			);
		});
	});

	describe('options', () => {
		describe('only', () => {
			test('restricts which traps emit records', () => {
				// arrange
				const records: Array<Rekording> = [];
				const target: { a: number } = { a: 1 };
				const p = create(target, {
					callback: (r) => records.push(r),
					only: ['get'],
				});

				// act
				p.a;
				p.a = 99;

				// assert
				assert.ok(
					records.every((r) => r.trap === 'get'),
					'only get records emitted',
				);
				assert.strictEqual(
					records.some((r) => r.trap === 'set'),
					false,
					'no set records emitted',
				);
			});

			test('traps not in the list still execute correctly (pass-through)', () => {
				// arrange
				const target: { a: number } = { a: 1 };
				const p = create(target, { callback: () => {}, only: ['get'] });

				// act
				p.a = 99;

				// assert
				assert.strictEqual(
					target.a,
					99,
					'set passes through and mutates target even when not recorded',
				);
			});

			test('apply and get can be combined', () => {
				// arrange
				const records: Array<Rekording> = [];
				const p = create(
					{ fn: () => 'hi' },
					{
						callback: (r) => records.push(r),
						only: ['get', 'apply'],
					},
				);

				// act
				p.fn();

				// assert
				const traps = new Set(records.map((r) => r.trap));
				assert.ok(traps.has('get'), 'get recorded');
				assert.ok(traps.has('apply'), 'apply recorded');
				assert.strictEqual(traps.size, 2, 'no other traps recorded');
			});
		});

		describe('filter', () => {
			test('returning false suppresses the record', () => {
				// arrange
				const records: Array<Rekording> = [];
				const p = create(
					{ port: 3000 },
					{ callback: (r) => records.push(r), filter: () => false },
				);

				// act
				p.port;

				// assert
				assert.strictEqual(records.length, 0, 'no records emitted');
			});

			test('returning true passes the record through', () => {
				// arrange
				const records: Array<Rekording> = [];
				const p = create(
					{ port: 3000 },
					{ callback: (r) => records.push(r), filter: () => true },
				);

				// act
				p.port;

				// assert
				assert.strictEqual(records.length, 1, 'record emitted');
			});

			test('can select by trap type', () => {
				// arrange
				const records: Array<Rekording> = [];
				const p = create(
					{ port: 3000 },
					{
						callback: (r) => records.push(r),
						filter: (r) => r.trap === 'set',
					},
				);

				// act
				p.port;
				p.port = 9999;

				// assert
				assert.strictEqual(
					records.length,
					1,
					'only set record emitted',
				);
				assert.strictEqual(records[0].trap, 'set');
			});

			test('composes with only — both must pass', () => {
				// arrange
				const records: Array<Rekording> = [];
				const p = create(
					{ port: 3000 },
					{
						callback: (r) => records.push(r),
						only: ['get', 'set'],
						filter: (r) => r.trap === 'set',
					},
				);

				// act
				p.port;
				p.port = 9999;

				// assert
				assert.strictEqual(
					records.length,
					1,
					'only set passes both only and filter',
				);
				assert.strictEqual(records[0].trap, 'set');
			});

			test('omitting filter emits all records', () => {
				// arrange
				// act
				const { records } = createTestProxyRecorder(
					{ port: 3000 },
					(p) => {
						p.port;
						p.port = 9999;
					},
				);

				// assert
				const traps = records.map((r) => r.trap);
				assert.ok(traps.includes('get'), 'get emitted');
				assert.ok(traps.includes('set'), 'set emitted');
			});
		});

		describe('redact', () => {
			test('single redactor function is normalised to an array internally', () => {
				// arrange
				const records: Array<Rekording> = [];
				const target = { fn: (_data: unknown) => null };
				const p = create(target, {
					callback: (r) => records.push(r),
					redact: (key) => (key === 'secret' ? '[redacted]' : false),
				});

				// act
				(p as Improbability).fn({ secret: 'value', name: 'alice' });

				// assert
				const apply = records.find((r) => r.trap === 'apply');
				const payload = (
					apply?.args[2] as Improbability
				)?.[0] as Improbability;
				assert.strictEqual(
					payload?.secret,
					'[redacted]',
					'single redactor applied',
				);
				assert.strictEqual(
					payload?.name,
					'alice',
					'non-redacted key passes through',
				);
			});

			test('array of redactors — all are applied to serialised plain objects', () => {
				// arrange
				const records: Array<Rekording> = [];
				const target = { fn: (_data: unknown) => null };
				const p = create(target, {
					callback: (r) => records.push(r),
					redact: [
						(key) => (key === 'password' ? '[redacted]' : false),
						(key) => (key === 'token' ? '[redacted]' : false),
					],
				});

				// Plain object arg is not a graph node, so it is inlined by serialize()
				// and each key is passed through the redactors.
				// act
				(p as Improbability).fn({
					password: 'secret',
					token: 'hidden',
					name: 'alice',
				});

				// assert
				const apply = records.find((r) => r.trap === 'apply');
				const payload = (
					apply?.args[2] as Improbability
				)?.[0] as Improbability;
				assert.strictEqual(
					payload?.password,
					'[redacted]',
					'first redactor applied',
				);
				assert.strictEqual(
					payload?.token,
					'[redacted]',
					'second redactor applied',
				);
				assert.strictEqual(
					payload?.name,
					'alice',
					'non-redacted key passes through',
				);
			});
		});

		describe('id', () => {
			test('numeric starting value offsets the sequence', () => {
				// arrange
				const records: Array<Rekording> = [];
				const p = create(
					{ x: 1 },
					{ callback: (r) => records.push(r), id: 100 },
				);

				// act
				p.x;

				// assert
				assert.ok(records[0].id.startsWith('#'), 'ID has # prefix');
				const n = parseInt(records[0].id.slice(1), 10);
				assert.ok(n > 100, 'ID is greater than the starting value');
			});

			test('custom generator function is used', () => {
				// arrange
				const records: Array<Rekording> = [];
				let seq = 0;
				const p = create(
					{ x: 1 },
					{
						callback: (r) => records.push(r),
						id: () => `evt-${++seq}`,
					},
				);

				// act
				p.x;

				// assert
				assert.ok(
					records[0].id.startsWith('evt-'),
					'custom ID format used',
				);
			});
		});
	});

	describe('helpers', () => {
		describe('getOrigin', () => {
			test('returns null for the root proxy', () => {
				// arrange
				const p = create({ x: 1 }, { callback: () => {} });

				// act
				// assert
				assert.strictEqual(getOrigin(p), null, 'root origin is null');
			});

			test('returns a structured origin for a property-access proxy', () => {
				// arrange
				const p = create({ a: { v: 1 } }, { callback: () => {} });
				const a = p.a;
				const origin = getOrigin(a);

				// act
				// assert
				assert.ok(origin !== null, 'origin is not null');
				assert.strictEqual(origin?.trap, 'get');
				assert.ok(origin && 'key' in origin, 'origin has a key field');
				assert.strictEqual(
					String((origin as { key: string | symbol }).key),
					'a',
				);
			});

			test('for a function-return proxy has trap=apply and a source ID', () => {
				// arrange
				const p = create(
					{ fn: () => ({ v: 1 }) },
					{ callback: () => {} },
				);
				const result = p.fn();
				const origin = getOrigin(result);

				// act
				// assert
				assert.ok(origin !== null, 'origin is not null');
				assert.strictEqual(origin?.trap, 'apply');
				assert.ok(
					origin && 'source' in origin,
					'origin has a source field',
				);
				assert.strictEqual(
					typeof (origin as { source: string }).source,
					'string',
					'source is a string proxy ID',
				);
			});
		});

		describe('getAncestors', () => {
			test('returns the full chain root-first', () => {
				// arrange
				const p = create(
					{ a: { b: { c: 1 } } },
					{ callback: () => {} },
				);
				const b = p.a.b;
				const ancestors = getAncestors(b);

				// act
				// assert
				assert.strictEqual(
					ancestors.length,
					3,
					'root + a + b = 3 entries',
				);
				assert.strictEqual(
					ancestors[0].origin,
					null,
					'root entry has null origin',
				);
				assert.strictEqual(
					ancestors[1].origin !== null && 'key' in ancestors[1].origin
						? String(
								(
									ancestors[1].origin as {
										key: string | symbol;
									}
								).key,
							)
						: null,
					'a',
				);
				assert.strictEqual(
					ancestors[2].origin !== null && 'key' in ancestors[2].origin
						? String(
								(
									ancestors[2].origin as {
										key: string | symbol;
									}
								).key,
							)
						: null,
					'b',
				);
			});

			test('returns an empty array for a non-proxy', () => {
				// arrange
				// act
				// assert
				assert.deepStrictEqual(
					getAncestors({ x: 1 }),
					[],
					'plain object returns empty array',
				);
			});
		});

		describe('getPath', () => {
			test('returns a dotted property path', () => {
				// arrange
				const p = create(
					{ a: { b: { fn: () => 'x' } } },
					{ callback: () => {} },
				);

				// act
				// assert
				assert.strictEqual(getPath(p.a.b.fn), 'a.b.fn');
			});

			test('annotates a function-return value with ()', () => {
				// arrange
				const p = create(
					{ a: { b: { make: () => ({ v: 1 }) } } },
					{ callback: () => {} },
				);

				// act
				// assert
				assert.strictEqual(getPath(p.a.b.make()), 'a.b.make()');
			});

			test('result for the root proxy is an empty string', () => {
				// arrange
				const p = create({ x: 1 }, { callback: () => {} });

				// act
				// assert
				assert.strictEqual(getPath(p), '');
			});

			test('call on a directly-called root function produces ()', () => {
				// arrange
				const fn = create(() => ({ v: 1 }), { callback: () => {} });
				const result = fn();

				// act
				// assert
				assert.strictEqual(getPath(result), '()');
			});
		});

		describe('getTarget', () => {
			test('returns the original unwrapped object', () => {
				// arrange
				const target = { x: 1 };
				const p = create(target, { callback: () => {} });

				// act
				// assert
				assert.strictEqual(
					getTarget(p),
					target,
					'returns the original target',
				);
			});

			test('returns null for a non-proxy', () => {
				// arrange
				// act
				// assert
				assert.strictEqual(
					getTarget({ x: 1 }),
					null,
					'plain object returns null',
				);
			});
		});

		describe('getProxyById', () => {
			test('retrieves a proxy by its recorded ID', () => {
				// arrange
				// act
				const { records, proxy } = createTestProxyRecorder(
					{
						a: { v: 1 },
					},
					(p) => {
						p.a;
					},
				);

				// assert
				const rec = records.find((r) => r.trap === 'get');
				const id = rec?.result?.$proxy;
				assert.ok(id, 'a $proxy ID was recorded');
				const retrieved = getProxyById(id, proxy);
				assert.ok(
					isFlugrekorder(retrieved),
					'retrieved value is a proxy',
				);
				assert.strictEqual(
					retrieved,
					proxy.a,
					'retrieved proxy is the same instance as p.a',
				);
			});

			test('returns undefined for an unknown ID', () => {
				// arrange
				const p = create({ x: 1 }, { callback: () => {} });

				// act
				// assert
				assert.strictEqual(
					getProxyById('no-such-id', p),
					undefined,
					'unknown ID returns undefined',
				);
			});
		});
	});
});
