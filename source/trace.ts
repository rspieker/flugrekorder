import type * as Inspector from 'node:inspector';
import type * as Path from 'node:path';
import type * as Url from 'node:url';
import type * as Util from 'node:util';
import { parse } from './frames.ts';
import type { SourceLocation, StackFrame } from './types.ts';

// Node built-ins are loaded on first use rather than imported: flugrekorder
// also runs outside Node (browsers), where they are not available.
function builtin<T>(id: string): T | undefined {
	return globalThis.process?.getBuiltinModule?.(id) as T | undefined;
}

/** Structured call sites, where the runtime has them (Node.js ≥ 22.12). */
function callSites(): typeof Util.getCallSites | undefined {
	return builtin<typeof Util>('node:util')?.getCallSites;
}

/** Returns true when the runtime can capture the call stack: as structured call sites, or as an `Error.stack` string. */
export function hasStack(): boolean {
	return (
		typeof callSites() === 'function' ||
		typeof new Error().stack === 'string'
	);
}

/** Returns true when the runtime can locate function definitions (Node.js with `node:inspector`). */
export function hasLocation(): boolean {
	return (
		typeof builtin<typeof Inspector>('node:inspector')?.Session ===
		'function'
	);
}

// Script names as reported, relative to the working directory they were made
// relative to — reset when the working directory changes.
const files = new Map<string, string>();
let directory = '';

/**
 * Converts a script name as Node reports it — a path for CommonJS, a
 * `file://` URL for ES modules and the inspector — to a path in unix
 * notation, relative to `process.cwd()`. Names that are not files
 * (`node:fs`, eval'd code) are returned as reported, and so is everything
 * where there is no working directory: in a browser, a script's URL is
 * relative to nothing but its domain.
 */
function file(name: string): string {
	const path = builtin<typeof Path>('node:path');

	if (!path) return name;

	const cwd = process.cwd();

	if (cwd !== directory) {
		files.clear();
		directory = cwd;
	}

	const known = files.get(name);

	if (known !== undefined) return known;

	const absolute = name.startsWith('file://')
		? (builtin<typeof Url>('node:url') as typeof Url).fileURLToPath(name)
		: name;
	const relative = path.isAbsolute(absolute)
		? path.relative(cwd, absolute).split(path.sep).join('/')
		: name;

	files.set(name, relative);

	return relative;
}

// Node reports at most this many frames; parsed stacks are held to it too.
const frames = 200;

// Frames of flugrekorder itself are dropped; requesting this many extra
// frames leaves room for them when a frame count is given. A trap adds a few,
// so a stack of nested traps may come out shorter than the count.
const margin = 8;

// The directory flugrekorder runs from; frames from it are its own.
let own: string | undefined;

// Frames above the trap: this function and the trap's handler. Parsed stacks
// drop these by position — in a bundle, flugrekorder's frames cannot be told
// from the application's by file. That needs both frames to be there: no call
// between the handler and the capture may be a tail call (JavaScriptCore drops
// the frames of tail calls), and this function must not be inlined into the
// handler — which neither terser nor tsdown's minifier does.
const above = 2;

/**
 * The call stack at the moment of the call, as up to `limit` frames, nearest
 * first — without the frames of flugrekorder itself: the recorder is not
 * part of what it records. Structured call sites are used where the runtime
 * has them; elsewhere, `Error.stack` is parsed. In parsed stacks, frames of
 * flugrekorder further down (a trap that fired inside another) remain.
 */
export function stack(limit: number): Array<StackFrame> {
	const getCallSites = callSites();

	if (!getCallSites) {
		// `Error.stackTraceLimit` caps the frames in V8 and JavaScriptCore; it is
		// raised for this capture when it can be, and restored right after.
		const writable =
			Object.getOwnPropertyDescriptor(Error, 'stackTraceLimit')
				?.writable === true;
		const { stackTraceLimit } = Error;

		if (writable) Error.stackTraceLimit = Math.min(frames, limit + above);

		const trace = new Error().stack ?? '';

		if (writable) Error.stackTraceLimit = stackTraceLimit;

		const parsed = parse(trace)
			.slice(above, above + limit)
			.map((frame) => ({ ...frame, file: file(frame.file) }));

		return parsed;
	}

	const sites = getCallSites(Math.min(frames, limit + margin), {
		sourceMap: process.sourceMapsEnabled,
	});

	own ??= sites[0].scriptName.slice(
		0,
		sites[0].scriptName.lastIndexOf('/') + 1,
	);

	const result: Array<StackFrame> = [];

	for (const site of sites) {
		if (result.length >= limit) break;
		if (site.scriptName.startsWith(own)) continue;

		result.push({
			file: file(site.scriptName),
			line: site.lineNumber,
			column: site.columnNumber,
			function: site.functionName,
		});
	}

	return result;
}

