import { formatChartNumber, summarize } from "@/components/charts/chart-data";
import type { ChartLabels } from "@/components/charts/chart-frame";
import { ChartRangeControl, type ChartRangeKey } from "@/components/charts/chart-range";
import { CHART_COLORS } from "@/components/charts/chart-theme";
import { LazyDonut, LazyLineTrend, LazyStackedBars } from "@/components/charts/lazy";
import { ConnectivityPanel } from "@/components/superadmin/connectivity-panel";
import { CommandCenterCharts } from "@/components/superadmin/monitor/sections/command-center-charts";
import {
	type CommandCenterKpi,
	CommandCenterLayout,
} from "@/components/superadmin/monitor/sections/command-center-layout";
import { CommandCenterRangeFrame } from "@/components/superadmin/monitor/sections/command-center-range";
import { StatusBands } from "@/components/superadmin/status-bands";
import { Badge, Card, SECONDARY_BUTTON, SectionTitle } from "@/components/superadmin/ui";
import { Link } from "@/i18n/routing";
import { requirePlatformAdmin } from "@/lib/auth/require-platform-admin";
import { formatDateTimeLocal } from "@/lib/date-local";
import { getPlatformAnalytics, parseAnalyticsRange } from "@/lib/platform/analytics";
import { rangeAnchor, recentActivity } from "@/lib/platform/command-center-series";
import { getFeedBreakdown, getFeedHeatmap } from "@/lib/platform/feed-analytics";
import { getFleetMonitor } from "@/lib/platform/fleet-health";
import { summarizeTelemetryFreshness, worstDevices } from "@/lib/platform/fleet-health-rules";
import { getGrowthSeries } from "@/lib/platform/growth";
import { getStatusBands } from "@/lib/platform/status-bands";
import {
	Activity,
	BellRing,
	ClipboardCheck,
	Droplets,
	FolderTree,
	Gauge,
	Radio,
	Users,
	Wheat,
} from "lucide-react";
import { getLocale, getTranslations } from "next-intl/server";
import type { ReactNode } from "react";

type Direction = "up" | "down" | "flat";

function first(param: string | string[] | undefined): string | undefined {
	return Array.isArray(param) ? param[0] : param;
}

function capitalise(value: string): string {
	return value.charAt(0).toUpperCase() + value.slice(1);
}

function flip(direction: Direction): Direction {
	if (direction === "up") return "down";
	if (direction === "down") return "up";
	return "flat";
}

/** `redirect()`/`notFound()` throw a `NEXT_*` digest; it must never be swallowed. */
function isControlFlow(error: unknown): boolean {
	const digest = (error as { digest?: unknown } | null)?.digest;
	return typeof digest === "string" && digest.startsWith("NEXT_");
}

/**
 * One section's read model, or `null` when *that* read failed.
 *
 * A failing chart section must not take the whole console down, and it must not
 * render as a quiet zero either: `null` reaches the chart as its explicit error
 * state. A control-flow throw (an auth redirect raised inside the read model)
 * is re-thrown so a session that ended mid-render still lands on the login
 * screen instead of a page of "could not load" panels.
 */
function settledValue<T>(result: PromiseSettledResult<T>): T | null {
	if (result.status === "fulfilled") return result.value;
	if (isControlFlow(result.reason)) throw result.reason;
	console.error("[superadmin] command-center read failed", result.reason);
	return null;
}

