import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import type { Browser } from 'playwright';
import { engines, origin, scenario } from './browser.ts';
import type { Improbability } from './test-helpers.ts';

const app = `${origin}/browser.js`;

for (const [engine, type] of engines) {
	describe(`test/stack.browser — ${engine} (${type.name()})`, () => {
		let browser: Browser;

		before(async () => {
			browser = await type.launch();
		});
		after(() => browser.close());

		const run = (name: string) => scenario(browser, 'browser.js', name);

		test('records the stack that made the trap fire, nearest frame first', async () => {
			// act
			const stack = await run('stack');

			// assert
			// columns are left out: each engine points at a different part of the call
			assert.deepStrictEqual(
				stack
					.slice(0, 2)
					.map(({ file, line, function: fn }: Improbability) => ({
						file,
						line,
						fn,
					})),
				[
					{ file: app, line: 6, fn: 'callGreet' },
					{ file: app, line: 8, fn: 'applied' },
				],
			);
		});

		test('frames of flugrekorder itself are not part of the stack', async () => {
			// act
			const stack = await run('stack');

			// assert
			assert.ok(
				stack.every(
					({ file }: Improbability) =>
						file !== `${origin}/flugrekorder.js`,
				),
			);
		});

		test('calls through a frozen object are recorded', async () => {
			assert.deepStrictEqual(await run('frozen'), [
				'hi',
				['get', 'apply'],
			]);
		});

		test('location throws on creation: only the debugger knows where a function is defined', async () => {
			assert.match(await run('location'), /node:inspector/);
		});

		test('a registered stack parser reads frames before the built-in ones', async () => {
			// act
			const stack = await run('registered');

			// assert
			assert.deepStrictEqual(
				stack
					.slice(0, 2)
					.map(({ line, function: fn }: Improbability) => [line, fn]),
				[
					[6, 'registered'],
					[8, 'registered'],
				],
			);
		});
	});
}
