import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import type { Browser } from 'playwright';
import { engines, scenario } from './browser.ts';

// Built-ins reached through a proxy behave as the real thing in every engine.
// flugrekorder used to recognise their brand checks by V8's error messages
// only, so in Firefox and Safari these threw.
for (const [engine, type] of engines) {
	describe(`test/builtins.browser — ${engine} (${type.name()})`, () => {
		let browser: Browser;

		before(async () => {
			browser = await type.launch();
		});
		after(() => browser.close());

		test('built-ins, #private members and host objects behave through a proxy as they do directly', async () => {
			// act
			const outcomes: Array<[string, string, string]> = await scenario(
				browser,
				'builtins.js',
				'builtins',
			);

			// assert
			for (const [name, real, proxied] of outcomes)
				assert.strictEqual(proxied, real, name);
		});
	});
}