type RemoteObject = { objectId?: string; value?: unknown };
type InternalProperty = { name: string; value?: RemoteObject };
type FunctionLocation = {
	scriptId: string;
	lineNumber: number;
	columnNumber: number;
};

// One in-process inspector session, created on first use.
let session: Inspector.Session | undefined;

// Script URLs by inspector script ID.
const scripts = new Map<string, string>();

// Locations are fixed once a function exists; kept with the script URL, so
// the path is made relative to the working directory when reported.
const locations = new WeakMap<object, SourceLocation | null>();

// The function being located is briefly reachable from the global object,
// under a registered symbol, so the inspector can evaluate it.
const handle = Symbol.for('flugrekorder.location');

/** Posts an inspector command; same-thread sessions answer synchronously. */
function post<T>(method: string, params: object): T | undefined {
	let output: T | undefined;

	(session as Inspector.Session).post(method, params, (error, result) => {
		output = error ? undefined : (result as T);
	});

	return output;
}

function connect(): void {
	if (session) return;

	const inspector = builtin<typeof Inspector>(
		'node:inspector',
	) as typeof Inspector;

	session = new inspector.Session();
	session.connect();
}

/** Internal properties of a remote object: `[[FunctionLocation]]`, `[[TargetFunction]]`, … */
function internals(objectId: string): Array<InternalProperty> {
	return (
		post<{ internalProperties?: Array<InternalProperty> }>(
			'Runtime.getProperties',
			{ objectId, ownProperties: true },
		)?.internalProperties ?? []
	);
}

/** Finds `[[FunctionLocation]]`, following bound functions and proxies to what they call. */
function definition(fn: object): FunctionLocation | undefined {
	(globalThis as Record<symbol, unknown>)[handle] = fn;

	const evaluated = post<{ result: RemoteObject }>('Runtime.evaluate', {
		expression: "globalThis[Symbol.for('flugrekorder.location')]",
		objectGroup: 'flugrekorder',
	});

	delete (globalThis as Record<symbol, unknown>)[handle];

	let objectId = evaluated?.result.objectId;
	let found: FunctionLocation | undefined;

	while (objectId && !found) {
		const properties = internals(objectId);

		found = properties.find(({ name }) => name === '[[FunctionLocation]]')
			?.value?.value as FunctionLocation | undefined;
		objectId = properties.find(
			({ name }) =>
				name === '[[TargetFunction]]' || name === '[[Target]]',
		)?.value?.objectId;
	}

	post('Runtime.releaseObjectGroup', { objectGroup: 'flugrekorder' });

	return found;
}

/**
 * Where `fn` is defined, or `null` for functions without a source location
 * (native functions). Positions are 1-based and as V8 reports them: the
 * `class` keyword for classes, the opening parenthesis of the parameter list
 * for functions.
 */
export function location(fn: object): SourceLocation | null {
	// `null` is a known answer too: native functions have no location.
	const known = locations.has(fn)
		? (locations.get(fn) as SourceLocation | null)
		: locate(fn);

	return known && { ...known, file: file(known.file) };
}

/** Looks up where `fn` is defined, keeping the script URL as its file. */
function locate(fn: object): SourceLocation | null {
	connect();

	const found = definition(fn);

	// For a script not seen before, collect the URL of every script there is.
	// Best-effort coverage lists them all, from data V8 keeps anyway. The
	// debugger would list them too, but enabling it slows the application down
	// and disabling it again disturbs coverage tools such as c8.
	if (found && !scripts.has(found.scriptId))
		for (const { scriptId, url } of post<{
			result: Array<{ scriptId: string; url: string }>;
		}>('Profiler.getBestEffortCoverage', {})?.result ?? [])
			scripts.set(scriptId, url);

	const result = found
		? {
				file: scripts.get(found.scriptId) ?? '',
				line: found.lineNumber + 1,
				column: found.columnNumber + 1,
			}
		: null;

	locations.set(fn, result);

	return result;
}
