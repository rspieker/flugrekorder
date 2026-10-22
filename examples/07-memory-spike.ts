/**
 * Memory spike hunter
 *
 * Problem: a process downloads a large document and memory jumps from its
 * baseline to the limit, then crashes. You need to know which call in the flow
 * caused the jump — and the call that causes it never returns.
 *
 * flugrekorder knows nothing about memory, but the callback runs synchronously
 * after every trap, so it can sample memory itself. Two kinds of record:
 *
 *   - exit: an `apply` proxy per method, sampling peak RSS after each call
 *   - enter: a `get` proxy on the module, firing when the method is looked up,
 *     just before it is called — so the fatal call still leaves a trace
 *
 * Run it twice:
 *
 *   node examples/07-memory-spike.ts
 *   node --max-old-space-size=200 examples/07-memory-spike.ts
 *
 * The second run crashes; `memory.ndjson` ends with the call that never returned.
 */
import { openSync, writeSync } from 'node:fs';
import { create } from 'flugrekorder';

// stand-in for the application

type Doc = { items: Array<{ id: number; name: string; note: string }> };

const client = {
	// a ~70MB JSON document as a Buffer
	async download(): Promise<Buffer> {
		const items = Array.from({ length: 350_000 }, (_, id) => ({
			id,
			name: `item-${id}`,
			note: 'x'.repeat(140),
		}));

		return Buffer.from(JSON.stringify({ items }));
	},
};

const processor = {
	decode: (buffer: Buffer): string => buffer.toString('utf8'),
	parse: (text: string): Doc => JSON.parse(text),
	// the culprit: an innocent-looking deep copy
	normalise: (doc: Doc): Doc => JSON.parse(JSON.stringify(doc)),
	count: (doc: Doc): number => doc.items.length,
};

// recorder

// Synchronous writes: a Writable stream buffers in memory (adding to the spike)
// and whatever is still buffered is lost when the process dies.
const log = openSync('memory.ndjson', 'w');
const write = (line: object) => writeSync(log, `${JSON.stringify(line)}\n`);
const mb = (bytes: number) => Math.round(bytes / 1048576);

// maxRSS is a high-water mark (in KB): unlike heapUsed, garbage collected
// between the spike and the sample cannot hide it.
let peak = process.resourceUsage().maxRSS;
// one id sequence shared by every graph, so the log reads in order
let seq = 0;
const id = () => `#${++seq}`;

// Replace every method with its own non-recursive proxy. The payload passing
// through is never proxied — proxying a 70MB document would record every
// element read, and the graph would keep every one of them alive.
function exits<T extends Record<string, unknown>>(module: T, name: string): T {
	for (const [key, fn] of Object.entries(module)) {
		if (typeof fn !== 'function') continue;

		(module as Record<string, unknown>)[key] = create(fn, {
			id,
			only: ['apply'],
			recursive: false,
			// don't serialise `this` (the enter proxy below) or the payload
			depth: 0,
			callback(r) {
				const { heapUsed, external, rss } = process.memoryUsage();
				const { maxRSS } = process.resourceUsage();

				write({
					id: r.id,
					exit: `${name}.${key}`,
					heap: mb(heapUsed),
					external: mb(external),
					rss: mb(rss),
					peak: Math.round(maxRSS / 1024),
					growth: Math.round((maxRSS - peak) / 1024),
				});
				peak = maxRSS;
			},
		});
	}

	return module;
}

// The `get` for `module.method` fires before the call — the enter marker.
function enters<T extends object>(module: T, name: string): T {
	return create(module, {
		id,
		only: ['get'],
		recursive: false,
		callback(r) {
			const key = r.origin && 'key' in r.origin ? r.origin.key : '?';

			write({ id: r.id, enter: `${name}.${key}`, rss: mb(process.memoryUsage().rss) });
		},
	});
}

const c = enters(exits(client, 'client'), 'client');
const p = enters(exits(processor, 'processor'), 'processor');

// the flow under investigation

const buffer = await c.download();
const text = p.decode(buffer);
const doc = p.parse(text);
const copy = p.normalise(doc);

console.log(`${p.count(copy)} items`);

// memory.ndjson (values vary per machine):
//   {"id":"#8","enter":"client.download","rss":65}
//   {"id":"#9","exit":"client.download","heap":222,"external":69,"rss":433,"peak":433,"growth":368}
//   {"id":"#10","enter":"processor.decode","rss":433}
//   {"id":"#11","exit":"processor.decode","heap":217,"external":69,"rss":438,"peak":438,"growth":5}
//   {"id":"#12","enter":"processor.parse","rss":438}
//   {"id":"#13","exit":"processor.parse","heap":300,"external":69,"rss":523,"peak":523,"growth":85}
//   {"id":"#14","enter":"processor.normalise","rss":523}
//   {"id":"#15","exit":"processor.normalise","heap":234,"external":69,"rss":672,"peak":736,"growth":213}
//   {"id":"#16","enter":"processor.count","rss":672}
//   {"id":"#17","exit":"processor.count","heap":234,"external":69,"rss":672,"peak":736,"growth":0}
//
// `normalise` raised the peak by 213MB, yet heapUsed went *down* by 66MB: the
// copy was made, stringified and partly collected before the sample was taken.
// Look at `growth`, not at heap deltas. (`download` grows too — that is the
// stand-in generating the document, the baseline you'd have in the real app.)
//
// With --max-old-space-size=200 the log ends:
//   {"id":"#13","exit":"processor.parse",...}
//   {"id":"#14","enter":"processor.normalise","rss":378}
//
// An enter without an exit: the call that crashed the process.
//
// Next step: the record names the call, not the line. Wrap the internals of the
// call it points at and run again — or take a heap snapshot at the limit
// (node --heapsnapshot-near-heap-limit=1) to see what filled the memory.
