// biome-ignore-all format: positions in this file are asserted in test/stack.browser.ts — move nothing
const { create, registerStackParser } = Flugrekorder;
const records = [];
const api = create({ greet: (name) => `hello, ${name}` }, { only: ['get', 'apply'], stack: true, callback: (r) => records.push(r) });

function callGreet() { return api.greet('world'); }

function applied() { records.length = 0; callGreet(); return records.find((r) => r.trap === 'apply'); }

window.scenarios = {
	stack: () => applied().stack,
	frozen: () => {
		const exports = create(Object.freeze({ hello: () => 'hi' }), { callback: (r) => records.push(r) });
		records.length = 0;
		return [exports.hello(), records.map((r) => r.trap)];
	},
	location: () => {
		try { create({}, { location: true, callback() {} }); return 'created'; } catch (error) { return error.message; }
	},
	registered: () => {
		registerStackParser((line) => {
			const match = line.match(/(https:\/\/[^\s()@]+):(\d+):(\d+)/);
			return match ? { file: match[1], line: Number(match[2]), column: Number(match[3]), function: 'registered' } : undefined;
		});
		return applied().stack;
	},
};
