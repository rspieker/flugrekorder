/**
 * API surface audit
 *
 * Problem: you're about to upgrade a third-party library to a new major
 * version. The changelog lists breaking changes, but you don't know which
 * ones actually affect your code because you're not sure what the library
 * reads from the options object you pass it.
 *
 * Wrap your options object, pass it to the library, then compare what was
 * read against what you provide. Anything never touched is safe to remove;
 * anything touched but removed in the new version needs attention.
 */
import { create } from 'flugrekorder';

// options object

const options = {
	baseUrl:    'https://api.example.com',
	timeout:    5000,
	retries:    3,
	auth:       { token: 's3cr3t', scheme: 'Bearer' },
	debug:      false,
	legacyMode: true,
};

// wrap before passing to the library

const accessed = new Set<string>();

const tracked = create(options, {
	only: ['get'],
	callback(r) {
		// 'key' exists on property-trap origins (get/set/…) but not call-trap origins (apply/construct)
		if (r.origin && 'key' in r.origin) accessed.add(r.origin.key as string);
	},
});

// black-box library call

function initClient(opts: typeof options) {
	const endpoint = opts.baseUrl;
	const attempts = opts.retries;
	const controller = new AbortController();
	setTimeout(() => controller.abort(), opts.timeout);
	return { endpoint, attempts };
}

initClient(tracked);

// report

const all    = Object.keys(options);
const used   = all.filter(k =>  accessed.has(k));
const unused = all.filter(k => !accessed.has(k));

console.log('Read by the library:',  used);
// ['baseUrl', 'retries', 'timeout']

console.log('Never touched:',        unused);
// ['auth', 'debug', 'legacyMode']
// → safe to drop from the options object, or irrelevant in the new version
