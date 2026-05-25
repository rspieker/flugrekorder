/**
 * Mutation detective
 *
 * Problem: a config or state object is being mutated somewhere in a large
 * codebase and you can't find where. Adding console.log to every setter
 * is tedious and error-prone.
 *
 * Wrap the object with flugrekorder. Every `set` trap fires a record that
 * includes the full property path and the new value — no matter how deeply
 * nested or how many call frames away the mutation happens.
 */
import { create, getPath, getProxyById } from "flugrekorder";

// ── Shared state ──────────────────────────────────────────────────────────────

const config = {
	db: { host: "localhost", port: 5432 },
	cache: { ttl: 300, maxSize: 1000 },
};

// ── Wrap before passing anywhere ──────────────────────────────────────────────

let tracked!: typeof config;
const mutations: Array<string> = [];

tracked = create(config, {
	callback(r) {
		if (r.trap !== "set" || !r.origin || !("parent" in r.origin)) return;
		const parent = getProxyById(r.origin.parent, tracked);
		const prefix = parent ? getPath(parent) : "";
		const path = prefix
			? `${prefix}.${r.origin.key}`
			: String(r.origin.key);
		mutations.push(`${path} = ${JSON.stringify(r.args[2])}`);
	},
});

// ── Somewhere deep in the application ────────────────────────────────────────

function connectToDatabase(cfg: typeof config) {
	// Bug: mutates instead of copying — but where exactly?
	(cfg as any).db.port = 5433;
}

function initCache(cfg: typeof config) {
	// Another silent mutation
	(cfg as any).cache.ttl = 600;
}

connectToDatabase(tracked);
initCache(tracked);

console.log("Mutations detected:");
mutations.forEach((m) => console.log(" ", m));
// db.port = 5433
// cache.ttl = 600
