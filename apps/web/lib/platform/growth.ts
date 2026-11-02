import { buildDayKeys, fillDailySeries } from "@/components/charts/chart-data";
import { requirePlatformAdmin } from "@/lib/auth/require-platform-admin";
import { PH_TZ } from "@/lib/constants";
import {
	type AnalyticsRange,
	type AnalyticsWindow,
	DEFAULT_ANALYTICS_RANGE,
	resolveAnalyticsWindow,
} from "@/lib/platform/analytics";
import prisma from "@/lib/prisma";

/**
 * Registration growth for the platform console (epic #627, section G).
 *
 * One bounded `UNION ALL` over the four registry tables, grouped by the same
 * Asia/Manila day keys the overview already uses. The existing analytics loader
 * carries user signups; this adds organizations, ponds and devices so the three
 * missing growth series share one query instead of three page-level reads.
 *
 * Every count is a registration (`createdAt` inside the selected window), not a
 * current total; the current totals live on `getPlatformAnalytics().kpis`.
 */

export const GROWTH_SERIES_KEYS = ["users", "organizations", "ponds", "devices"] as const;
export type GrowthSeriesKey = (typeof GROWTH_SERIES_KEYS)[number];

export interface GrowthPoint {
	label: string;
	value: number;
}

export interface GrowthSeries {
	range: AnalyticsRange;
	window: AnalyticsWindow;
	/** Local day keys, oldest first, shared by all four series. */
	dayKeys: string[];
	series: Record<GrowthSeriesKey, GrowthPoint[]>;
	totals: Record<GrowthSeriesKey, number>;
}

interface GrowthQueryRow {
	series: string;
	day: string;
	total: number;
}

function emptySeries(): Record<GrowthSeriesKey, GrowthPoint[]> {
	return { users: [], organizations: [], ponds: [], devices: [] };
}

function emptyTotals(): Record<GrowthSeriesKey, number> {
	return { users: 0, organizations: 0, ponds: 0, devices: 0 };
}

function isGrowthKey(value: string): value is GrowthSeriesKey {
	return (GROWTH_SERIES_KEYS as readonly string[]).includes(value);
}

export async function getGrowthSeries(
	range: AnalyticsRange = DEFAULT_ANALYTICS_RANGE,
	now = new Date(),
): Promise<GrowthSeries> {
	await requirePlatformAdmin();

	const window = resolveAnalyticsWindow(range, now);
	const rows = await prisma.$queryRaw<GrowthQueryRow[]>`
		WITH registrations AS (
			SELECT 'users' AS series, "createdAt"
			FROM "User"
			WHERE "createdAt" >= ${window.start} AND "createdAt" < ${window.end}
			UNION ALL
			SELECT 'organizations', "createdAt"
			FROM "Organization"
			WHERE "createdAt" >= ${window.start} AND "createdAt" < ${window.end}
			UNION ALL
			SELECT 'ponds', "createdAt"
			FROM "Pond"
			WHERE "createdAt" >= ${window.start} AND "createdAt" < ${window.end}
			UNION ALL
			SELECT 'devices', "createdAt"
			FROM "EnergyDevice"
			WHERE "createdAt" >= ${window.start} AND "createdAt" < ${window.end}
		)
		SELECT series,
		       to_char(
		           date_trunc('day', "createdAt" AT TIME ZONE 'UTC' AT TIME ZONE ${PH_TZ}::text),
		           'YYYY-MM-DD'
		       ) AS day,
		       COUNT(*)::int AS total
		FROM registrations
		GROUP BY 1, 2
		ORDER BY 1, 2
	`;

	const dayKeys = buildDayKeys(window.start, window.end, PH_TZ).slice(-range);
	const points = new Map<GrowthSeriesKey, { label: string; value: number }[]>();
	for (const key of GROWTH_SERIES_KEYS) points.set(key, []);

	for (const row of rows) {
		if (!isGrowthKey(row.series)) continue;
		points.get(row.series)?.push({ label: row.day, value: row.total });
	}

	const series = emptySeries();
	const totals = emptyTotals();
	for (const key of GROWTH_SERIES_KEYS) {
		series[key] = fillDailySeries(points.get(key) ?? [], dayKeys);
		totals[key] = series[key].reduce((sum, point) => sum + point.value, 0);
	}

	return { range, window, dayKeys, series, totals };
}
