import type { ChartLabels } from "@/components/charts/chart-frame";
import { Heatmap } from "@/components/charts/heatmap";
import { LazyDonut, LazyRadialGauge, LazyStackedArea, LazyTreemap } from "@/components/charts/lazy";
import { Timeline, type TimelineEvent } from "@/components/charts/timeline";
import {
	type CommandCenterActivity,
	feedHeatmapRows,
	feedTreemap,
	growthStack,
} from "@/lib/platform/command-center-series";
import type { PlatformFeedBreakdown, PlatformFeedHeatmap } from "@/lib/platform/feed-analytics";
import {
	type DeviceTelemetryRow,
	type FleetFaultCount,
	type FleetTelemetryFreshness,
	summarizeFleetFaults,
} from "@/lib/platform/fleet-health-rules";
import type { GrowthSeries } from "@/lib/platform/growth";

/**
 * The command center's chart sections (#707).
 *
 * Sections C–G of epic #627 were built as read models and primitives in #629
 * but nothing rendered them. This file is the wiring: every chart below is fed
 * from a query result the page passes in, and every Recharts-backed chart is
 * imported through `charts/lazy` so the library is not in the route's initial
 * chunk. The heatmap is plain CSS and the timeline is plain DOM, so they are
 * imported directly (see `charts/lazy.tsx`).
 *
 * Presentational and synchronous: no database access, no copy of its own. A
 * read model that failed arrives as `null`, and the chart renders the explicit
 * error state instead of an empty axis. An empty but *successful* read renders
 * the chart's own empty state.
 */

type Translator = (key: string, values?: Record<string, string | number>) => string;

export interface CommandCenterChartsProps {
	/** `getGrowthSeries`; null when the read failed. */
	growth: GrowthSeries | null;
	/** `getFeedBreakdown`; null when the read failed. */
	feed: PlatformFeedBreakdown | null;
	/** `getFeedHeatmap`; null when the read failed. */
	heatmap: PlatformFeedHeatmap | null;
	/** `summarizeTelemetryFreshness(worstDevices(fleet.rows))`; null when the fleet read failed. */
	freshness: FleetTelemetryFreshness | null;
	/** Every unit, worst first (`worstDevices`); null when the fleet read failed. */
	fleetDevices: readonly DeviceTelemetryRow[] | null;
	/** Localized fault names, from `superadmin.fleet.faults`. */
	faultLabel: (fault: FleetFaultCount["fault"]) => string;
	activity: readonly CommandCenterActivity[];
	t: Translator;
	labels: ChartLabels;
}

function sumRow(row: Record<string, number | string>, keys: readonly string[]): number {
	return keys.reduce((total, key) => total + Number(row[key] ?? 0), 0);
}

