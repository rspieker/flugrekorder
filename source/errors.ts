export function isError(input: unknown): input is Error {
	return input ? input instanceof Error : false;
}

export function createErrorGuard(
	name: string,
	contains?: RegExp,
): (input: unknown) => input is Error {
	const checks: Array<(input: unknown) => boolean> = [
		isError,
		(sub: unknown) =>
			typeof sub === 'object' &&
			(sub as Record<string, unknown>)?.name === name,
	];

	if (contains instanceof RegExp) {
		checks.push((v) => contains.test(String(v)));
	}

	return (input: unknown): input is Error =>
		checks.every((predicate) => predicate(input));
}
