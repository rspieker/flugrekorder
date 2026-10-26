// biome-ignore-all format: fixture code, kept compact
const { create } = Flugrekorder;

class Counter {
	#count = 1;
	increment() { return ++this.#count; }
	get value() { return this.#count; }
	read() { return this.#current(); }
	#current() { return this.#count; }
}

const make = () => ({
	map: new Map([['a', 1]]),
	set: new Set([1]),
	weak: new WeakMap(),
	date: new Date(0),
	counter: new Counter(),
	bytes: new Uint8Array([1, 2, 3, 4]),
	memory: new WebAssembly.Memory({ initial: 1 }),
	document,
});

// Each read once on the real objects and once through a proxy; the outcomes,
// errors included, as JSON.
const reads = {
	'Map size': (o) => o.map.size,
	'Map get': (o) => o.map.get('a'),
	'Set has': (o) => o.set.has(1),
	'WeakMap has': (o) => o.weak.has({}),
	'Date getTime': (o) => o.date.getTime(),
	'#private field, in a method': (o) => o.counter.increment(),
	'#private field, in a getter': (o) => o.counter.value,
	'#private method': (o) => o.counter.read(),
	'typed array length': (o) => o.bytes.length,
	'TextDecoder on a typed array': (o) => new TextDecoder().decode(o.bytes),
	'WebAssembly memory buffer': (o) => new Uint8Array(o.memory.buffer).length,
	'WebAssembly memory grow': (o) => o.memory.grow(1),
	'DOM method': (o) => o.document.querySelector('html').tagName,
	'DOM getter': (o) => o.document.body === null,
};

const outcome = (read, o) => {
	try { return JSON.stringify(read(o)); } catch (error) { return `${error.constructor.name}: ${error.message}`; }
};

window.scenarios = {
	builtins: () =>
		Object.entries(reads).map(([name, read]) => [
			name,
			outcome(read, make()),
			outcome(read, create(make(), { callback() {} })),
		]),
};
