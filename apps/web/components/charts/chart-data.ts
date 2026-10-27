/**
 * Pure shaping helpers shared by the chart components (E15).
 *
 * Kept free of React and Recharts so the data contract — bucketing, totals,
 * deltas and the accessible summary — can be unit tested without a DOM.
 */

export type ChartDirection = "up" | "down" | "flat";

export interface ChartPoint {
	/** Stable key/label from the series, e.g. `2026-10-05`. */
	label: string;
	value: number;
}

export interface ChartDelta {
	/** Percentage change, or null when a percentage is meaningless. */
	pct: number | null;
	direction: ChartDirection;
}

export interface ChartSummary {
	total: number;
	peak: ChartPoint | null;
	points: number;
}

/** True when there is nothing to plot (no points at all). */
export function isChartEmpty(points: ReadonlyArray<{ value: number }>): boolean {
	return points.length === 0;
}

/** Total of one or more series, ignoring non-finite values. */
export function sumValues(points: ReadonlyArray<{ value: number }>): number {
	return points.reduce(
		(total, point) => (Number.isFinite(point.value) ? total + point.value : total),
		0,
	);
}

/** Highest point (first wins on a tie), or null for an empty series. */
export function peakPoint(points: ReadonlyArray<ChartPoint>): ChartPoint | null {
	let peak: ChartPoint | null = null;
	for (const point of points) {
		if (!Number.isFinite(point.value)) continue;
		if (peak === null || point.value > peak.value) peak = point;
	}
	return peak;
}

export function summarize(points: ReadonlyArray<ChartPoint>): ChartSummary {
	return { total: sumValues(points), peak: peakPoint(points), points: points.length };
}

/**
 * Percentage change from `previous` to `current`.
 *
 * - A missing/unknown previous value yields `pct: null` (render a dash).
 * - Zero to a positive value has no meaningful percentage, so `pct` is null
 *   but the direction is still `up`.
 */
export function computeDelta(current: number, previous: number | null): ChartDelta {
	if (previous === null || !Number.isFinite(previous) || !Number.isFinite(current)) {
		return { pct: null, direction: "flat" };
	}
	if (previous === 0) {
		if (current === 0) return { pct: 0, direction: "flat" };
		return { pct: null, direction: current > 0 ? "up" : "down" };
	}

	const rounded = Math.round(((current - previous) / previous) * 10_000) / 100;
	return {
		pct: rounded,
		direction: rounded > 0 ? "up" : rounded < 0 ? "down" : "flat",
	};
}

/** Percentage-point change, used by the fleet-online share (not a ratio). */
export function computePointDelta(currentPct: number, previousPct: number | null): ChartDelta {
	if (previousPct === null || !Number.isFinite(previousPct) || !Number.isFinite(currentPct)) {
		return { pct: null, direction: "flat" };
	}
	const rounded = Math.round((currentPct - previousPct) * 10) / 10;
	return {
		pct: rounded,
		direction: rounded > 0 ? "up" : rounded < 0 ? "down" : "flat",
	};
}

/**
 * Shorten a bucket label for the x-axis:
 *
 * - a day (`2026-10-05`) becomes `10-05`;
 * - an hour (`2026-10-05 14:00`) becomes `14:00`;
 * - anything else is left alone.
 */
export function formatAxisDay(label: string): string {
	if (/^\d{4}-\d{2}-\d{2}$/.test(label)) return label.slice(5);
	const hour = /^\d{4}-\d{2}-\d{2} (\d{2}):00$/.exec(label);
	if (hour) return `${hour[1]}:00`;
	return label;
}

/** Deterministic thousands-separated number for summaries and tooltips. */
export function formatChartNumber(value: number, unit = ""): string {
	const formatted = Number.isFinite(value)
		? value.toLocaleString("en-US", { maximumFractionDigits: 2 })
		: "0";
	return unit ? `${formatted} ${unit}` : formatted;
}

/**
 * Day keys (`YYYY-MM-DD`) covering the window in `timeZone`, in order.
 * Used to fill zero buckets so a quiet day still appears on the x-axis.
 */
export function buildDayKeys(start: Date, end: Date, timeZone = "Asia/Manila"): string[] {
	const formatter = new Intl.DateTimeFormat("en-CA", {
		timeZone,
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
	});
	const dayMs = 24 * 60 * 60 * 1000;
	const keys: string[] = [];
	const seen = new Set<string>();

	// Step in 12-hour increments and keep the first occurrence of each local
	// day, which stays correct across DST-changing zones too.
	for (let cursor = start.getTime(); cursor <= end.getTime(); cursor += dayMs / 2) {
		const key = formatter.format(new Date(cursor));
		if (seen.has(key)) continue;
		seen.add(key);
		keys.push(key);
	}

	const endKey = formatter.format(end);
	if (!seen.has(endKey)) keys.push(endKey);
	return keys;
}

