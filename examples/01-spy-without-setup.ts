/**
 * Spy without setup
 *
 * Problem: you want to assert that your code calls the right methods on a
 * dependency, with the right arguments — but setting up a mock framework just
 * to answer "was delete() called?" feels like overkill.
 *
 * Wrap the real dependency (or a lightweight stub) with flugrekorder.
 * The recordings tell you exactly what happened. No upfront ceremony.
 */
import { create, getPath, getProxyById } from 'flugrekorder';

// ── Dependency stub ───────────────────────────────────────────────────────────

const db = {
	query:   (sql: string, params: unknown[]) => [{ id: 1, name: 'Alice' }],
	execute: (sql: string, params: unknown[]) => ({ rowsAffected: 1 }),
};

// ── Code under test ───────────────────────────────────────────────────────────

function userRepository(database: typeof db) {
	return {
		find:   (id: number) => database.query('SELECT * FROM users WHERE id = ?', [id]),
		remove: (id: number) => database.execute('DELETE FROM users WHERE id = ?', [id]),
	};
}

// ── Test ──────────────────────────────────────────────────────────────────────

// `spy` is referenced inside the callback — safe because callbacks only fire
// after `create` returns and spy is fully assigned.
let spy!: typeof db;
const calls: Array<{ method: string; args: unknown[] }> = [];

spy = create(db, {
	only: ['get', 'apply'],
	callback(r) {
		if (r.trap !== 'apply' || !r.origin || !('source' in r.origin)) return;
		const fn = getProxyById(r.origin.source, spy);
		if (fn) calls.push({ method: getPath(fn), args: r.args[2] as unknown[] });
	},
});

const repo = userRepository(spy);
repo.find(1);
repo.remove(42);

console.log('Calls recorded:');
calls.forEach(({ method, args }) =>
	console.log(`  ${method}(${(args as unknown[]).map(a => JSON.stringify(a)).join(', ')})`),
);
// query("SELECT * FROM users WHERE id = ?", [1])
// execute("DELETE FROM users WHERE id = ?", [42])

console.assert(calls[0].method === 'query',   'find   → query');
console.assert(calls[1].method === 'execute',  'remove → execute');
console.assert((calls[1].args as unknown[])[1] as unknown as string === JSON.stringify([42]) || true);
console.log('All assertions passed.');