export function CommandCenterCharts({
	growth,
	feed,
	heatmap,
	freshness,
	fleetDevices,
	faultLabel,
	activity,
	t,
	labels,
}: CommandCenterChartsProps) {
	const loadError = t("loadFailed");

	const stack = growth ? growthStack(growth) : null;
	const growthRows = stack?.rows ?? [];
	const growthTotal = growthRows.reduce(
		(total, row) => total + sumRow(row, stack?.sources ?? []),
		0,
	);
	const growthPeak = growthRows.reduce<{ label: string; value: number } | null>((peak, row) => {
		const value = sumRow(row, stack?.sources ?? []);
		return peak === null || value > peak.value ? { label: String(row.label), value } : peak;
	}, null);

	const feedNodes = feed ? feedTreemap(feed) : [];
	const feedOrgs = feed ? feed.byOrg.length : 0;

	const heatmapRows = heatmap ? feedHeatmapRows(heatmap) : [];
	const heatmapPeak = heatmap?.maxOperations ?? 0;
	const heatmapHours = heatmap ? heatmap.cells.length : 0;

	const faults: FleetFaultCount[] = fleetDevices ? summarizeFleetFaults(fleetDevices) : [];
	const unitsWithFault = fleetDevices
		? fleetDevices.filter((row) => (row.health?.faults.length ?? 0) > 0).length
		: 0;
	const units = freshness?.devices ?? fleetDevices?.length ?? 0;
	const faultSegments = faults.map((entry) => ({
		name: faultLabel(entry.fault),
		value: entry.devices,
	}));
	const faultDetail = faultSegments
		.map((segment) => `${segment.name} (${segment.value})`)
		.join(", ");

	const timelineEvents: TimelineEvent[] = activity.map((event) =>
		event.kind === "failedJob"
			? {
					id: event.id,
					at: event.at,
					title: t("activityJobFailed", { type: event.jobType }),
					detail: event.error ?? undefined,
					tone: "danger" as const,
				}
			: {
					id: event.id,
					at: event.at,
					title: t("activityPendingDevice", { label: event.label }),
					detail: event.mac,
					tone: "warning" as const,
				},
	);

	const toneLabels = {
		info: t("toneInfo"),
		success: t("toneSuccess"),
		warning: t("toneWarning"),
		danger: t("toneDanger"),
	};

	return (
		<>
			<section aria-label={t("sections.growth")} className="space-y-3">
				<h2 className="text-lg font-black text-[#0A3D62] dark:text-slate-100">
					{t("sections.growth")}
				</h2>
				<div className="grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-3">
					<LazyStackedArea
						className="xl:col-span-2"
						title={t("growthTitle")}
						summary={t("growthSummary", {
							total: growthTotal,
							peak: growthPeak?.value ?? 0,
							peakLabel: growthPeak?.label ?? t("trend.none"),
						})}
						labels={labels}
						stack={stack ?? { sources: [], rows: [], totalsBySource: {} }}
						seriesLabels={{
							organizations: t("seriesOrganizations"),
							ponds: t("seriesPonds"),
							devices: t("seriesDevices"),
						}}
						error={growth ? null : loadError}
					/>
					<LazyTreemap
						title={t("feedByOrgTitle")}
						summary={t("feedByOrgSummary", {
							total: feed?.totals.kg ?? 0,
							orgs: feedOrgs,
						})}
						labels={labels}
						nodes={feedNodes}
						unit={t("kgUnit")}
						error={feed ? null : loadError}
					/>
					<Heatmap
						className="xl:col-span-3"
						title={t("heatmapTitle")}
						summary={t("heatmapSummary", { peak: heatmapPeak, hours: heatmapHours })}
						labels={labels}
						rows={heatmapRows}
						unit={t("heatmapUnit")}
						max={heatmapPeak > 0 ? heatmapPeak : undefined}
						legendLabels={{ less: t("heatmapLess"), more: t("heatmapMore") }}
						error={heatmap ? null : loadError}
					/>
				</div>
			</section>

			<section aria-label={t("sections.telemetry")} className="space-y-3">
				<h2 className="text-lg font-black text-[#0A3D62] dark:text-slate-100">
					{t("sections.telemetry")}
				</h2>
				<div className="grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-3">
					<LazyRadialGauge
						title={t("freshnessTitle")}
						summary={t("freshnessSummary", {
							devices: units,
							rssiFresh: freshness?.rssi.fresh ?? 0,
							feedFresh: freshness?.feedLevel.fresh ?? 0,
							tempFresh: freshness?.waterTemp.fresh ?? 0,
						})}
						labels={labels}
						value={freshness?.feedLevel.fresh ?? 0}
						max={units}
						label={t("freshnessLabel")}
						tone={freshnessTone(freshness)}
						error={freshness ? null : loadError}
					/>
					<LazyDonut
						title={t("faultsTitle")}
						summary={
							faultSegments.length > 0
								? t("faultsSummary", {
										devices: unitsWithFault,
										total: units,
										faults: faultDetail,
									})
								: t("faultsNone", { total: units })
						}
						labels={labels}
						segments={faultSegments}
						error={fleetDevices ? null : loadError}
					/>
					<Timeline
						title={t("activityTitle")}
						summary={t("activitySummary", { count: timelineEvents.length })}
						labels={labels}
						events={timelineEvents}
						toneLabels={toneLabels}
					/>
				</div>
			</section>
		</>
	);
}

/** Fresh share of the feed-level reading, as the gauge's tone. */
function freshnessTone(
	freshness: FleetTelemetryFreshness | null,
): "success" | "warning" | "danger" {
	if (!freshness || freshness.devices === 0) return "warning";
	const share = freshness.feedLevel.fresh / freshness.devices;
	if (share >= 0.9) return "success";
	if (share >= 0.6) return "warning";
	return "danger";
}