export interface DailyRow {
	label: string;
	value: number;
}

/** Align raw day buckets to the continuous key list, filling missing days with 0. */
export function fillDailySeries(
	rows: ReadonlyArray<DailyRow>,
	keys: ReadonlyArray<string>,
): ChartPoint[] {
	const byDay = new Map<string, number>();
	for (const row of rows) {
		byDay.set(
			row.label,
			(byDay.get(row.label) ?? 0) + (Number.isFinite(row.value) ? row.value : 0),
		);
	}
	return keys.map((label) => ({ label, value: byDay.get(label) ?? 0 }));
}

export interface FeedBucketRow {
	label: string;
	source: string;
	count: number;
	grams: number;
}

export interface StackedSeries {
	/** Ordered source keys, used by the chart and the hidden table. */
	sources: string[];
	rows: Array<{ label: string } & Record<string, number | string>>;
	totalsBySource: Record<string, number>;
}

/**
 * Turn raw `(day, source, count, grams)` rows into one row per day with a
 * column per source, plus the per-source totals for the legend.
 */
export function buildStackedSeries(
	rows: ReadonlyArray<FeedBucketRow>,
	keys: ReadonlyArray<string>,
	options: { value: "count" | "grams" } = { value: "count" },
): StackedSeries {
	const sources: string[] = [];
	const totalsBySource: Record<string, number> = {};
	const byDay = new Map<string, Map<string, number>>();

	for (const row of rows) {
		const source = row.source || "unknown";
		if (!(source in totalsBySource)) {
			sources.push(source);
			totalsBySource[source] = 0;
		}
		const amount = options.value === "grams" ? row.grams : row.count;
		const safeAmount = Number.isFinite(amount) ? amount : 0;
		totalsBySource[source] += safeAmount;

		const day = byDay.get(row.label) ?? new Map<string, number>();
		day.set(source, (day.get(source) ?? 0) + safeAmount);
		byDay.set(row.label, day);
	}

	const chartRows = keys.map((label) => {
		const day = byDay.get(label);
		const row: { label: string } & Record<string, number | string> = { label };
		for (const source of sources) row[source] = day?.get(source) ?? 0;
		return row;
	});

	return { sources, rows: chartRows, totalsBySource };
}

/** Value of one series in a stacked chart, safe for totals/labels. */
export function stackedValue(row: Record<string, number | string>, key: string): number {
	const value = row[key];
	return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/** One aggregated observation: a bucket, a series (e.g. sampling batch) and a value. */
export interface MultiSeriesPoint {
	label: string;
	series: string;
	value: number;
}

export interface MultiSeries {
	/** Ordered series keys, first seen wins. */
	series: string[];
	/** One row per bucket; a series with no reading in that bucket is `null`. */
	rows: Array<{ label: string } & Record<string, number | string | null>>;
}

/**
 * Turn aggregated `(bucket, series, value)` rows into one row per bucket with a
 * column per series.
 *
 * Unlike the stacked helper there is no zero fill: a batch that was not sampled
 * on a day has no reading, so the line shows a gap instead of a false 0 g
 * sample. The raw rows are already aggregated in the database, so duplicates
 * are not expected; if one appears the later value wins rather than being
 * summed (these are averages, not counts).
 */
export function buildMultiSeries(
	rows: ReadonlyArray<MultiSeriesPoint>,
	keys: ReadonlyArray<string>,
): MultiSeries {
	const series: string[] = [];
	const byBucket = new Map<string, Map<string, number>>();

	for (const row of rows) {
		if (!series.includes(row.series)) series.push(row.series);
		if (!Number.isFinite(row.value)) continue;
		const bucket = byBucket.get(row.label) ?? new Map<string, number>();
		bucket.set(row.series, row.value);
		byBucket.set(row.label, bucket);
	}

	return {
		series,
		rows: keys.map((label) => {
			const bucket = byBucket.get(label);
			const row: { label: string } & Record<string, number | string | null> = { label };
			for (const key of series) row[key] = bucket?.get(key) ?? null;
			return row;
		}),
	};
}

/** Number of real readings in a multi-series chart (non-null cells). */
export function countSeriesValues(multi: MultiSeries): number {
	let total = 0;
	for (const row of multi.rows) {
		for (const key of multi.series) {
			if (typeof row[key] === "number") total += 1;
		}
	}
	return total;
}

/** Share of a part in a whole, rounded to one decimal. 0 when the whole is 0. */
export function sharePct(part: number, whole: number): number {
	if (!Number.isFinite(part) || !Number.isFinite(whole) || whole <= 0) return 0;
	return Math.round((part / whole) * 1000) / 10;
}
