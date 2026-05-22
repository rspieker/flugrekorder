/**
 * HTTP interaction recorder
 *
 * Problem: you want to know exactly which requests your code makes and what
 * sequence of calls it performs on the resulting objects — without a mock
 * server, without patching globals, without setup.
 *
 * Wrap the https module with flugrekorder. Every method call on the request
 * object appears in the recording in order. Pass the wrapped module wherever
 * your code expects https and the real network request runs untouched.
 *
 * The URL is a nod to where the name "flugrekorder" comes from.
 */
import * as https from 'node:https';
import { create, getPath, getProxyById } from 'flugrekorder';

// ── Code under test ───────────────────────────────────────────────────────────

function loadPage(
	http: typeof https,
	url: string,
	callback: (status: number, size: number) => void,
): void {
	const req = http.request(url);

	req.on('response', (res) => {
		let size = 0;
		res.on('data', (chunk: Buffer) => { size += chunk.length; });
		res.on('end', () => callback(res.statusCode ?? 0, size));
	});

	req.end();
}

// ── Record ────────────────────────────────────────────────────────────────────

let client!: typeof https;
const calls: string[] = [];

client = create(https, {
	only: ['get', 'apply'],
	callback(r) {
		if (r.trap !== 'apply' || !r.origin || !('source' in r.origin)) return;
		const fn = getProxyById(r.origin.source, client);
		if (!fn) return;
		const name = getPath(fn);
		const method = name.split('.').pop() ?? '';

		// skip Node.js internals — flugrekorder records everything, but this
		// example only shows the calls the application code explicitly makes
		if (method.startsWith('_') || method === 'emit' || method === 'uncork') return;
		if (name.split('.').length > 2) return;

		const args = (r.args[2] as unknown[])
			.filter((a) => typeof a !== 'function')
			.map((a) => JSON.stringify(a))
			.join(', ');
		calls.push(`${name}(${args})`);
	},
});

loadPage(client, 'https://www.rammstein.de/en/history/reisereisealbum/', (status, size) => {
	console.log('Calls recorded:');
	calls.forEach((entry) => console.log(' ', entry));
	// request("https://www.rammstein.de/en/history/reisereisealbum/")
	// request().on("response", {})
	// request().end()

	console.log(`\nHTTP ${status} — ${size} bytes`);
});
