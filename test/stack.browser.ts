import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { after, before, describe, test } from 'node:test';
import {
	type Browser,
	type BrowserType,
	chromium,
	firefox,
	type Page,
	webkit,
} from 'playwright';
import type { Improbability } from './test-helpers.ts';

// Runs flugrekorder's IIFE build in Chromium (V8), Firefox (SpiderMonkey) and
// WebKit (JavaScriptCore), served from https://example.test so frames carry
// the URLs a browser reports. Needs `npm run build` and `npx playwright install`.
const origin = 'https://example.test';
const app = `${origin}/browser.js`;
const files: Record<string, string> = {
	'/': `<script src="${origin}/flugrekorder.js"></script><script src="${app}"></script>`,
	'/flugrekorder.js': readFileSync(
		new URL('../dist/flugrekorder.global.js', import.meta.url),
		'utf8',
	),
	'/browser.js': readFileSync(
		new URL('./fixtures/browser.js', import.meta.url),
		'utf8',
	),
};

const engines: Array<[string, BrowserType]> = [
	['V8', chromium],
	['SpiderMonkey', firefox],
	['JavaScriptCore', webkit],
];

for (const [engine, type] of engines) {
	describe(`test/stack.browser — ${engine} (${type.name()})`, () => {
		let browser: Browser;

		before(async () => {
			browser = await type.launch();
		});
		after(() => browser.close());

		// A fresh page per scenario: registered parsers stay registered.
		async function scenario(name: string): Promise<Improbability> {
			const page: Page = await browser.newPage();

			await page.route(`${origin}/**`, (route) => {
				const path = new URL(route.request().url()).pathname;

				return route.fulfill({
					contentType: path === '/' ? 'text/html' : 'text/javascript',
					body: files[path],
				});
			});
			await page.goto(`${origin}/`);

			const result = await page.evaluate(
				(key) => (globalThis as Improbability).scenarios[key](),
				name,
			);

			await page.close();

			return result;
		}

		test('records the stack that made the trap fire, nearest frame first', async () => {
			// act
			const stack = await scenario('stack');

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
			const stack = await scenario('stack');

			// assert
			assert.ok(
				stack.every(
					({ file }: Improbability) =>
						file !== `${origin}/flugrekorder.js`,
				),
			);
		});

		test('calls through a frozen object are recorded', async () => {
			assert.deepStrictEqual(await scenario('frozen'), [
				'hi',
				['get', 'apply'],
			]);
		});

		test('location throws on creation: only the debugger knows where a function is defined', async () => {
			assert.match(await scenario('location'), /node:inspector/);
		});

		test('a registered stack parser reads frames before the built-in ones', async () => {
			// act
			const stack = await scenario('registered');

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
