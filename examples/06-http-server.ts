/**
 * HTTP server lifecycle
 *
 * Problem: you want to see the complete sequence of what a Node.js HTTP server
 * does — from startup through request handling to shutdown — without touching
 * any application code.
 *
 * Wrap the server itself rather than wrapping individual request objects.
 * One proxy on createServer()'s return value covers the entire lifetime.
 * The request handler still receives the real req and res objects; recording
 * happens at the server boundary, not inside the handler.
 *
 * only: ['get', 'apply'] keeps output to the two traps that tell the story:
 * which functions are looked up, and when they are called.
 */
import { createServer } from 'node:http';
import { create, format, getPath, getProxyById } from 'flugrekorder';

// create a simple server
function makeServer() {
	return createServer((_req, res) => {
		res.writeHead(200, { 'Content-Type': 'text/plain' });
		res.end('hello\n');
	});
}

// create the server flugrekorder
const server = create(makeServer(), {
	only: ['get', 'apply'],
	callback(r) {
		// get records are captured so functions enter the graph; only apply records are printed
		if (r.trap !== 'apply' || !r.origin || !('source' in r.origin)) return;
		// origin.source is the proxy ID of the object the function was read from
		const fn = getProxyById(r.origin.source, server);
		if (fn) console.log(format(r, server));
	},
});

// wait for it to start
await new Promise<void>(r => server.listen(3000, r));

// log the result of one request
console.log((await fetch('http://localhost:3000/')).status);

// stop the server
server.close();

// Output (apply records only):
//   emit(listening)
//   listen(3000, {})
//   emit(connection, {...})
//   emit(request, {"url":"/","method":"GET",...}, {"statusCode":200,...})
//   close()
//   emit(close)
//
// The get records are the wiring — they proxy emit, listen, and close into the
// graph so their apply traps can fire. The apply records are the story.
//
// emit(listening) appears before listen(3000) because it fires synchronously
// inside listen()'s Reflect.apply, before the listen record itself is emitted.
//
// Switching to stream: createWriteStream('server.ndjson') writes raw NDJSON.
// Each apply record looks like:
//
//   {"id":"#6","trap":"apply","origin":{"trap":"apply","source":"#4"},
//    "args":[{"$unwrap":{"$proxy":"#4"}},{"$proxy":"#1"},
//            ["request",{"url":"/","method":"GET",...},{...}]],
//    "result":true,"timestamp":1748091234567}
//
// args[1] is the server proxy (#1). args[0] is the raw emit function — known
// to the graph as the target of proxy #4, so it serialises as $unwrap.
// args[2][0] is the event name; the remaining elements are the event payload.
