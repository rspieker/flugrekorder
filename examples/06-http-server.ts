/**
 * HTTP server lifecycle
 *
 * Problem: you want to see the complete sequence of what a Node.js HTTP server
 * does — from startup through request handling to shutdown — without touching
 * any application code.
 *
 * Wrap the server itself rather than wrapping individual request objects.
 * One proxy on createServer()'s return value covers the entire lifetime:
 * the requests and responses the server creates are proxied too, so the
 * handler's own calls (res.writeHead, res.end) are recorded as well.
 *
 * only: ['apply'] keeps output to the trap that tells the story: which
 * functions are called, and when. The callback prints the calls on the
 * server itself and skips Node.js internals (names starting with `_`).
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
	only: ['apply'],
	callback(r) {
		if (r.trap !== 'apply' || !r.origin || !('source' in r.origin)) return;
		// origin.source is the proxy ID of the object the function was read from
		const fn = getProxyById(r.origin.source, server);
		if (!fn) return;
		// a path without a dot is a method of the server itself
		const path = getPath(fn);
		if (path.includes('.') || path.startsWith('_')) return;
		console.log(format(r, server));
	},
});

// wait for it to start
await new Promise<void>(r => server.listen(3000, r));

// log the result of one request
console.log((await fetch('http://localhost:3000/')).status);

// stop the server
server.close();

// Output:
//   on(listening, {"listener":{}})
//   once(listening, {})
//   listen(3000, {})
//   removeListener(listening, _events.listening.1)
//   emit(listening)
//   emit(connection, {"connecting":false,"_hadError":false,…)
//   emit(socket, Symbol(IncomingMessage)())
//   on(finish, ↓Symbol(ServerResponse)()._events.finish)
//   emit(prefinish)
//   emit(request, Symbol(IncomingMessage)(), Symbol(ServerResponse)())
//   emit(finish)
//   emit(end)
//   emit(close)
//   emit(close)
//   200
//   closeIdleConnections()
//   close()
//   emit(close)
//
// The request and response are created by the server (`new IncomingMessage`,
// `new ServerResponse`), so they are proxies too: emit(request, …) passes them
// by reference, and their paths name where they came from. Their events show
// up as emit(finish), emit(end), …: they share EventEmitter's emit function,
// and one function has one proxy, whose path is where it was first reached.
//
// Switching to stream: createWriteStream('server.ndjson') writes raw NDJSON.
// The record of emit(request, …) looks like:
//
//   {"id":"#98","trap":"apply","origin":{"trap":"apply","source":"#13"},
//    "args":[{"$unwrap":{"$proxy":"#13"}},{"$proxy":"#1"},
//            ["request",{"$proxy":"#28"},{"$proxy":"#35"}]],
//    "result":true,"timestamp":1748091234567}
//
// (The ids depend on everything recorded before.) args[1] is the server proxy
// (#1). args[0] is the raw emit function — known to the graph as the target of
// the emit proxy (#13), so it serialises as $unwrap.
// args[2][0] is the event name; the request and response follow as proxies.
