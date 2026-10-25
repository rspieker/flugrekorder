import type { StackFrame } from './types.ts';

/**
 * Reads one line of an `Error.stack` string as a stack frame. Returns
 * `undefined` for lines it does not understand, which then go to the next
 * parser; lines no parser understands are not frames (the error message,
 * native code without a position).
 */
export type StackParser = (line: string) => StackFrame | undefined;

// Top-level and anonymous code has no function name: `''`, as Node.js reports
// it in structured call sites.
const unnamed = /^(?:<anonymous>|global code|module code|eval code)$/;

/**
 * V8 (Chrome, Edge, Node.js): `    at name (location)` or `    at location`,
 * the location being `url:line:column` — or, for eval'd code,
 * `eval at name (url:line:column), <anonymous>:line:column`, and
 * `<anonymous>` for scripts without a URL. Frames across an `await` start
 * with `async `, constructor calls with `new `; neither is part of the name.
 * Names are otherwise as reported — `Greeter.greet` may be a method or a
 * function named so; the string doesn't tell.
 */
function v8(line: string): StackFrame | undefined {
	const match = line.match(
		/^\s*at (?:async )?(?:(.*?) \()?(.*):(\d+):(\d+)\)?$/,
	);

	if (!match) return undefined;

	const [, name = '', location, row, column] = match;
	const local = name.replace(/^new /, '').replace(/ \[as [^\]]+\]$/, '');

	return {
		file:
			location.startsWith('eval at ') || location === '<anonymous>'
				? ''
				: location,
		line: Number(row),
		column: Number(column),
		function: unnamed.test(local) ? '' : local,
	};
}

/**
 * SpiderMonkey (Firefox) and JavaScriptCore (Safari) share one format:
 * `name@url:line:column`, the name empty for anonymous code. SpiderMonkey
 * marks frames across an `await` with `async*`, and reports eval'd code as
 * `url line 4 > eval:line:column`; JavaScriptCore names top-level code
 * `global code` or `module code`.
 */
function spidermonkey(line: string): StackFrame | undefined {
	const match = line.match(/^(.*?)@(.*):(\d+):(\d+)$/);

	if (!match) return undefined;

	const [, name, location, row, column] = match;
	const local = name.replace(/^async\*/, '');

	return {
		file: / line \d+ > (?:eval|Function)$/.test(location) ? '' : location,
		line: Number(row),
		column: Number(column),
		function: unnamed.test(local) ? '' : local,
	};
}

// Parsers registered by users, most recent first, ahead of the built-in ones.
const registered: Array<StackParser> = [];
const builtin: Array<StackParser> = [v8, spidermonkey];

/**
 * Adds a stack parser, ahead of all others — for engines with their own
 * stack format, or to read a known one differently. Parsers are used where
 * the runtime reports call stacks as `Error.stack` strings only (browsers);
 * Node.js reports structured call sites, which need no parsing.
 */
export function register(parser: StackParser): void {
	if (!registered.includes(parser)) registered.unshift(parser);
}

/** Reads an `Error.stack` string as frames, nearest first. */
export function parse(stack: string): Array<StackFrame> {
	const parsers = [...registered, ...builtin];
	const frames: Array<StackFrame> = [];

	for (const line of stack.split('\n')) {
		for (const parser of parsers) {
			const frame = parser(line);

			if (frame) {
				frames.push(frame);
				break;
			}
		}
	}

	return frames;
}

// Exported for testing only.
export { spidermonkey, v8 };
