import { DataExportButton, DataImportDialog } from "@/components/DataImportExport";
import { FeedEventHistoryTable } from "@/components/FeedEventHistoryTable";
import { type ChartLabels, LineTrend, StackedBars } from "@/components/charts";
import { formatChartNumber } from "@/components/charts/chart-data";
import { DashboardEmptyState, DashboardPageHeader } from "@/components/dashboard/dashboard-ui";
import { FeedLevelDisplay } from "@/components/feed-level-display";
import { SnapshotWriter } from "@/components/pwa/snapshot-writer";
import { Link } from "@/i18n/routing";
import { getFeedEvents } from "@/lib/actions/history";
import { canWrite } from "@/lib/auth/session";
import { FEED_CHART_DAYS, HOPPER_RANGE_DAYS, parseHopperRange } from "@/lib/chart-windows";
import { formatFarmDateTime } from "@/lib/date-local";
import { formatFeedAmount, isDailyTotalSource } from "@/lib/feed-figures";
import { isDeviceOffline } from "@/lib/feed-level-display";
import { FEED_EVENT_SOURCES, feedSourceKey } from "@/lib/feed-sources";
import type { HistorySnapshotData } from "@/lib/offline/snapshots";
import { getFeedPerDayBySource, getFeedTotals, getHopperLevelSeries } from "@/lib/pond-charts";
import { getActivePond } from "@/lib/pond-selection";
import prisma from "@/lib/prisma";
import { getListPageSize } from "@/lib/settings/platform";
import { CalendarDays, CheckCircle2, Clock, Package } from "lucide-react";
import { getTranslations } from "next-intl/server";

export const revalidate = 0;

