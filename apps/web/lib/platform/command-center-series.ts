import type { StackedSeries } from "@/components/charts/chart-data";
import type { HeatmapRow } from "@/components/charts/heatmap";
import type { TreemapDatum } from "@/components/charts/treemap";
import type { FailedJobRow, PendingApprovalRow } from "@/lib/platform/analytics";
import type { PlatformFeedBreakdown, PlatformFeedHeatmap } from "@/lib/platform/feed-analytics";
import type { GrowthSeries, GrowthSeriesKey } from "@/lib/platform/growth";

/**
 * Shaping between the platform read models and the chart layer (#707).
 *
 * These are pure functions: they take a read model that already came out of
 * `lib/platform/**` and produce exactly the props a chart primitive expects.
 * Keeping them here (rather than in the page) means the mapping is unit
 * testable and the page cannot quietly invent a value the query never returned.
 *
 * Nothing here zero-fills a series that has no data: `getGrowthSeries` already
 * returns one point per local day, so a quiet day is a real zero from the
 * query. The helpers only *align* what the database returned.
 */

/** Hours in the day/hour grid; the heatmap primitive assumes 24, index 0 = midnight. */
const HOURS_PER_DAY = 24;

/**
 * Growth series that share one stacked axis.
 *
 * Users are deliberately excluded: they outnumber organizations, ponds and
 * devices by orders of magnitude, so stacking them would flatten the three
 * registration curves this section exists to show. The user trend keeps its own
 * line on the command center.
 */
export const GROWTH_STACK_KEYS = ["organizations", "ponds", "devices"] as const;

/**
 * One row per day key, one column per growth series.
 *
 * `getGrowthSeries` fills every day, so the row count and the point count are
 * the same; a missing point is treated as 0 rather than shifting the days that
 * follow it into the wrong column.
 */
export function growthStack(
	growth: GrowthSeries,
	keys: readonly GrowthSeriesKey[] = GROWTH_STACK_KEYS,
): StackedSeries {
	const sources = [...keys];
	const rows = growth.dayKeys.map((label, index) => {
		const row: { label: string } & Record<string, number | string> = { label };
		for (const key of sources) {
			const point = growth.series[key]?.[index];
			row[key] = Number.isFinite(point?.value) ? (point?.value as number) : 0;
		}
		return row;
	});

	const totalsBySource: Record<string, number> = {};
	for (const key of sources) {
		totalsBySource[key] = rows.reduce((total, row) => total + Number(row[key] ?? 0), 0);
	}

	return { sources, rows, totalsBySource };
}

/** The `key` an organization slice and its pond slices share. */
function orgKey(orgId: string | null): string {
	return orgId ?? "__unattributed__";
}

/**
 * Organization → pond hierarchy for the treemap, sized by consumed mass.
 *
 * A parent's value is the sum of its children when it has any: Recharts lays
 * the children out inside the parent rectangle, so a parent total that did not
 * match would either overflow the tile or leave a hole. Ponds whose
 * organization could not be resolved stay under the explicit `Unattributed`
 * slice the query already returned.
 */
export function feedTreemap(breakdown: PlatformFeedBreakdown): TreemapDatum[] {
	const pondsByOrg = new Map<string, TreemapDatum["children"]>();
	for (const pond of breakdown.byPond) {
		const key = orgKey(pond.orgId);
		const bucket = pondsByOrg.get(key) ?? [];
		bucket.push({ name: pond.label, value: pond.kg });
		pondsByOrg.set(key, bucket);
	}

	return breakdown.byOrg.map((org) => {
		const children = pondsByOrg.get(orgKey(org.orgId)) ?? [];
		const value = children.length
			? children.reduce((total, child) => total + child.value, 0)
			: org.kg;
		return { name: org.label, value: Math.round(value * 100) / 100, children };
	});
}

/**
 * Day × hour rows for the heatmap.
 *
 * The query is sparse by design — an hour with no dispense has no row — so the
 * grid is built from the returned `dayKeys` and every absent cell stays 0.
 * Cells outside the day keys are dropped rather than appended: a cell that is
 * not in the window does not belong on an axis labelled with that window.
 */
export function feedHeatmapRows(heatmap: PlatformFeedHeatmap): HeatmapRow[] {
	const byDay = new Map<string, number[]>();
	for (const day of heatmap.dayKeys) {
		byDay.set(day, new Array<number>(HOURS_PER_DAY).fill(0));
	}

	for (const cell of heatmap.cells) {
		const values = byDay.get(cell.day);
		if (!values) continue;
		if (!Number.isInteger(cell.hour) || cell.hour < 0 || cell.hour >= HOURS_PER_DAY) continue;
		if (!Number.isFinite(cell.operations) || cell.operations <= 0) continue;
		values[cell.hour] += cell.operations;
	}

	return [...byDay.entries()].map(([date, values]) => ({ date, values }));
}

/**
 * The instant the shared range is measured from: noon of the newest day key.
 *
 * Buckets are local calendar days (`YYYY-MM-DD`), so an anchor at noon of the
 * last bucket covers exactly the days the server sent. Using the reader's clock
 * instead would drop the newest bucket for a reader whose day has not rolled
 * over yet — the server buckets in Asia/Manila, the browser does not.
 *
 * Returns `undefined` when there is no usable key, which leaves the chart
 * layer's own `new Date()` default in place.
 */
export function rangeAnchor(dayKeys: readonly string[]): Date | undefined {
	const last = dayKeys[dayKeys.length - 1];
	if (!last || !/^\d{4}-\d{2}-\d{2}$/.test(last)) return undefined;
	const [year, month, day] = last.split("-").map(Number);
	const anchor = new Date(year, month - 1, day, 12, 0, 0, 0);
	return Number.isNaN(anchor.getTime()) ? undefined : anchor;
}

/** One operational event the command center can put on its activity rail. */ export type CommandCenterActivity =
	| {
			kind: "failedJob";
			id: string;
			at: Date;
			jobType: string;
			error: string | null;
	  }
	| {
			kind: "pendingDevice";
			id: string;
			at: Date;
			label: string;
			mac: string;
	  };

/**
 * Newest-first operational events from the rows the overview already loaded.
 *
 * Both inputs are real timestamps from `getPlatformAnalytics` — a job's failure
 * time and a device's registration request — so nothing here is manufactured to
 * fill the rail. Rows with an unreadable timestamp are dropped instead of being
 * dated "now".
 */
export function recentActivity(
	input: { failedJobs: readonly FailedJobRow[]; pendingDevices: readonly PendingApprovalRow[] },
	limit = 6,
): CommandCenterActivity[] {
	const events: CommandCenterActivity[] = [
		...input.failedJobs.map((job) => ({
			kind: "failedJob" as const,
			id: `job-${job.id}`,
			at: job.at,
			jobType: job.type,
			error: job.error,
		})),
		...input.pendingDevices.map((device) => ({
			kind: "pendingDevice" as const,
			id: `device-${device.id}`,
			at: device.createdAt,
			label: device.label,
			mac: device.mac,
		})),
	];

	return events
		.filter((event) => Number.isFinite(event.at.getTime()))
		.sort((a, b) => b.at.getTime() - a.at.getTime() || a.id.localeCompare(b.id))
		.slice(0, Math.max(0, limit));
}
