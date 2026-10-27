import {
	type ChartPoint,
	type MultiSeries,
	type MultiSeriesPoint,
	type StackedSeries,
	buildMultiSeries,
	buildStackedSeries,
} from "@/components/charts/chart-data";
import {
	FEED_CHART_DAYS,
	type HopperRange,
	type WaterTempRange,
	resolveDayWindow,
	resolveWaterTempWindow,
} from "@/lib/chart-windows";
import { PH_TZ } from "@/lib/constants";
import {
	EMPTY_FEED_TOTALS,
	type FeedTotals,
	MACHINE_FEED_SOURCES,
	startOfFarmDay,
} from "@/lib/feed-figures";
import prisma from "@/lib/prisma";
import { Prisma } from "@prisma/client";

/**
 * Read-only, pond-scoped data for the farmer charts (#188, E15).
 *
 * Every series is aggregated in PostgreSQL (`date_trunc` + `GROUP BY`), never
 * by fetching rows and folding them in JavaScript. Callers pass the device ids
 * they already resolved through `getActivePond`, so the same owner scoping as
 * the page's tables applies to the charts.
 *
 * Window helpers live in `lib/chart-windows.ts`; this module only queries.
 *
 * Timestamp columns are Prisma `DateTime` = Postgres `timestamp(3)` WITHOUT time
 * zone, holding UTC. Buckets therefore use `ts AT TIME ZONE 'UTC' AT TIME ZONE
 * '<zone>'`: the first step marks the value as UTC (timestamptz), the second
 * turns it into the naive local time, and `date_trunc` then cuts the local day
 * regardless of the session timezone. A single `AT TIME ZONE '<zone>'` would
 * read the UTC value as local time and move the first 8 hours of each Manila
 * day into the previous bucket (verified against the database on 2026-10-28).
 */

/** Batch label used when a biomass sample has none. */
export const UNLABELED_BATCH = "__unlabeled";

interface BucketRow {
	bucket: string;
	value: number;
}

interface FeedBucketQueryRow {
	day: string;
	source: string;
	total: number;
	grams: number;
}

interface BiomassBucketQueryRow {
	day: string;
	batch: string;
	grams: number;
}

/** Round a charted measurement to one decimal place. */
function round1(value: number): number {
	return Number.isFinite(value) ? Math.round(value * 10) / 10 : 0;
}

function toPoints(rows: ReadonlyArray<BucketRow>): ChartPoint[] {
	return rows
		.filter((row) => Number.isFinite(row.value))
		.map((row) => ({ label: row.bucket, value: round1(row.value) }));
}

export interface FeedPerDayBySource {
	dayKeys: string[];
	stack: StackedSeries;
	/**
	 * Rows per source in the same window as the chart. A `hand_fed` count is a
	 * count of imported daily totals, not a count of dispenses.
	 */
	countsBySource: Record<string, number>;
}

/**
 * Feed dispensed per local day for the last 30 days, split by source
 * (scheduled / dashboard / button / hand-fed) in grams.
 *
 * Days without a dispense are zero-filled from the same key list the x-axis
 * uses, so a quiet day is visible. No dispense at all collapses to an empty
 * stack so the chart can show its empty state instead of a bare axis.
 *
 * `hand_fed` rows are daily totals imported from a data sheet; they are charted
 * because they are feed the pond received, and every label calls them hand-fed.
 */
export async function getFeedPerDayBySource(
	deviceIds: ReadonlyArray<string>,
	now = new Date(),
): Promise<FeedPerDayBySource> {
	const { start, end, dayKeys } = resolveDayWindow(FEED_CHART_DAYS, now);
	const empty: StackedSeries = { sources: [], rows: [], totalsBySource: {} };

	if (deviceIds.length === 0) return { dayKeys, stack: empty, countsBySource: {} };

	const rows = await prisma.$queryRaw<FeedBucketQueryRow[]>`
		SELECT to_char(date_trunc('day', "receivedAt" AT TIME ZONE 'UTC' AT TIME ZONE ${PH_TZ}::text), 'YYYY-MM-DD') AS day,
		       COALESCE(NULLIF("source", ''), 'unknown') AS source,
		       COUNT(*)::int AS total,
		       COALESCE(SUM("grams"), 0)::float8 AS grams
		FROM "FeedEvent"
		WHERE "eventType" = 'feed_dispensed'
		  AND "deviceId" IN (${Prisma.join(deviceIds)})
		  AND "receivedAt" >= ${start} AND "receivedAt" < ${end}
		GROUP BY 1, 2
		ORDER BY 1, 2
	`;

	const stack = buildStackedSeries(
		rows.map((row) => ({
			label: row.day,
			source: row.source,
			count: row.total,
			grams: row.grams,
		})),
		dayKeys,
		{ value: "grams" },
	);

	const countsBySource: Record<string, number> = {};
	for (const row of rows) {
		countsBySource[row.source] = (countsBySource[row.source] ?? 0) + row.total;
	}

	if (stack.sources.length === 0) return { dayKeys, stack: empty, countsBySource };
	return { dayKeys, stack, countsBySource };
}

/**
 * The History summary figures (issue #236).
 *
 * The old card added the grams of the first page of rows together, which mixed
 * machine dispenses with `hand_fed` daily totals and had no window. These three
 * questions each have an explicit window and are computed in the database:
 *
 * - last feed: the newest row the device itself dispensed (`hand_fed` excluded);
 * - today: every source since Asia/Manila midnight;
 * - last 7 days: every source over the seven farm days ending today.
 */
