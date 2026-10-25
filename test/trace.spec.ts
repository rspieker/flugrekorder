import assert from 'node:assert/strict';
import { relative, sep } from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { each } from 'template-literal-each';
import { create, getLocation, type Rekording } from '../source/flugrekorder.ts';
import * as located from './fixtures/located.ts';
import type { Improbability } from './test-helpers.ts';

// Paths are recorded in unix notation, relative to the working directory.
function path(url: URL | string): string {
	return relative(process.cwd(), fileURLToPath(url)).split(sep).join('/');
}

const fixture = path(new URL('./fixtures/located.ts', import.meta.url));
const spec = path(import.meta.url);
const source = path(new URL('../source/', import.meta.url));

function record(
	options: Record<string, unknown>,
	act: (p: Improbability) => unknown,
): Array<Rekording> {
	const records: Array<Rekording> = [];
	const p = create(
		{ ...located, bound: located.plain.bind(null), max: Math.max },
		{ ...options, callback: (r) => records.push(r) },
	);

	act(p);

	return records;
}

describe('test/trace', () => {
	describe('location', () => {
		test('apply and construct records carry where the called function is defined', () => {
			// Positions are as V8 reports them: the `class` keyword for classes,
			// the opening parenthesis of the parameter list for functions.
			each`
				message               | act                                          | line | column
				--------------------- | -------------------------------------------- | ---- | ------
				function              | ${(p: Improbability) => p.plain()}           | ${2} | ${22}
				class                 | ${(p: Improbability) => new p.Located()}     | ${3} | ${8}
				arrow function        | ${(p: Improbability) => p.arrow()}           | ${4} | ${22}
				method                | ${(p: Improbability) => p.object.method()}   | ${5} | ${31}
				bound function        | ${(p: Improbability) => p.bound()}           | ${2} | ${22}
			`(({ message, act, line, column }: Improbability) => {
				// act
				const records = record({ location: true }, act);

				// assert
				const call = records.find((r) =>
					/^(apply|construct)$/.test(r.trap),
				);
				assert.deepStrictEqual(
					call?.location,
					{ file: fixture, line, column },
					message,
				);
			});
		});

		test('native functions have no location', () => {
			// act
			const records = record({ location: true }, (p) => p.max(1, 2));

			// assert
			const call = records.find((r) => r.trap === 'apply');
			assert.strictEqual(call?.location, null);
		});

		test('only apply and construct records carry a location', () => {
			// act
			const records = record({ location: true }, (p) => p.plain());

			// assert
			assert.deepStrictEqual(
				records.map((r) => [r.trap, 'location' in r]),
				[
					['get', false],
					['apply', true],
				],
			);
		});

		test('without the location option, records carry no location', () => {
			// act
			const records = record({}, (p) => p.plain());

			// assert
			assert.ok(records.every((r) => !('location' in r)));
		});
	});

	describe('getLocation', () => {
		test('returns where the function behind a proxy is defined', () => {
			each`
				message                  | target                                         | key          | expected
				------------------------ | ---------------------------------------------- | ------------ | --------
				function in a module     | ${() => ({ ...located })}                      | plain        | ${{ file: fixture, line: 2, column: 22 }}
				Node.js built-in         | ${() => process.getBuiltinModule('node:fs')}   | readFileSync | ${{ file: 'node:fs' }}
			`(({ message, target, key, expected }: Improbability) => {
				// arrange
				const p = create(target(), {
					callback: () => {},
				}) as Improbability;

				// act
				const location = getLocation(p[key]);

				// assert
				assert.partialDeepStrictEqual(location, expected, message);
			});
		});

		test('returns null when there is no function definition to find', () => {
			each`
				message                 | value
				----------------------- | -----
				not a proxy             | ${located.plain}
				proxy of an object      | ${create({}, { callback: () => {} })}
				proxy of a native       | ${create(Math.max, { callback: () => {} })}
			`(({ message, value }: Improbability) => {
				assert.strictEqual(getLocation(value), null, message);
			});
		});

		test('paths follow the working directory', () => {
			// arrange
			const p = create({ ...located }, { callback: () => {} });
			const cwd = process.cwd();

			// act
			process.chdir(
				fileURLToPath(new URL('./fixtures/', import.meta.url)),
			);
			const moved = getLocation(p.plain);
			process.chdir(cwd);

			// assert
			assert.strictEqual(moved?.file, 'located.ts');
			assert.strictEqual(getLocation(p.plain)?.file, fixture);
		});
	});

	describe('stack', () => {
		test('records carry the stack that made the trap fire, nearest frame first', () => {
			// act
			const records = record({ stack: true }, (p) =>
				p.call(() => p.plain()),
			);

			// assert
			// `plain` is called in the arrow function above, which `call` calls;
			// it returns first, so its record comes before that of `call`
			const apply = records.find((r) => r.trap === 'apply');
			assert.deepStrictEqual(
				apply?.stack
					?.slice(0, 2)
					.map(({ file, function: fn }) => [file, fn]),
				[
					[spec, ''],
					[fixture, 'call'],
				],
			);
		});

		test('frames of flugrekorder itself are not part of the stack', () => {
			// arrange
			// A getter reached through a trap runs inside flugrekorder; what it
			// does there is recorded with a stack that skips the recorder.
			const records: Array<Rekording> = [];
			let p!: Improbability;
			p = create(
				{
					get inner() {
						return p.plain();
					},
					plain: located.plain,
				},
				{ stack: true, callback: (r) => records.push(r) },
			);

			// act
			p.inner;

			// assert
			const files = records
				.flatMap((r) => r.stack ?? [])
				.map((f) => f.file);
			assert.ok(files.length > 0, 'frames are recorded');
			assert.ok(
				files.every((file) => !file.startsWith(source)),
				'no frame is in flugrekorder source',
			);
		});

		test('a frame count limits the stack', () => {
			// act
			const records = record({ stack: 1 }, (p) =>
				p.call(() => p.plain()),
			);

			// assert
			assert.ok(records.every((r) => r.stack?.length === 1));
		});

		test('without the stack option, records carry no stack', () => {
			each`
				message         | options
				--------------- | -------
				option omitted  | ${{}}
				false           | ${{ stack: false }}
				0               | ${{ stack: 0 }}
			`(({ message, options }: Improbability) => {
				const records = record(options, (p) => p.plain());

				assert.ok(
					records.every((r) => !('stack' in r)),
					message,
				);
			});
		});

		test('takes true or a frame count', () => {
			each`
				message         | stack
				--------------- | -----
				negative        | ${-1}
				fraction        | ${1.5}
				not a number    | ${Number.NaN}
			`(({ message, stack }: Improbability) => {
				assert.throws(
					() => create({}, { stack, callback: () => {} }),
					RangeError,
					message,
				);
			});
		});
	});

	describe('without Node.js built-ins', () => {
		// As in a browser: no `process.getBuiltinModule`, so no inspector and no
		// structured call sites — stacks come from parsing `Error.stack`.
		function browserlike<T>(act: () => T): T {
			const { getBuiltinModule } = process;

			process.getBuiltinModule = (() => undefined) as Improbability;

			try {
				return act();
			} finally {
				process.getBuiltinModule = getBuiltinModule;
			}
		}

		test('location throws on creation', () => {
			assert.throws(
				() =>
					browserlike(() =>
						create({}, { location: true, callback: () => {} }),
					),
				/node:inspector/,
			);
		});

		test('stacks are parsed from Error.stack, at the positions structured call sites report', () => {
			// arrange
			const act = (p: Improbability) => p.call(() => p.plain());
			const positions = (r: Array<Rekording>) =>
				r
					.find((record) => record.trap === 'apply')
					?.stack?.slice(0, 2)
					.map(({ line, column }) => ({ line, column }));

			// act
			const structured = record({ stack: true }, act);
			const parsed = browserlike(() => record({ stack: true }, act));

			// assert
			assert.deepStrictEqual(positions(parsed), positions(structured));
		});

		test('function names are as the engine reports them in Error.stack', () => {
			// V8 prefixes a method call with the type of its receiver — here the
			// proxy `call` was called on — where structured call sites report the
			// function's own name. The string can't tell that prefix from a name
			// with a dot in it, so it is kept.
			const act = (p: Improbability) => p.call(() => p.plain());
			const names = (r: Array<Rekording>) =>
				r
					.find((record) => record.trap === 'apply')
					?.stack?.slice(0, 2)
					.map(({ function: fn }) => fn);

			assert.deepStrictEqual(names(record({ stack: true }, act)), [
				'',
				'call',
			]);
			assert.deepStrictEqual(
				names(browserlike(() => record({ stack: true }, act))),
				['', 'Proxy.call'],
			);
		});

		test('files are reported as the runtime reports them: in a browser, the domain is the working directory', () => {
			// act
			const parsed = browserlike(() =>
				record({ stack: true }, (p) => p.call(() => p.plain())),
			);

			// assert
			const apply = parsed.find((r) => r.trap === 'apply');
			assert.deepStrictEqual(
				apply?.stack?.slice(0, 2).map(({ file }) => file),
				[
					import.meta.url,
					new URL('./fixtures/located.ts', import.meta.url).href,
				],
			);
		});
	});
});
