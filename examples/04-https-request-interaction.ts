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
import * as https from "node:https";
import { create, getPath, getProxyById } from "flugrekorder";

// code under test

function loadPage(
	http: typeof https,
	url: string,
	callback: (status: number, size: number) => void,
): void {
	const req = http.request(url);

	req.on("response", (res) => {
		let size = 0;
		res.on("data", (chunk: Buffer) => {
			size += chunk.length;
		});
		res.on("end", () => callback(res.statusCode ?? 0, size));
	});

	req.end();
}

// record

let client!: typeof https;
const calls: Array<string> = [];

client = create(https, {
	// get wraps property lookups into proxies so apply can fire on method calls
	only: ["get", "apply"],
	callback(r) {
		if (r.trap !== "apply" || !r.origin || !("source" in r.origin)) return;
		// origin.source is the proxy ID of the object the function was read from
		const fn = getProxyById(r.origin.source, client);
		if (!fn) return;
		const name = getPath(fn);
		const method = name.split(".").pop() ?? "";

		// flugrekorder records every call including Node.js internals fired during
		// event dispatch; keep only the calls the application explicitly makes
		if (method.startsWith("_") || method === "emit" || method === "uncork")
			return;
		// depth > 2 means a method on a nested object (e.g. req.socket.cork) — skip those
		if (name.split(".").length > 2) return;

		// Reflect.apply signature: (target, thisArg, argumentsList) — index 2 is the call args
		// filter out callbacks: they aren't serialisable and add noise without meaning
		const args = (r.args[2] as Array<unknown>)
			.filter((a) => typeof a !== "function")
			.map((a) => JSON.stringify(a))
			.join(", ");
		calls.push(`${name}(${args})`);
	},
});

loadPage(
	client,
	"https://www.rammstein.de/en/history/reisereisealbum/",
	(status, size) => {
		console.log("Calls recorded:");
		calls.forEach((entry) => console.log(" ", entry));
		// request("https://www.rammstein.de/en/history/reisereisealbum/")
		// request().on("response", {})
		// request().end()

		console.log(`\nHTTP ${status} — ${size} bytes`);
	},
);