export async function getFeedTotals(
	deviceIds: ReadonlyArray<string>,
	now = new Date(),
): Promise<FeedTotals> {
	if (deviceIds.length === 0) return { ...EMPTY_FEED_TOTALS };

	const todayStart = startOfFarmDay(now);
	const week = resolveDayWindow(7, now);

	const [last, today, last7Days] = await Promise.all([
		prisma.feedEvent.findFirst({
			where: {
				deviceId: { in: [...deviceIds] },
				eventType: "feed_dispensed",
				source: { in: [...MACHINE_FEED_SOURCES] },
			},
			orderBy: [{ receivedAt: "desc" }, { id: "desc" }],
			select: { grams: true, source: true, receivedAt: true },
		}),
		prisma.feedEvent.aggregate({
			where: {
				deviceId: { in: [...deviceIds] },
				eventType: "feed_dispensed",
				receivedAt: { gte: todayStart },
			},
			_sum: { grams: true },
			_count: { _all: true },
		}),
		prisma.feedEvent.aggregate({
			where: {
				deviceId: { in: [...deviceIds] },
				eventType: "feed_dispensed",
				receivedAt: { gte: week.start, lt: week.end },
			},
			_sum: { grams: true },
			_count: { _all: true },
		}),
	]);

	const last7DaysGrams = last7Days._sum.grams ?? 0;
	return {
		lastMachineFeed: last
			? { grams: last.grams ?? 0, source: last.source ?? "unknown", receivedAt: last.receivedAt }
			: null,
		todayGrams: today._sum.grams ?? 0,
		todayCount: today._count._all,
		last7DaysGrams,
		last7DaysCount: last7Days._count._all,
		last7DaysDailyAverageG: last7DaysGrams / 7,
	};
}

/**
 * Average hopper level per local day for the selected window.
 *
 * The feeder logs a reading at most every 30 minutes, so the daily average is
 * the honest trend; hours without a reading are absent rather than 0 %.
 */
export async function getHopperLevelSeries(
	deviceIds: ReadonlyArray<string>,
	range: HopperRange,
	now = new Date(),
): Promise<ChartPoint[]> {
	if (deviceIds.length === 0) return [];
	const { start, end } = resolveDayWindow(range, now);

	const rows = await prisma.$queryRaw<BucketRow[]>`
		SELECT to_char(date_trunc('day', "recordedAt" AT TIME ZONE 'UTC' AT TIME ZONE ${PH_TZ}::text), 'YYYY-MM-DD') AS bucket,
		       AVG("levelPercent")::float8 AS value
		FROM "FeedLevelLog"
		WHERE "deviceId" IN (${Prisma.join(deviceIds)})
		  AND "recordedAt" >= ${start} AND "recordedAt" < ${end}
		GROUP BY 1
		ORDER BY 1
	`;

	return toPoints(rows);
}

/**
 * Average body weight (g) per sampling batch, bucketed per local day.
 *
 * One line per `batchLabel` (samples without a label share one line) so the
 * batches stay distinguishable. The whole sample history is charted because a
 * pond samples at most a few times a month; the database does the averaging.
 */
export async function getBiomassTrend(pondId: string): Promise<MultiSeries> {
	const rows = await prisma.$queryRaw<BiomassBucketQueryRow[]>`
		SELECT to_char(date_trunc('day', "recordedAt" AT TIME ZONE 'UTC' AT TIME ZONE ${PH_TZ}::text), 'YYYY-MM-DD') AS day,
		       COALESCE(NULLIF(btrim("batchLabel"), ''), ${UNLABELED_BATCH}) AS batch,
		       AVG("avgWeightKg")::float8 * 1000 AS grams
		FROM "BiomassLog"
		WHERE "pondId" = ${pondId}
		GROUP BY 1, 2
		ORDER BY 1, 2
	`;

	const points: MultiSeriesPoint[] = rows.map((row) => ({
		label: row.day,
		series: row.batch,
		value: round1(row.grams),
	}));
	const keys = [...new Set(points.map((point) => point.label))].sort();
	return buildMultiSeries(points, keys);
}

/**
 * Water temperature from `WaterTempLog`: hourly buckets for the last 24 hours,
 * daily buckets for the last week. Readings are throttled to one per 5 minutes
 * at ingest, so the hourly average keeps a 24 h window readable.
 */
export async function getWaterTempSeries(
	deviceIds: ReadonlyArray<string>,
	range: WaterTempRange,
	now = new Date(),
): Promise<ChartPoint[]> {
	if (deviceIds.length === 0) return [];
	const { start, end, bucket } = resolveWaterTempWindow(range, now);

	if (bucket === "hour") {
		const rows = await prisma.$queryRaw<BucketRow[]>`
			SELECT to_char(date_trunc('hour', "recordedAt" AT TIME ZONE 'UTC' AT TIME ZONE ${PH_TZ}::text), 'YYYY-MM-DD HH24') || ':00' AS bucket,
			       AVG("tempC")::float8 AS value
			FROM "WaterTempLog"
			WHERE "deviceId" IN (${Prisma.join(deviceIds)})
			  AND "recordedAt" >= ${start} AND "recordedAt" < ${end}
			GROUP BY 1
			ORDER BY 1
		`;
		return toPoints(rows);
	}

	const rows = await prisma.$queryRaw<BucketRow[]>`
		SELECT to_char(date_trunc('day', "recordedAt" AT TIME ZONE 'UTC' AT TIME ZONE ${PH_TZ}::text), 'YYYY-MM-DD') AS bucket,
		       AVG("tempC")::float8 AS value
		FROM "WaterTempLog"
		WHERE "deviceId" IN (${Prisma.join(deviceIds)})
		  AND "recordedAt" >= ${start} AND "recordedAt" < ${end}
		GROUP BY 1
		ORDER BY 1
	`;
	return toPoints(rows);
}