interface HistoryPageProps {
	searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function first(value: string | string[] | undefined): string | undefined {
	return Array.isArray(value) ? value[0] : value;
}

export default async function HistoryPage({ searchParams }: HistoryPageProps) {
	const t = await getTranslations("dashboard.history");
	const tSch = await getTranslations("dashboard.schedule");
	const tCommon = await getTranslations("dashboard.common");
	const tDates = await getTranslations("dates");
	const params = await searchParams;
	const hopperRange = parseHopperRange(first(params.hopper));
	const pond = await getActivePond();

	if (!pond) {
		return (
			<div className="mx-auto max-w-2xl py-10">
				<DashboardEmptyState
					icon={CalendarDays}
					title={tSch("noPondData")}
					description={tSch("noDeviceDesc")}
				/>
			</div>
		);
	}

	const energyDevices = await prisma.energyDevice.findMany({
		where: { pondId: pond.id },
		orderBy: { createdAt: "asc" },
		select: {
			id: true,
			feedLevelPercent: true,
			feedLevelUpdatedAt: true,
			lastSeenAt: true,
			hopperCapacityG: true,
			gramsPerFeeding: true,
		},
	});

	const energyDevice = energyDevices[0];
	const deviceIds = energyDevices.map((d) => d.id);

	// Chart series are aggregated in PostgreSQL and scoped to the same device
	// ids as the table, so the charts cannot show another pond's history.
	const pageSize = await getListPageSize();
	const [initialPage, feedChart, hopperPoints, feedTotals] = await Promise.all([
		getFeedEvents({
			deviceIds,
			page: 1,
			pageSize,
		}),
		getFeedPerDayBySource(deviceIds),
		getHopperLevelSeries(deviceIds, hopperRange),
		getFeedTotals(deviceIds),
	]);
	const events = initialPage.items;

	// Feed figures (#236). Each card names its own window; none of them sum an
	// arbitrary page of rows. `hand_fed` rows are daily totals, so they are never
	// used as "the last feed" and their count is labelled as daily totals.
	const lastFeed = feedTotals.lastMachineFeed;
	const lastFeedAmount = formatFeedAmount(lastFeed?.grams ?? null);
	const todayAmount = formatFeedAmount(feedTotals.todayGrams);
	const weekAmount = formatFeedAmount(feedTotals.last7DaysGrams);
	const weekAverageAmount = formatFeedAmount(feedTotals.last7DaysDailyAverageG);
	const lastFeedTime = lastFeed ? formatFarmDateTime(lastFeed.receivedAt, tDates) : null;

	const sourceLabel = (s: string) => {
		return t(`source_${feedSourceKey(s)}`);
	};

	const chartLabels: ChartLabels = {
		period: tCommon("charts.period"),
		value: tCommon("charts.value"),
		name: tCommon("charts.name"),
		empty: tCommon("charts.empty"),
	};
	const sourceSeriesLabels = Object.fromEntries(
		feedChart.stack.sources.map((source) => [source, sourceLabel(source)]),
	);
	const feedChartTotal = Object.values(feedChart.stack.totalsBySource).reduce(
		(sum, value) => sum + value,
		0,
	);
	const hopperLatest = hopperPoints.at(-1)?.value ?? null;

	const writeAccess = await canWrite();
	const feedLevelOffline = isDeviceOffline(energyDevice?.lastSeenAt ?? null);

	const historySnapshot: HistorySnapshotData = {
		pondName: pond.name,
		todayDispensedG: feedTotals.todayGrams,
		feedLevelPercent: energyDevice?.feedLevelPercent ?? null,
		feedLevelUpdatedAt: energyDevice?.feedLevelUpdatedAt?.toISOString() ?? null,
		events: events.slice(0, 20).map((event) => ({
			at: event.receivedAt.toISOString(),
			grams: event.grams,
			source: event.source,
		})),
	};

	return (
		<div className="space-y-8 pb-20 animate-in fade-in duration-150">
			<SnapshotWriter
				page="history"
				scope={pond.ownerId}
				pondId={pond.id}
				pondName={pond.name}
				data={historySnapshot}
			/>
			<DashboardPageHeader
				icon={CalendarDays}
				title={t("title")}
				description={t("desc", { pond: pond.name })}
				actions={
					<>
						<DataImportDialog canWrite={writeAccess} />
						<DataExportButton />
					</>
				}
			/>

			<h2 className="sr-only">{t("statsLabel")}</h2>
			<div className="grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-4">
				<div className="bg-white dark:bg-gray-900 rounded-3xl p-6 shadow-sm border border-gray-100 dark:border-gray-700/50 flex items-start gap-4">
					<div className="h-14 w-14 shrink-0 rounded-2xl bg-green-50 text-green-600 flex items-center justify-center">
						<CheckCircle2 aria-hidden="true" className="h-7 w-7" />
					</div>
					<div className="min-w-0">
						<p className="text-sm font-semibold text-gray-600 uppercase tracking-wider dark:text-gray-400">
							{t("lastFeedLabel")}
						</p>
						<p className="text-2xl font-extrabold text-[var(--ofd-base-deep)]">
							{lastFeed ? lastFeedAmount.value : "—"}
							{lastFeed && (
								<span className="text-base text-gray-500 font-medium"> {lastFeedAmount.unit}</span>
							)}
						</p>
						<p className="text-xs text-gray-500 mt-0.5 dark:text-gray-400">
							{lastFeed && lastFeedTime
								? t("lastFeedDetail", {
										source: sourceLabel(lastFeed.source),
										date: lastFeedTime.date,
										time: lastFeedTime.time,
									})
								: t("lastFeedNone")}
						</p>
					</div>
				</div>

				<div className="bg-white dark:bg-gray-900 rounded-3xl p-6 shadow-sm border border-gray-100 dark:border-gray-700/50 flex items-start gap-4">
					<div className="h-14 w-14 shrink-0 rounded-2xl bg-blue-50 text-blue-600 flex items-center justify-center">
						<Clock aria-hidden="true" className="h-7 w-7" />
					</div>
					<div className="min-w-0">
						<p className="text-sm font-semibold text-gray-600 uppercase tracking-wider dark:text-gray-400">
							{t("dispensedTodayLabel")}
						</p>
						<p className="text-2xl font-extrabold text-[var(--ofd-base-deep)]">
							{todayAmount.value}
							<span className="text-base text-gray-500 font-medium"> {todayAmount.unit}</span>
						</p>
						<p className="text-xs text-gray-500 mt-0.5 dark:text-gray-400">
							{t("dispensedTodayDetail", { count: feedTotals.todayCount })}
						</p>
					</div>
				</div>

				<div className="bg-white dark:bg-gray-900 rounded-3xl p-6 shadow-sm border border-gray-100 dark:border-gray-700/50 flex items-start gap-4">
					<div className="h-14 w-14 shrink-0 rounded-2xl bg-purple-50 text-purple-600 flex items-center justify-center">
						<CalendarDays aria-hidden="true" className="h-7 w-7" />
					</div>
					<div className="min-w-0">
						<p className="text-sm font-semibold text-gray-600 uppercase tracking-wider dark:text-gray-400">
							{t("last7DaysLabel")}
						</p>
						<p className="text-2xl font-extrabold text-[var(--ofd-base-deep)]">
							{weekAmount.value}
							<span className="text-base text-gray-500 font-medium"> {weekAmount.unit}</span>
						</p>
						<p className="text-xs text-gray-500 mt-0.5 dark:text-gray-400">
							{t("last7DaysDetail", {
								average: `${weekAverageAmount.value} ${weekAverageAmount.unit}`,
								count: feedTotals.last7DaysCount,
							})}
						</p>
					</div>
				</div>

				<div className="bg-white dark:bg-gray-900 rounded-3xl p-6 shadow-sm border border-gray-100 dark:border-gray-700/50 flex items-start gap-4">
					<div className="h-14 w-14 shrink-0 rounded-2xl bg-orange-50 text-orange-600 flex items-center justify-center">
						<Package aria-hidden="true" className="h-7 w-7" />
					</div>
					<div className="min-w-0">
						<p className="text-sm font-semibold text-gray-600 uppercase tracking-wider dark:text-gray-400">
							{t("feedLevel")}
						</p>
						<FeedLevelDisplay
							levelPercent={energyDevice?.feedLevelPercent ?? null}
							updatedAt={energyDevice?.feedLevelUpdatedAt ?? null}
							isOffline={feedLevelOffline}
							showBar={false}
							size="lg"
						/>
						<p className="text-xs text-gray-500 mt-0.5 dark:text-gray-400">{t("feedLevelDesc")}</p>
					</div>
				</div>
			</div>

			<section
				aria-label={t("sourceBreakdown", { days: FEED_CHART_DAYS })}
				className="flex flex-wrap items-center gap-x-5 gap-y-1 rounded-2xl border border-gray-100 bg-white px-4 py-3 text-sm dark:border-gray-700/50 dark:bg-gray-900"
			>
				<p className="text-xs font-black uppercase tracking-wider text-gray-500 dark:text-gray-400">
					{t("sourceBreakdown", { days: FEED_CHART_DAYS })}
				</p>
				{FEED_EVENT_SOURCES.map((src) => {
					const count = feedChart.countsBySource[src] ?? 0;
					return (
						<p key={src} className="font-bold text-[var(--ofd-base-deep)]">
							{sourceLabel(src)}: {count}
							{isDailyTotalSource(src) && count > 0 ? ` ${t("dailyTotals")}` : ""}
						</p>
					);
				})}
			</section>

			<section
				aria-label={t("charts.label")}
				data-help="history-charts"
				className="grid grid-cols-1 gap-6 xl:grid-cols-2"
			>
				<StackedBars
					title={t("charts.feedTitle")}
					summary={t("charts.feedSummary", {
						days: FEED_CHART_DAYS,
						total: formatChartNumber(feedChartTotal, "g"),
					})}
					labels={{
						...chartLabels,
						empty: t("charts.feedEmpty", { days: FEED_CHART_DAYS }),
					}}
					stack={feedChart.stack}
					seriesLabels={sourceSeriesLabels}
					unit="g"
				/>

				<div className="flex min-w-0 flex-col gap-2">
					<nav
						aria-label={t("charts.hopperRangeLabel")}
						className="flex flex-wrap items-center justify-end gap-1.5"
					>
						{HOPPER_RANGE_DAYS.map((option) => (
							<Link
								key={option}
								href={`/dashboard/history?hopper=${option}`}
								aria-current={option === hopperRange ? "page" : undefined}
								className={`inline-flex min-h-11 items-center rounded-xl px-3 text-xs font-black transition-colors focus-visible:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0A3D62] dark:focus-visible:outline-[#8fc0ea] ${
									option === hopperRange
										? "bg-[#0A3D62] text-white shadow-sm"
										: "border border-[#0A3D62]/20 bg-white text-[#0A3D62] hover:bg-[#F4F7F6] dark:border-gray-600 dark:bg-gray-900 dark:text-gray-200 dark:hover:bg-gray-800"
								}`}
							>
								{option === 7 ? t("charts.range7") : t("charts.range30")}
							</Link>
						))}
					</nav>
					<LineTrend
						className="flex-1"
						title={t("charts.hopperTitle")}
						summary={t("charts.hopperSummary", {
							days: hopperRange,
							points: hopperPoints.length,
							latest: hopperLatest ?? "—",
						})}
						labels={{
							...chartLabels,
							empty: t("charts.hopperEmpty", { days: hopperRange }),
						}}
						points={hopperPoints}
						unit="%"
						decimals={1}
						height={260}
					/>
				</div>
			</section>

			<div
				data-help="history-event-log"
				className="bg-white dark:bg-gray-900 rounded-3xl shadow-sm border border-gray-100 dark:border-gray-700/50 overflow-hidden"
			>
				<div className="p-6 border-b border-gray-100 dark:border-gray-700/50 bg-gray-50/50 dark:bg-gray-800/50">
					<h2 className="font-bold text-gray-800 dark:text-gray-100 flex items-center gap-2">
						<CalendarDays aria-hidden="true" className="h-5 w-5 text-gray-500" /> {t("eventLog")}
					</h2>
				</div>
				<FeedEventHistoryTable
					deviceIds={energyDevices.map((d) => d.id)}
					initialItems={initialPage.items}
					initialTotal={initialPage.total}
					pageSize={initialPage.pageSize}
				/>
			</div>
		</div>
	);
}
