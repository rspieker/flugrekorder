import { getPath, getProxyById } from './inspection.ts';
import type { Proxiable, Rekording, Serialized } from './types.ts';

function resolve(id: string, proxy?: Proxiable): string {
	if (!proxy) return id;
	const p = getProxyById(id, proxy);
	return p !== undefined ? getPath(p) : id;
}

/** The member of `Serialized` that a tag such as `$date` identifies. */
type Tag<K extends string> = Extract<
	Serialized,
	{ readonly [P in K]: unknown }
>;

/** Narrows a serialized value to the tag `key`; plain objects and arrays are never tags. */
function tagged<K extends string>(v: Serialized, key: K): v is Tag<K> {
	return typeof v === 'object' && v !== null && !Array.isArray(v) && key in v;
}

function display(v: Serialized, proxy?: Proxiable, limit = 80): string {
	if (v === null || v === undefined) return String(v);
	if (typeof v !== 'object') return String(v);
	if (tagged(v, '$proxy')) return resolve(v.$proxy, proxy);
	if (tagged(v, '$unwrap')) return `↓${resolve(v.$unwrap.$proxy, proxy)}`;
	if (tagged(v, '$omitted')) return `‹${v.$omitted}›`;
	if (tagged(v, '$bigint')) return `${v.$bigint}n`;
	if (tagged(v, '$undefined')) return 'undefined';
	if (tagged(v, '$number')) return v.$number;
	if (tagged(v, '$symbol')) return `Symbol(${v.$symbol})`;
	if (tagged(v, '$date')) return `Date(${v.$date})`;
	if (tagged(v, '$regexp')) return `/${v.$regexp.source}/${v.$regexp.flags}`;
	if (tagged(v, '$error')) return `${v.$error.name}(${v.$error.message})`;
	if (tagged(v, '$url')) return `URL(${v.$url})`;
	if (tagged(v, '$function')) return `ƒ ${v.$function || '(anonymous)'}`;
	if (tagged(v, '$binary')) return `${v.$binary.type}(…)`;
	if (tagged(v, '$weakmap')) return 'WeakMap';
	if (tagged(v, '$weakset')) return 'WeakSet';

	const raw = tagged(v, '$map')
		? `Map(${v.$map.map(([k, x]) => `${display(k, proxy)} => ${display(x, proxy)}`).join(', ')})`
		: tagged(v, '$set')
			? `Set(${v.$set.map((x) => display(x, proxy)).join(', ')})`
			: Array.isArray(v)
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
