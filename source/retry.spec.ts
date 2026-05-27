import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { each } from 'template-literal-each';
import type { Improbability } from '../test/test-helpers';
import { Graph } from './graph';
import { unwrap } from './retry';

describe('source/retry', () => {
	describe('unwrap', () => {
		test('returns value unchanged when graph is undefined', () => {
			each<{ value: Improbability; label: string }>`
				value        | label
				------------ | -------
				${{}}        | object
				${null}      | null
				${undefined} | undefined
				${42}        | number
			`(({ value, label }: Improbability) => {
				assert.strictEqual(unwrap(undefined, value), value, label);
			});
		});

		test('returns value unchanged when not registered in the graph', () => {
			const graph = new Graph(0);

			each<{ value: Improbability; label: string }>`
				value        | label
				------------ | -------
				${{}}        | plain object not in graph
				${null}      | null
				${undefined} | undefined
				${42}        | number
			`(({ value, label }: Improbability) => {
				assert.strictEqual(unwrap(graph, value), value, label);
			});
		});

		test('returns the target when value is a proxy registered in the graph', () => {
			const graph = new Graph(0);
			const target = {};
			const proxy = new Proxy(target, {});

			graph.register(proxy, target, null, graph.nextId());

			assert.strictEqual(unwrap(graph, proxy), target);
		});
	});
});
