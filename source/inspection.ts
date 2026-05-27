import { Graph } from './graph';
import type { Origin, Proxiable } from './types';

/** Returns the original unwrapped target of a proxy, or `null` for non-proxies. */
export function getTarget(pxy: Proxiable): Proxiable | null {
	return Graph.for(pxy)?.getByProxy(pxy)?.target ?? null;
}

/**
 * Looks up a proxy by its recorded ID within the same graph as `pxy`.
 * Use this to resolve `{ $proxy: id }` references in recorded args and results back to live proxies.
 */
export function getProxyById(
	id: string,
	pxy: Proxiable,
): Proxiable | undefined {
	return Graph.for(pxy)?.getById(id)?.proxy;
}

/** Returns the `Origin` of a proxy — how and from where it was created. Returns `null` for root proxies and non-proxies. */
export function getOrigin(pxy: Proxiable): Origin {
	return Graph.for(pxy)?.getByProxy(pxy)?.origin ?? null;
}

/**
 * Walks the origin chain from the root proxy down to `pxy`.
 * Returns an ordered array of `{ proxy, origin }` pairs, root first.
 * Returns an empty array for non-proxies.
 */
export function getAncestors(
	pxy: Proxiable,
): Array<{ proxy: Proxiable; origin: Origin }> {
	const graph = Graph.for(pxy);

	if (!graph) return [];

	const result: Array<{ proxy: Proxiable; origin: Origin }> = [];
	let node = graph.getByProxy(pxy);

	while (node) {
		result.unshift({ proxy: node.proxy, origin: node.origin });
		if (!node.origin) break;

		const parentId =
			'parent' in node.origin ? node.origin.parent : node.origin.source;

		node = graph.getById(parentId);
	}

	return result;
}

/**
 * Returns a human-readable dotted path string for a proxy.
 * Function and constructor calls are annotated with `()`.
 * Returns an empty string for the root proxy and for non-proxies.
 */
export function getPath(pxy: Proxiable): string {
	const ancestors = getAncestors(pxy);
	const parts: Array<string> = [];

	for (const { origin: o } of ancestors) {
		if (!o) continue;
		if ('key' in o) {
			parts.push(String(o.key));
		} else {
			if (parts.length > 0) {
				parts[parts.length - 1] += '()';
			} else {
				parts.push('()');
			}
		}
	}

	return parts.join('.');
}
