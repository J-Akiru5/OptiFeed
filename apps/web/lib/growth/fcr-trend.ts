/**
 * Direction of an FCR series (#752).
 *
 * A single report (or none) is not a trend: the growth page used to print
 * "trending downwards" even when there was no data. Direction is only defined
 * once two comparable reports exist.
 */
export function fcrTrendDirection(values: readonly number[]): -1 | 0 | 1 | null {
	if (values.length < 2) return null;
	const previous = values[values.length - 2];
	const latest = values[values.length - 1];
	if (!Number.isFinite(previous) || !Number.isFinite(latest)) return null;
	return Math.sign(latest - previous) as -1 | 0 | 1;
}
