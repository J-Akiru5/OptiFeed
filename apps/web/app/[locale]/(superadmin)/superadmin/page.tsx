import { CHART_COLORS, type ChartLabels, Donut, LineTrend, StackedBars } from "@/components/charts";
import { formatChartNumber, summarize } from "@/components/charts/chart-data";
import {
	type CommandCenterKpi,
	CommandCenterLayout,
} from "@/components/superadmin/monitor/sections/command-center-layout";
import { StatusBands } from "@/components/superadmin/status-bands";
import { Badge, Card, SECONDARY_BUTTON, SectionTitle } from "@/components/superadmin/ui";
import { Link } from "@/i18n/routing";
import { requirePlatformAdmin } from "@/lib/auth/require-platform-admin";
import { formatDateTimeLocal } from "@/lib/date-local";
import {
	ANALYTICS_RANGES,
	getPlatformAnalytics,
	parseAnalyticsRange,
} from "@/lib/platform/analytics";
import { getStatusBands } from "@/lib/platform/status-bands";
import { cn } from "@/lib/utils";
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

export default async function SuperadminOverviewPage({
	searchParams,
}: {
	searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
	const params = await searchParams;
	const range = parseAnalyticsRange(first(params.range));

	// The layout also gates this page; keep the explicit check so the data
	// module can never be rendered by a future route that forgets the layout.
	await requirePlatformAdmin();

	const [analytics, statusBands, t, tBands, tCommon, tDates, locale] = await Promise.all([
		getPlatformAnalytics(range),
		getStatusBands(),
		getTranslations("superadmin.overview"),
		getTranslations("superadmin.statusBands"),
		getTranslations("superadmin.common"),
		getTranslations("dates"),
		getLocale(),
	]);

	const formatValue = (value: number, decimals = 0) =>
		new Intl.NumberFormat(locale, { maximumFractionDigits: decimals }).format(value);

	const chartLabels: ChartLabels = {
		period: t("charts.period"),
		value: t("charts.value"),
		name: t("charts.name"),
		empty: t("charts.empty"),
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
		},
		{
			label: t("ponds"),
			value: formatValue(analytics.kpis.ponds.total),
			hint: t("newInRange", { count: analytics.kpis.ponds.newInRange }),
			icon: Droplets,
			delta: deltaFor(analytics.kpis.ponds),
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

	const rangeSwitcher = (
		<nav aria-label={t("rangeLabel")} className="flex flex-wrap items-center gap-1.5">
			{ANALYTICS_RANGES.map((option) => (
				<Link
					key={option}
					href={`/superadmin?range=${option}`}
					aria-current={option === range ? "page" : undefined}
					className={cn(
						"rounded-xl px-3 py-2 text-xs font-black transition-colors",
						option === range
							? "bg-[#0A3D62] text-white shadow-sm"
							: "border border-[#0A3D62]/20 bg-white text-[#0A3D62] hover:bg-[#F4F7F6] dark:border-[#24304A] dark:bg-[#111A2C] dark:text-slate-100 dark:hover:bg-[#162238]",
					)}
				>
					{t(`range${option}`)}
				</Link>
			))}
		</nav>
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
				<LineTrend
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
				<section
					aria-label={t("charts.feedsTitle")}
					className="grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-3"
				>
					<StackedBars
						className="xl:col-span-2"
						title={t("charts.feedsTitle")}
						summary={t("charts.feedsSummary", {
							points: analytics.dayKeys.length,
							total: feedsTotal,
						})}
						labels={chartLabels}
						stack={analytics.feedsPerDayBySource}
						seriesLabels={sourceLabels}
					/>
					<Donut
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
					<LineTrend
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
					/>
				</section>
			}
			footer={
				<section aria-label={t("needsAttention")} className="space-y-3">
					<div className="flex items-center gap-2">
						<Activity className="h-4 w-4 text-[#E85A2A] dark:text-[#FF8A5C]" aria-hidden="true" />
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
			}
		/>
	);
}