export default async function SuperadminOverviewPage({
	searchParams,
}: {
	searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
	const params = await searchParams;
	const range = parseAnalyticsRange(first(params.range));
	const rangeKey = `${range}d` as Exclude<ChartRangeKey, "custom">;

	// The layout also gates this page; keep the explicit check so the data
	// module can never be rendered by a future route that forgets the layout.
	await requirePlatformAdmin();

	const [
		analytics,
		statusBands,
		optional,
		t,
		tCharts,
		tBands,
		tConnectivity,
		tCommon,
		tDates,
		tFleet,
		locale,
	] = await Promise.all([
		getPlatformAnalytics(range),
		getStatusBands(),
		// Sections C–G (#707). Each read is isolated: one failing source turns
		// into one explicit "could not load" chart, never a silent zero series.
		Promise.allSettled([
			getGrowthSeries(range),
			getFeedBreakdown(range),
			getFeedHeatmap(range),
			getFleetMonitor(),
		]),
		getTranslations("superadmin.overview"),
		getTranslations("superadmin.overview.charts"),
		getTranslations("superadmin.statusBands"),
		getTranslations("superadmin.connectivity"),
		getTranslations("superadmin.common"),
		getTranslations("dates"),
		getTranslations("superadmin.fleet"),
		getLocale(),
	]);

	const growth = settledValue(optional[0]);
	const feed = settledValue(optional[1]);
	const heatmap = settledValue(optional[2]);
	const fleet = settledValue(optional[3]);
	// A fleet source that did not report is an error, not an empty fleet: the
	// monitor says so itself instead of returning zeroed rows.
	const fleetDevices = fleet && !fleet.sourceError ? worstDevices(fleet.rows) : null;
	const freshness = fleetDevices ? summarizeTelemetryFreshness(fleetDevices) : null;

	const formatValue = (value: number, decimals = 0) =>
		new Intl.NumberFormat(locale, { maximumFractionDigits: decimals }).format(value);

	const chartLabels: ChartLabels = {
		period: t("charts.period"),
		value: t("charts.value"),
		name: t("charts.name"),
		empty: t("charts.empty"),
		event: t("charts.event"),
		detail: t("charts.detail"),
	};

	const signupStats = summarize(analytics.signupsPerDay);
	const kgStats = summarize(analytics.kgPerDay);
	const feedsTotal = Object.values(analytics.feedsPerDayBySource.totalsBySource).reduce(
		(total, value) => total + value,
		0,
	);
	const online = analytics.kpis.feedersOnline.online;
	const offline = Math.max(0, analytics.kpis.feedersOnline.total - online);
	const alertsTotal = analytics.alertsByType.reduce((total, row) => total + row.count, 0);

	const sourceLabels = Object.fromEntries(
		analytics.feedsPerDayBySource.sources.map((source) => [
			source,
			t.has(`sources.${source}`) ? t(`sources.${source}`) : source,
		]),
	);

	const alertLabel = (type: string) =>
		t.has(`alertTypes.${type}`) ? t(`alertTypes.${type}`) : type;

	// Fault codes are shared with the fleet monitor, so their words live there.
	const faultLabel = (fault: string) =>
		tFleet.has(`faults.${fault}`) ? tFleet(`faults.${fault}`) : fault;

	const trendText = (direction: Direction, pct: number | null) => {
		if (pct === null) return direction === "up" ? t("trend.new") : t("trend.none");
		return t("trend.change", { value: Math.abs(pct) });
	};

	const trendLabel = (direction: Direction, pct: number | null, points = false) => {
		if (pct === null) return direction === "up" ? t("trend.new") : t("trend.none");
		const key = points ? `points${capitalise(direction)}` : direction;
		return t(`trend.${key}`, { value: Math.abs(pct) });
	};

	// The pill carries the short delta and the full sentence stays in the
	// accessible name, so "25% up on the previous period" is still announced.
	const deltaFor = (
		kpi: { direction: Direction; deltaPct: number | null },
		invert = false,
		points = false,
	): NonNullable<CommandCenterKpi["delta"]> => ({
		value: trendText(kpi.direction, kpi.deltaPct),
		direction: invert ? flip(kpi.direction) : kpi.direction,
		label: trendLabel(kpi.direction, kpi.deltaPct, points),
	});

	// A KPI sparkline is the same registration series the growth chart plots,
	// so the tile and the chart can never tell different stories.
	const registrationSparkline = (
		points: { label: string; value: number }[],
		label: string,
	): Pick<CommandCenterKpi, "series" | "sparklineLabel"> => {
		if (points.length === 0) return {};
		const stats = summarize(points);
		return {
			series: points.map((point) => point.value),
			sparklineLabel: t("charts.sparklineRegistrations", {
				label,
				points: stats.points,
				total: stats.total,
			}),
		};
	};

	const activity = recentActivity({
		failedJobs: analytics.failedJobs,
		pendingDevices: analytics.pendingApprovalDevices,
	});

	const kpis: CommandCenterKpi[] = [
		{
			label: t("users"),
			value: formatValue(analytics.kpis.users.total),
			hint: t("newInRange", { count: analytics.kpis.users.newInRange }),
			icon: Users,
			delta: deltaFor(analytics.kpis.users),
			series: analytics.signupsPerDay.map((point) => point.value),
			sparklineLabel: t("charts.sparklineSummary", {
				points: signupStats.points,
				total: signupStats.total,
			}),
		},
		{
			label: t("organizations"),
			value: formatValue(analytics.kpis.organizations.total),
			hint: t("newInRange", { count: analytics.kpis.organizations.newInRange }),
			icon: FolderTree,
			delta: deltaFor(analytics.kpis.organizations),
			...registrationSparkline(growth?.series.organizations ?? [], tCharts("seriesOrganizations")),
		},
		{
			label: t("ponds"),
			value: formatValue(analytics.kpis.ponds.total),
			hint: t("newInRange", { count: analytics.kpis.ponds.newInRange }),
			icon: Droplets,
			delta: deltaFor(analytics.kpis.ponds),
			...registrationSparkline(growth?.series.ponds ?? [], tCharts("seriesPonds")),
		},
		{
			label: t("feedersOnline"),
			value: `${formatValue(analytics.kpis.feedersOnline.pct, 1)}%`,
			hint: t("feedersOnlineHint", {
				online,
				total: analytics.kpis.feedersOnline.total,
			}),
			icon: Radio,
			delta: deltaFor(analytics.kpis.feedersOnline, false, true),
		},
		{
			label: t("feeds"),
			value: formatValue(analytics.kpis.feeds.total),
			hint: t("feedsHint"),
			icon: Wheat,
			delta: deltaFor(analytics.kpis.feeds),
		},
		{
			label: t("kgDispensed"),
			value: `${formatValue(analytics.kpis.kgDispensed.total, 2)} ${t("charts.kgUnit")}`,
			hint: t("kgDispensedHint"),
			icon: Gauge,
			delta: deltaFor(analytics.kpis.kgDispensed),
		},
		{
			label: t("openAlerts"),
			value: formatValue(analytics.kpis.openAlerts.total),
			hint: t("openAlertsHint"),
			icon: BellRing,
			delta: deltaFor(analytics.kpis.openAlerts, true),
		},
		{
			label: t("pendingApprovals"),
			value: formatValue(analytics.kpis.pendingApprovals.total),
			hint: t("pendingApprovalsHint"),
			icon: ClipboardCheck,
			delta: deltaFor(analytics.kpis.pendingApprovals, true),
		},
	];

	// #707: the shared control replaced the three preset links. A preset now
	// re-runs the server reads (the frame writes `?range=`), and a custom window
	// narrows the widest loaded window without a round trip.
	const rangeSwitcher = (
		<div className="flex flex-col items-end gap-1">
			<ChartRangeControl
				labels={{
					label: t("rangeLabel"),
					sevenDays: t("range7"),
					thirtyDays: t("range30"),
					ninetyDays: t("range90"),
					custom: t("charts.rangeCustom"),
					from: t("charts.rangeFrom"),
					to: t("charts.rangeTo"),
				}}
			/>
			<p className="max-w-xs text-right text-[10px] leading-snug font-bold text-[#3D5568] dark:text-slate-400">
				{t("rangeHint")}
			</p>
		</div>
	);

	const AttentionCard = ({
		title,
		action,
		empty,
		children,
	}: {
		title: string;
		action?: ReactNode;
		empty: boolean;
		children: ReactNode;
	}) => (
		<Card className="flex h-full flex-col">
			<SectionTitle title={title} actions={action} />
			{empty ? (
				<p className="px-5 py-6 text-sm text-[#3D5568] dark:text-slate-400">{children}</p>
			) : (
				<ul className="divide-y divide-gray-100 dark:divide-[#24304A]">{children}</ul>
			)}
		</Card>
	);

	return (
		<CommandCenterRangeFrame initialKey={rangeKey} anchor={rangeAnchor(analytics.dayKeys)}>
			<CommandCenterLayout
				title={t("title")}
				description={t("description", { days: range })}
				rangeSwitcher={rangeSwitcher}
				bands={
					<StatusBands
						bands={statusBands.bands}
						checkedAtLabel={tBands("checkedAt", {
							time: formatDateTimeLocal(statusBands.checkedAt, tDates).full,
						})}
						t={tBands}
					/>
				}
				kpis={kpis}
				trendNode={
					<LazyLineTrend
						title={t("charts.signupsTitle")}
						summary={t("charts.signupsSummary", {
							points: signupStats.points,
							total: signupStats.total,
							peak: signupStats.peak?.value ?? 0,
							peakLabel: signupStats.peak?.label ?? t("trend.none"),
						})}
						labels={chartLabels}
						points={analytics.signupsPerDay}
						color={CHART_COLORS.orange}
						temporal
					/>
				}
				mix={{
					title: t("charts.fleetTitle"),
					description: t("charts.fleetSummary", {
						online,
						offline,
						total: analytics.kpis.feedersOnline.total,
					}),
					items: [
						{ key: "online", label: tCommon("online"), value: online, tone: "ok" },
						{ key: "offline", label: tCommon("offline"), value: offline, tone: "danger" },
					],
					totalLabel: t("feedersOnlineHint", {
						online,
						total: analytics.kpis.feedersOnline.total,
					}),
				}}
				charts={
					<div className="space-y-8">
						<section
							aria-label={t("charts.feedsTitle")}
							className="grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-3"
						>
							<LazyStackedBars
								className="xl:col-span-2"
								title={t("charts.feedsTitle")}
								summary={t("charts.feedsSummary", {
									points: analytics.dayKeys.length,
									total: feedsTotal,
								})}
								labels={chartLabels}
								stack={analytics.feedsPerDayBySource}
								seriesLabels={sourceLabels}
								temporal
							/>
							<LazyDonut
								title={t("charts.alertsTitle")}
								summary={t("charts.alertsSummary", {
									total: alertsTotal,
									types: analytics.alertsByType.length,
								})}
								labels={chartLabels}
								segments={analytics.alertsByType.map((row) => ({
									name: alertLabel(row.type),
									value: row.count,
								}))}
							/>
							<LazyLineTrend
								className="xl:col-span-3"
								title={t("charts.kgTitle")}
								summary={t("charts.kgSummary", {
									points: kgStats.points,
									total: formatChartNumber(kgStats.total),
									peak: kgStats.peak?.value ?? 0,
									peakLabel: kgStats.peak?.label ?? t("trend.none"),
								})}
								labels={chartLabels}
								points={analytics.kgPerDay}
								unit={t("charts.kgUnit")}
								decimals={2}
								color={CHART_COLORS.green}
								temporal
							/>
						</section>

						<CommandCenterCharts
							growth={growth}
							feed={feed}
							heatmap={heatmap}
							freshness={freshness}
							fleetDevices={fleetDevices}
							faultLabel={faultLabel}
							activity={activity}
							t={tCharts}
							labels={chartLabels}
						/>
					</div>
				}
				footer={
					<div className="space-y-6">
						<ConnectivityPanel data={analytics.connectivity} t={tConnectivity} locale={locale} />

						<section aria-label={t("needsAttention")} className="space-y-3">
							<div className="flex items-center gap-2">
								<Activity
									className="h-4 w-4 text-[#E85A2A] dark:text-[#FF8A5C]"
									aria-hidden="true"
								/>
								<h2 className="text-lg font-black text-[#0A3D62] dark:text-slate-100">
									{t("needsAttention")}
								</h2>
							</div>

							<div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
								<AttentionCard
									title={t("offlineFeeders")}
									empty={analytics.mostOfflineFeeders.length === 0}
									action={
										<Link href="/superadmin/devices" className={SECONDARY_BUTTON}>
											{t("viewDevices")}
										</Link>
									}
								>
									{analytics.mostOfflineFeeders.length === 0
										? t("offlineFeedersEmpty")
										: analytics.mostOfflineFeeders.map((device) => (
												<li key={device.id} className="px-5 py-3">
													<div className="flex items-start justify-between gap-2">
														<div className="min-w-0">
															<p className="truncate text-sm font-bold text-[#0A3D62] dark:text-slate-100">
																{device.label}
															</p>
															<p className="truncate text-[11px] text-[#3D5568] dark:text-slate-400">
																{device.pondName ?? t("noPond")} · {device.mac}
															</p>
														</div>
														<Badge tone="danger">{tCommon("offline")}</Badge>
													</div>
													<p className="mt-1 text-[10px] font-bold text-[#3D5568] dark:text-slate-400">
														{device.lastSeenAt
															? t("lastSeen", {
																	date: formatDateTimeLocal(device.lastSeenAt, tDates).full,
																})
															: t("neverSeen")}
													</p>
												</li>
											))}
								</AttentionCard>

								<AttentionCard
									title={t("pendingDevices")}
									empty={analytics.pendingApprovalDevices.length === 0}
									action={
										<Link href="/superadmin/devices" className={SECONDARY_BUTTON}>
											{t("viewDevices")}
										</Link>
									}
								>
									{analytics.pendingApprovalDevices.length === 0
										? t("pendingDevicesEmpty")
										: analytics.pendingApprovalDevices.map((device) => (
												<li key={device.id} className="px-5 py-3">
													<p className="truncate text-sm font-bold text-[#0A3D62] dark:text-slate-100">
														{device.label}
													</p>
													<p className="truncate text-[11px] text-[#3D5568] dark:text-slate-400">
														{device.mac}
													</p>
													<p className="mt-1 text-[10px] font-bold text-[#3D5568] dark:text-slate-400">
														{t("requested", {
															date: formatDateTimeLocal(device.createdAt, tDates).full,
														})}
													</p>
												</li>
											))}
								</AttentionCard>

								<AttentionCard title={t("failedJobs")} empty={analytics.failedJobs.length === 0}>
									{analytics.failedJobs.length === 0
										? t("failedJobsEmpty")
										: analytics.failedJobs.map((job) => (
												<li key={job.id} className="px-5 py-3">
													<p className="truncate text-sm font-bold text-[#0A3D62] dark:text-slate-100">
														{job.type}
													</p>
													{job.error && (
														<p className="line-clamp-2 text-[11px] text-[#C42B3A] dark:text-red-300">
															{job.error}
														</p>
													)}
													<p className="mt-1 text-[10px] font-bold text-[#3D5568] dark:text-slate-400">
														{formatDateTimeLocal(job.at, tDates).full}
													</p>
												</li>
											))}
								</AttentionCard>

								<AttentionCard
									title={t("topFcr")}
									empty={analytics.topFcrPonds.length === 0}
									action={
										<Link href="/superadmin/ponds" className={SECONDARY_BUTTON}>
											{t("ponds")}
										</Link>
									}
								>
									{analytics.topFcrPonds.length === 0
										? t("topFcrEmpty")
										: analytics.topFcrPonds.map((report) => (
												<li key={report.pondId} className="px-5 py-3">
													<p className="truncate text-sm font-bold text-[#0A3D62] dark:text-slate-100">
														{report.pondName}
													</p>
													<p className="text-[11px] text-[#3D5568] dark:text-slate-400">
														{t("fcrValue", { value: report.fcrValue.toFixed(2) })}
													</p>
													<p className="mt-1 text-[10px] font-bold text-[#3D5568] dark:text-slate-400">
														{t("periodEnding", {
															date: formatDateTimeLocal(report.periodEnd, tDates).date,
														})}
													</p>
												</li>
											))}
								</AttentionCard>
							</div>
						</section>
					</div>
				}
			/>
		</CommandCenterRangeFrame>
	);
}
