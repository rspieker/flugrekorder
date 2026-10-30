import { Graph } from './graph.ts';
import { hasLocation, location } from './trace.ts';
import type { Origin, Proxiable, SourceLocation } from './types.ts';

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
 * Returns an ordered array of `{ id, proxy, origin }` steps, root first.
 * The chain is complete even when ancestors have been garbage collected; the
 * `proxy` of such a step is then `undefined`.
 * Returns an empty array for non-proxies.
 */
export function getAncestors(
	pxy: Proxiable,
): Array<{ id: string; proxy: Proxiable | undefined; origin: Origin }> {
	const graph = Graph.for(pxy);
	const result: Array<{
		id: string;
		proxy: Proxiable | undefined;
		origin: Origin;
	}> = [];

	for (
		let lineage = graph?.getByProxy(pxy)?.lineage;
		lineage;
		lineage = lineage.parent ?? undefined
	)
		result.unshift({
			id: lineage.id,
			proxy: graph?.getById(lineage.id)?.proxy,
			origin: lineage.origin,
		});

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

/**
 * Returns where the function behind a proxy is defined. Returns `null` for
 * non-proxies, proxies of anything other than a function, functions without
 * a source location (native functions), and runtimes without `node:inspector`.
 */
export function getLocation(pxy: Proxiable): SourceLocation | null {
	const target = getTarget(pxy);

	return typeof target === 'function' && hasLocation()
		? location(target)
		: null;
}
