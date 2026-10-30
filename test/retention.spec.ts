import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { setFlagsFromString } from 'node:v8';
import { runInNewContext } from 'node:vm';
import {
	create,
	getAncestors,
	getPath,
	getProxyById,
} from '../source/flugrekorder.ts';
import type { Improbability } from './test-helpers.ts';

setFlagsFromString('--expose-gc');

const gc = runInNewContext('gc') as () => void;

// Objects behind a WeakRef stay alive until the task that touched them ends,
// and finalization callbacks run in tasks of their own: collect across tasks.
async function collect(): Promise<void> {
	for (let task = 0; task < 10; task++) {
		await new Promise((resolve) => setImmediate(resolve));
		gc();
	}
}

// Each call returns a new object holding a certificate — the shape of a
// parser whose result the application only partly keeps.
function session() {
	const records: Array<Improbability> = [];
	const api = create(
		{
			parse: (serial: number) => ({ certificate: { serial } }),
		},
		{ callback: (r) => records.push(r) },
	) as Improbability;

	return { api, records };
}

describe('test/retention', () => {
	test('the session does not keep objects alive that the application dropped', async () => {
		// arrange
		const { api } = session();
		const dropped = new WeakRef(api.parse(1));

		// act
		await collect();

		// assert
		assert.strictEqual(dropped.deref(), undefined);
	});

	test('an ID resolves for as long as its object is alive', async () => {
		// arrange
		const { api, records } = session();
		const kept = api.parse(1);
		const keptId = records.at(-1).result.$proxy;

		api.parse(2);

		const droppedId = records.at(-1).result.$proxy;

		// act
		await collect();

		// assert
		assert.strictEqual(getProxyById(keptId, api), kept, 'still in use');
		assert.strictEqual(
			getProxyById(droppedId, api),
			undefined,
			'collected',
		);
	});

	test('a path survives ancestors that have been collected', async () => {
		// arrange
		// only the certificate is kept: the result of parse() it came from is not
		const { api } = session();
		const certificate = api.parse(1).certificate;

		// act
		await collect();

		// assert
		assert.strictEqual(getPath(certificate), 'parse().certificate');
		assert.deepStrictEqual(
			getAncestors(certificate).map(({ proxy }) => proxy !== undefined),
			[true, true, false, true],
			'root, parse, the collected result, the certificate',
		);
	});

	test('without WeakRef, the session keeps what it touched, as before', async () => {
		// arrange
		const { WeakRef: weakRef } = globalThis;
		let api: Improbability;
		let id: string;

		Reflect.deleteProperty(globalThis, 'WeakRef');

		try {
			const records: Array<Improbability> = [];

			api = create(
				{ parse: (serial: number) => ({ serial }) },
				{ callback: (r) => records.push(r) },
			);
			api.parse(1);
			id = records.at(-1).result.$proxy;
		} finally {
			globalThis.WeakRef = weakRef;
		}

		// act
		await collect();

		// assert
		assert.ok(getProxyById(id, api));
	});
});
