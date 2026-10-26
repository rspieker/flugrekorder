import { readFileSync } from 'node:fs';
import {
	type Browser,
	type BrowserType,
	chromium,
	firefox,
	webkit,
} from 'playwright';
import type { Improbability } from './test-helpers.ts';

// Browser specs run flugrekorder's IIFE build in Chromium (V8), Firefox
// (SpiderMonkey) and WebKit (JavaScriptCore), served from https://example.test
// so frames carry the URLs a browser reports. They need `npm run build` and
// `npx playwright install`.
export const origin = 'https://example.test';

export const engines: Array<[string, BrowserType]> = [
	['V8', chromium],
	['SpiderMonkey', firefox],
	['JavaScriptCore', webkit],
];

const iife = () =>
	readFileSync(
		new URL('../dist/flugrekorder.global.js', import.meta.url),
		'utf8',
	);

/**
 * Loads flugrekorder and `fixtures/<fixture>` into a fresh page, runs the
 * fixture's `scenarios[name]()` there and returns what it returns. A fresh
 * page per scenario: registered stack parsers stay registered.
 */
export async function scenario(
	browser: Browser,
	fixture: string,
	name: string,
): Promise<Improbability> {
	const files: Record<string, string> = {
		'/': `<script src="${origin}/flugrekorder.js"></script><script src="${origin}/${fixture}"></script>`,
		'/flugrekorder.js': iife(),
		[`/${fixture}`]: readFileSync(
			new URL(`./fixtures/${fixture}`, import.meta.url),
			'utf8',
		),
	};
	const page = await browser.newPage();

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
