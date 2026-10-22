import { getPath, getProxyById } from './inspection.ts';
import type { Proxiable, Rekording, Serialized } from './types.ts';

function resolve(id: string, proxy?: Proxiable): string {
	if (!proxy) return id;
	const p = getProxyById(id, proxy);
	return p !== undefined ? getPath(p) : id;
}

function display(v: Serialized, proxy?: Proxiable, limit = 80): string {
	if (v === null || v === undefined) return String(v);
	if (typeof v !== 'object') return String(v);
	if (!Array.isArray(v) && '$proxy' in v)
		return resolve(v.$proxy as string, proxy);
	if (!Array.isArray(v) && '$unwrap' in v)
		return `↓${resolve((v as { $unwrap: { $proxy: string } }).$unwrap.$proxy, proxy)}`;
	const raw = Array.isArray(v)
		? `[${v.map((i) => display(i, proxy)).join(', ')}]`
		: JSON.stringify(v);
	return raw.length > limit ? `${raw.slice(0, limit)}…` : raw;
}

/** Converts a `Rekording` to a human-readable string.
 * When `proxy` is supplied, `{ $proxy: id }` tags in args and results resolve to dotted paths.
 * When omitted, raw IDs are shown instead. */
export function format(rekording: Rekording, proxy?: Proxiable): string {
	const { id, trap, origin, args, result } = rekording;

	if (origin && 'parent' in origin) {
		const parent = resolve(origin.parent, proxy);
		const path = parent ? `${parent}.${origin.key}` : String(origin.key);
		if (trap === 'set') return `${path} = ${display(args[2], proxy)}`;
		if (trap === 'get') return `${path} → ${display(result, proxy)}`;
		return `${trap} ${path}`;
	}

	if (origin && 'source' in origin) {
		const path = resolve(origin.source, proxy);
		const callArgs = (
			Array.isArray(trap === 'construct' ? args[1] : args[2])
				? ((trap === 'construct'
						? args[1]
						: args[2]) as Array<Serialized>)
				: []
		)
			.map((a) => display(a, proxy))
			.join(', ');
		if (/^apply(:|$)/.test(trap)) return `${path}(${callArgs})`;
		if (trap === 'construct' || trap === 'construct:native')
			return `new ${path}(${callArgs})`;
	}

	return `${trap} on ${id}`;
}
