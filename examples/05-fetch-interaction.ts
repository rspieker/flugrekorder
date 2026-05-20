/**
 * Fetch interaction recorder
 *
 * Problem: you want to know exactly which URLs your code fetches — without a
 * mock server, without patching globals, without setup.
 *
 * Wrap the fetch function itself with flugrekorder. Every call is recorded.
 * recursive: false keeps recording at the call level and leaves the Response
 * unproxied, so ok, status, text() and all body methods work exactly as normal.
 *
 * The URL explains where the name "flugrekorder" comes from.
 */
import { create } from 'flugrekorder';

// ── Code under test ───────────────────────────────────────────────────────────

async function loadPage(
	fetchFn: typeof fetch,
	url: string,
): Promise<string> {
	const response = await fetchFn(url);

	if (!response.ok) {
		throw new Error(`HTTP ${response.status}`);
	}

	return response.text();
}

// ── Record ────────────────────────────────────────────────────────────────────

const calls: string[] = [];

const recordedFetch = create(fetch, {
	only: ['apply'],
	recursive: false,
	callback(r) {
		if (r.trap !== 'apply') return;
		const args = (r.args[2] as unknown[])
			.filter((a) => typeof a !== 'function')
			.map((a) => JSON.stringify(a))
			.join(', ');
		calls.push(`fetch(${args})`);
	},
});

(async () => {
	const html = await loadPage(
		recordedFetch,
		'https://en.wikipedia.org/wiki/Reise,_Reise',
	);

	console.log('Calls recorded:');
	calls.forEach((entry) => console.log(' ', entry));
	// fetch("https://en.wikipedia.org/wiki/Reise,_Reise")

	console.log(`\nPage loaded: ${html.length} characters`);
})();
