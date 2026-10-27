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
 * Buckets use `ts AT TIME ZONE '<zone>'` (a naive local timestamp) and then
 * `date_trunc`, which is independent of the connection's session timezone.
 * Do not chain a second `AT TIME ZONE`: that yields a `timestamptz` which
 * `date_trunc` truncates in the session timezone, shifting the first hours of
 * each local day into the previous bucket.
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

/**
 * Feed dispensed per local day for the last 30 days, split by source
 * (scheduled / dashboard / button) in grams.
 *
 * Days without a dispense are zero-filled from the same key list the x-axis
 * uses, so a quiet day is visible. No dispense at all collapses to an empty
 * stack so the chart can show its empty state instead of a bare axis.
 */
export async function getFeedPerDayBySource(
	deviceIds: ReadonlyArray<string>,
	now = new Date(),
): Promise<{ dayKeys: string[]; stack: StackedSeries }> {
	const { start, end, dayKeys } = resolveDayWindow(FEED_CHART_DAYS, now);
	const empty: StackedSeries = { sources: [], rows: [], totalsBySource: {} };

	if (deviceIds.length === 0) return { dayKeys, stack: empty };

	const rows = await prisma.$queryRaw<FeedBucketQueryRow[]>`
		SELECT to_char(date_trunc('day', "receivedAt" AT TIME ZONE ${PH_TZ}::text), 'YYYY-MM-DD') AS day,
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

	if (stack.sources.length === 0) return { dayKeys, stack: empty };
	return { dayKeys, stack };
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
		SELECT to_char(date_trunc('day', "recordedAt" AT TIME ZONE ${PH_TZ}::text), 'YYYY-MM-DD') AS bucket,
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
		SELECT to_char(date_trunc('day', "recordedAt" AT TIME ZONE ${PH_TZ}::text), 'YYYY-MM-DD') AS day,
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
			SELECT to_char(date_trunc('hour', "recordedAt" AT TIME ZONE ${PH_TZ}::text), 'YYYY-MM-DD HH24') || ':00' AS bucket,
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
		SELECT to_char(date_trunc('day', "recordedAt" AT TIME ZONE ${PH_TZ}::text), 'YYYY-MM-DD') AS bucket,
		       AVG("tempC")::float8 AS value
		FROM "WaterTempLog"
		WHERE "deviceId" IN (${Prisma.join(deviceIds)})
		  AND "recordedAt" >= ${start} AND "recordedAt" < ${end}
		GROUP BY 1
		ORDER BY 1
	`;
	return toPoints(rows);
}
