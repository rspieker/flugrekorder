import { create, Proxiable } from '../source/flugrekorder';

// biome-ignore lint/suspicious/noExplicitAny: Improbability is the intentional escape hatch for test assertions that cannot be typed otherwise
export type Improbability = any;

export function isProxyTag(v: unknown): v is { $proxy: string } {
	if (typeof v === 'object' && v !== null && !Array.isArray(v)) {
		return '$proxy' in v;
	}

	return false;
}

function noop() { }

export function createTestProxyRecorder<T extends Proxiable>(target: T, fn: (proxy: Improbability) => void = noop): {records: Array<Improbability>, proxy: T} {
	const records: Array<Improbability> = [];
	const proxy = create(target, { callback: (r) => records.push(r) });

	fn(proxy);

	return { records, proxy };
}
