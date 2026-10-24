/**
 * Frozen state dependencies
 *
 * Problem: a view re-renders more often than it should. Its selector reads
 * from a store whose state is deeply frozen — as Redux Toolkit (through
 * Immer) does — and you want to know which parts of the state it actually
 * depends on, so you can tell which updates should trigger it.
 *
 * Wrap the frozen state and collect every property the selector reads.
 * Frozen objects hold a proxy to their real values; flugrekorder wraps a
 * stand-in instead, so nested reads through frozen objects are recorded too.
 */
import { create, getPath, getProxyById, getTarget } from 'flugrekorder';

// a store's state, deeply frozen

function deepFreeze<T extends object>(value: T): T {
	for (const nested of Object.values(value))
		if (nested && typeof nested === 'object') deepFreeze(nested);

	return Object.freeze(value);
}

const state = deepFreeze({
	filter: 'open',
	todos: [
		{ id: 1, title: 'document frozen state', done: false, tags: ['docs'] },
		{ id: 2, title: 'release next version', done: false, tags: [] },
		{ id: 3, title: 'build flugrekorder', done: true, tags: ['code'] },
	],
	user: { name: 'Rogier', preferences: { theme: 'dark' } },
});

// the selector under suspicion

function selectVisibleTitles(s: typeof state): Array<string> {
	return s.todos
		.filter((todo) => s.filter === 'all' || !todo.done)
		.map((todo) => todo.title);
}

// wrap, select, collect

// todos.0.title → todos[n].title: which item was read matters less than what
const general = (path: string) => path.replace(/\.\d+(?=\.|$)/g, '[n]');

let tracked!: typeof state;
const reads = new Set<string>();

tracked = create(state, {
	only: ['get'],
	callback(r) {
		if (!r.origin || !('parent' in r.origin)) return;

		const parent = getProxyById(r.origin.parent, tracked);
		const owner = parent && getTarget(parent);

		// keep reads of the state's own data — not of methods like `filter`,
		// nor of the `Array` constructor that `filter` uses to create its result
		if (typeof owner !== 'object' || !Object.hasOwn(owner, r.origin.key))
			return;

		const prefix = getPath(parent);

		reads.add(general(prefix ? `${prefix}.${r.origin.key}` : r.origin.key));
	},
});

console.log(selectVisibleTitles(tracked));
// [ 'document frozen state', 'release next version' ]

// report: what was read, and what was never read

function paths(value: object, prefix = ''): Array<string> {
	return Object.entries(value).flatMap(([key, nested]) => {
		const path = general(prefix ? `${prefix}.${key}` : key);

		return nested && typeof nested === 'object'
			? [path, ...paths(nested, path)]
			: [path];
	});
}

const all = new Set(paths(state));
const parent = (path: string) => path.replace(/(\[n\]|\.[^.[]+)$/, '');
// unread paths whose parent was read (or is the state itself), not every path below them
const unread = [...all].filter(
	(path) =>
		!reads.has(path) && (parent(path) === path || reads.has(parent(path))),
);

console.log('Read by the selector:', [...reads]);
// [ 'todos', 'todos.length', 'todos[n]', 'filter', 'todos[n].done', 'todos[n].title' ]

console.log('Never read:', unread);
// [ 'todos[n].id', 'todos[n].tags', 'user' ]
// → updates to these can't change what this selector returns
