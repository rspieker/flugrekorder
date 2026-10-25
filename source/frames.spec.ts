import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { each } from 'template-literal-each';
import type { Improbability } from '../test/test-helpers.ts';
import { parse, register, spidermonkey, v8 } from './frames.ts';

// Lines as Chromium 156, Firefox 157 and WebKit 27.2 report them, captured
// with Playwright from a script served as https://example.test/app.js.
const app = 'https://example.test/app.js';

describe('source/frames', () => {
	describe('v8', () => {
		test('reads frames as V8 reports them', () => {
			each`
				message                        | line                                                                              | file   | row   | column | name
				------------------------------ | --------------------------------------------------------------------------------- | ------ | ----- | ------ | ----
				named function                 | ${`    at named (${app}:2:27)`}                                                   | ${app} | ${2}  | ${27}  | named
				method, with its receiver type | ${`    at Greeter.greet (${app}:3:34)`}                                           | ${app} | ${3}  | ${34}  | Greeter.greet
				constructor                    | ${`    at new Built (${app}:4:44)`}                                               | ${app} | ${4}  | ${44}  | Built
				anonymous function             | ${`    at ${app}:12:27`}                                                          | ${app} | ${12} | ${27}  | ${''}
				across an await                | ${`    at async window.samples (${app}:13:9)`}                                    | ${app} | ${13} | ${9}   | window.samples
				eval'd code                    | ${`    at eval (eval at window.samples (${app}:14:8), <anonymous>:1:8)`}          | ${''}  | ${1}  | ${8}   | eval
				script without a URL           | ${'    at UtilityScript.evaluate (<anonymous>:372:16)'}                            | ${''}  | ${372}| ${16}  | UtilityScript.evaluate
				anonymous, across an await     | ${'    at async <anonymous>:396:30'}                                              | ${''}  | ${396}| ${30}  | ${''}
			`(({ message, line, file, row, column, name }: Improbability) => {
				assert.deepStrictEqual(
					v8(line),
					{ file, line: row, column, function: name },
					message,
				);
			});
		});

		test('reads nothing from lines that are not V8 frames', () => {
			each`
				message                    | line
				-------------------------- | ----
				the error message          | Error
				native code, no position   | ${'    at Array.map (<anonymous>)'}
				a SpiderMonkey frame       | ${`named@${app}:2:27`}
			`(({ message, line }: Improbability) => {
				assert.strictEqual(v8(line), undefined, message);
			});
		});
	});

	describe('spidermonkey', () => {
		test('reads frames as SpiderMonkey and JavaScriptCore report them', () => {
			each`
				message                           | line                                                  | file   | row   | column | name
				--------------------------------- | ----------------------------------------------------- | ------ | ----- | ------ | ----
				named function                    | ${`named@${app}:2:27`}                                | ${app} | ${2}  | ${27}  | named
				method                            | ${`greet@${app}:3:34`}                                | ${app} | ${3}  | ${34}  | greet
				Firefox: anonymous, named for you | ${`window.samples/<.anonymous<@${app}:12:27`}          | ${app} | ${12} | ${27}  | window.samples/<.anonymous<
				Firefox: across an await          | ${`async*window.samples@${app}:13:15`}                 | ${app} | ${13} | ${15}  | window.samples
				Firefox: eval'd code              | ${`@${app} line 14 > eval:1:8`}                        | ${''}  | ${1}  | ${8}   | ${''}
				Firefox: new Function             | ${`anonymous@${app} line 15 > Function:3:8`}           | ${''}  | ${3}  | ${8}   | anonymous
				Safari: anonymous function        | ${`@${app}:12:36`}                                    | ${app} | ${12} | ${36}  | ${''}
				Safari: top-level code            | ${`global code@${app}:18:28`}                         | ${app} | ${18} | ${28}  | ${''}
				a scoped package path             | ${'greet@https://cdn.test/npm/@scope/pkg/index.js:1:2'} | ${'https://cdn.test/npm/@scope/pkg/index.js'} | ${1} | ${2} | greet
			`(({ message, line, file, row, column, name }: Improbability) => {
				assert.deepStrictEqual(
					spidermonkey(line),
					{ file, line: row, column, function: name },
					message,
				);
			});
		});

		test('reads nothing from lines without a position', () => {
			// Safari reports eval'd code and native code without a position.
			each`
				message                | line
				---------------------- | ----
				Safari: native code    | ${'map@[native code]'}
				Safari: eval'd code    | ${'eval code@'}
				Safari: no location    | ${'@'}
				Safari: named, nowhere | ${'evaluate@'}
			`(({ message, line }: Improbability) => {
				assert.strictEqual(spidermonkey(line), undefined, message);
			});
		});
	});

	describe('parse', () => {
		test('reads every frame of a stack, skipping what is not a frame', () => {
			// act
			const frames = parse(
				[
					'Error',
					`    at named (${app}:2:27)`,
					'    at Array.map (<anonymous>)',
					`    at ${app}:12:27`,
				].join('\n'),
			);

			// assert
			assert.deepStrictEqual(
				frames.map(({ line }) => line),
				[2, 12],
			);
		});

		test('a registered parser reads lines before the built-in ones', () => {
			// arrange
			// e.g. an engine with a format of its own: `name (url line:column)`
			register((line) => {
				const match = line.match(/^(\S+) \((.+) (\d+):(\d+)\)$/);

				return match
					? {
							file: match[2],
							line: Number(match[3]),
							column: Number(match[4]),
							function: match[1],
						}
					: undefined;
			});

			// act
			const frames = parse(
				[`greet (${app} 3:34)`, `named@${app}:2:27`].join('\n'),
			);

			// assert
			assert.deepStrictEqual(
				frames.map(({ function: name }) => name),
				['greet', 'named'],
			);
		});

		test('registering the same parser again keeps it once', () => {
			// arrange
			let calls = 0;
			const counting = () => {
				calls++;

				return undefined;
			};

			// act
			register(counting);
			register(counting);
			parse('one line');

			// assert
			assert.strictEqual(calls, 1);
		});
	});
});
