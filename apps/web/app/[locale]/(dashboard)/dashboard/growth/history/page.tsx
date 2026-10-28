import { type ChartLabels, MultiLineTrend } from "@/components/charts";
import { countSeriesValues } from "@/components/charts/chart-data";
import {
	DashboardCard,
	DashboardCardRow,
	DashboardTHead,
	DashboardTable,
	DashboardTd,
	DashboardTh,
	DashboardTr,
} from "@/components/dashboard/dashboard-table";
import {
	DashboardEmptyState,
	DashboardPageHeader,
	DashboardPageShell,
} from "@/components/dashboard/dashboard-ui";
import { ItemCardGrid } from "@/components/ui/item-card";
import { Pagination } from "@/components/ui/pagination";
import { ListView } from "@/components/ui/view-toggle";
import { Link } from "@/i18n/routing";
import { parseQueryFilters } from "@/lib/actions/query-filters";
import { formatFarmDateTime } from "@/lib/date-local";
import {
	type BiomassHistoryRow,
	type FeedLevelHistoryRow,
	type GrowthHistoryRow,
	type GrowthHistoryTab,
	getBiomassHistory,
	getFeedLevelHistory,
	getGrowthHistory,
	isGrowthHistoryTab,
} from "@/lib/growth-history";
import { getPageCount, parsePage, resolveDateRange } from "@/lib/pagination";
import { UNLABELED_BATCH, getBiomassTrend } from "@/lib/pond-charts";
import { getActivePond } from "@/lib/pond-selection";
import prisma from "@/lib/prisma";
import { getListPageSize } from "@/lib/settings/platform";
import { ArrowLeft, Package, Scale, TrendingUp } from "lucide-react";
import { getTranslations } from "next-intl/server";

export const revalidate = 0;

const BASE_PATH = "/dashboard/growth/history";

interface GrowthHistoryPageProps {
	searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function first(value: string | string[] | undefined): string | undefined {
	return Array.isArray(value) ? value[0] : value;
}

const tabIcon = {
	feed: Package,
	growth: TrendingUp,
	biomass: Scale,
} as const;

export default async function GrowthHistoryPage({ searchParams }: GrowthHistoryPageProps) {
	const t = await getTranslations("dashboard.growth.history");
	const tGrowth = await getTranslations("dashboard.growth");
	const tDates = await getTranslations("dates");
	const tCommon = await getTranslations("dashboard.common");
	const pond = await getActivePond();

	const raw = await searchParams;
	const tabParam = first(raw.tab);
	const tab: GrowthHistoryTab = isGrowthHistoryTab(tabParam) ? tabParam : "feed";
	let page = parsePage(first(raw.page));
	const pageSize = await getListPageSize();
	const from = first(raw.from) ?? "";
	const to = first(raw.to) ?? "";
	const q = first(raw.q) ?? "";

	const explicitRange = resolveDateRange(from || undefined, to || undefined);
	const searchRange = parseQueryFilters(q).recordedBetween;
	const range = explicitRange ?? searchRange;

	if (!pond) {
		const tSch = await getTranslations("dashboard.schedule");
		return (
			<div className="mx-auto max-w-2xl py-10">
				<DashboardEmptyState
					icon={Scale}
					mascot="idle"
					title={tSch("noPondData")}
					description={tSch("noDeviceDesc")}
				/>
			</div>
		);
	}

	const energyDevice =
		tab === "feed"
			? await prisma.energyDevice.findFirst({
					where: { pondId: pond.id },
					orderBy: { createdAt: "asc" },
					select: { id: true },
				})
			: null;

	let total = 0;
	let feedRows: FeedLevelHistoryRow[] = [];
	let growthRows: GrowthHistoryRow[] = [];
	let biomassRows: BiomassHistoryRow[] = [];

	const load = async (targetPage: number) => {
		if (tab === "feed") {
			if (!energyDevice) {
				total = 0;
				feedRows = [];
				return;
			}
			const result = await getFeedLevelHistory({
				deviceId: energyDevice.id,
				page: targetPage,
				pageSize,
				range,
			});
			total = result.total;
			feedRows = result.items;
			return;
		}
		if (tab === "growth") {
			const result = await getGrowthHistory({
				pondId: pond.id,
				page: targetPage,
				pageSize,
				range,
			});
			total = result.total;
			growthRows = result.items;
			return;
		}
		const result = await getBiomassHistory({
			pondId: pond.id,
			page: targetPage,
			pageSize,
			range,
		});
		total = result.total;
		biomassRows = result.items;
	};

	await load(page);
	const pageCount = getPageCount(total, pageSize);
	if (page > pageCount) {
		page = pageCount;
		await load(page);
	}

	// The biomass trend is independent of the table's pagination and filters:
	// it is the whole sample history, averaged per batch per day in the DB.
	const biomassTrend = tab === "biomass" ? await getBiomassTrend(pond.id) : null;
	const chartLabels: ChartLabels = {
		period: tCommon("charts.period"),
		value: tCommon("charts.value"),
		name: tCommon("charts.name"),
		empty: tCommon("charts.empty"),
	};
	const batchSeriesLabels = Object.fromEntries(
		(biomassTrend?.series ?? []).map((key) => [
			key,
			key === UNLABELED_BATCH ? tGrowth("unlabeledBatch") : key,
		]),
	);

	const firstRow = total === 0 ? 0 : (page - 1) * pageSize + 1;
	const lastRow = Math.min(page * pageSize, total);
	const params = { tab, q, from, to };
	const tabHref = (next: GrowthHistoryTab) => {
		const search = new URLSearchParams();
		search.set("tab", next);
		if (q) search.set("q", q);
		if (from) search.set("from", from);
		if (to) search.set("to", to);
		return `${BASE_PATH}?${search.toString()}`;
	};

	return (
		<DashboardPageShell className="space-y-6 pb-20 animate-in fade-in duration-150">
			<header>
				<Link
					href="/dashboard/growth"
					className="inline-flex min-h-11 items-center gap-1.5 rounded-lg text-sm font-semibold text-[#0A3D62] hover:underline focus-visible:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0A3D62] dark:text-[#8fc0ea] dark:focus-visible:outline-[#8fc0ea]"
				>
					<ArrowLeft aria-hidden="true" className="size-4" />
					{t("backToGrowth")}
				</Link>
				<DashboardPageHeader
					className="mt-2"
					icon={TrendingUp}
					title={t("title")}
					description={t("desc", { pond: pond.name })}
				/>
			</header>

			<nav className="flex flex-wrap gap-2" aria-label={t("title")}>
				{(["feed", "growth", "biomass"] as const).map((entry) => {
					const Icon = tabIcon[entry];
					const active = entry === tab;
					return (
						<Link
							key={entry}
							href={tabHref(entry)}
							aria-current={active ? "page" : undefined}
							className={`inline-flex min-h-11 items-center gap-2 rounded-full border px-4 py-2 text-sm font-bold transition-colors focus-visible:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0A3D62] dark:focus-visible:outline-[#8fc0ea] ${
								active
									? "border-[var(--ofd-base)] bg-[var(--ofd-base)] text-white shadow-sm"
									: "border-gray-200 bg-white text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300 dark:hover:bg-gray-800"
							}`}
						>
							<Icon aria-hidden="true" className="size-4" />
							{t(`tabs.${entry}`)}
						</Link>
					);
				})}
			</nav>

			{tab === "biomass" && biomassTrend && (
				<MultiLineTrend
					title={t("charts.biomassTitle")}
					summary={t("charts.biomassSummary", {
						series: biomassTrend.series.length,
						samples: countSeriesValues(biomassTrend),
						from: biomassTrend.rows[0]?.label ?? "—",
						to: biomassTrend.rows.at(-1)?.label ?? "—",
					})}
					labels={{
						...chartLabels,
						empty: t("charts.biomassEmpty"),
					}}
					series={biomassTrend}
					seriesLabels={batchSeriesLabels}
					unit="g"
					decimals={1}
				/>
			)}

			<section className="overflow-hidden rounded-3xl border border-gray-100 bg-white shadow-sm dark:border-gray-700/50 dark:bg-gray-900">
				<form
					method="get"
					className="flex flex-col gap-3 border-b border-gray-100 bg-gray-50/50 p-4 dark:border-gray-700/50 dark:bg-gray-800/50 lg:flex-row lg:items-end"
				>
					<input type="hidden" name="tab" value={tab} />
					<label className="flex flex-1 flex-col gap-1 text-xs font-semibold text-gray-500 dark:text-gray-400">
						{t("filters.search")}
						<input
							type="search"
							name="q"
							defaultValue={q}
							placeholder={tGrowth("searchPlaceholder")}
							className="h-11 rounded-lg border border-gray-200 bg-white px-3 text-sm font-normal text-gray-700 outline-none placeholder:text-gray-400 focus:border-[var(--ofd-base)] focus:ring-1 focus:ring-[var(--ofd-base)] dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200"
						/>
					</label>
					<label className="flex flex-col gap-1 text-xs font-semibold text-gray-500 dark:text-gray-400">
						{t("filters.from")}
						<input
							type="date"
							name="from"
							defaultValue={from}
							className="h-11 rounded-lg border border-gray-200 bg-white px-3 text-sm font-normal text-gray-700 outline-none focus:border-[var(--ofd-base)] focus:ring-1 focus:ring-[var(--ofd-base)] dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200"
						/>
					</label>
					<label className="flex flex-col gap-1 text-xs font-semibold text-gray-500 dark:text-gray-400">
						{t("filters.to")}
						<input
							type="date"
							name="to"
							defaultValue={to}
							className="h-11 rounded-lg border border-gray-200 bg-white px-3 text-sm font-normal text-gray-700 outline-none focus:border-[var(--ofd-base)] focus:ring-1 focus:ring-[var(--ofd-base)] dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200"
						/>
					</label>
					<div className="flex items-center gap-2">
						<button
							type="submit"
							className="h-11 rounded-lg bg-[var(--ofd-base)] px-4 text-sm font-bold text-white transition-colors hover:brightness-110"
						>
							{t("filters.apply")}
						</button>
						<Link
							href={tabHref(tab)}
							className="inline-flex h-11 items-center rounded-lg px-3 text-sm font-semibold text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800"
						>
							{t("filters.clear")}
						</Link>
					</div>
				</form>

				{total === 0 ? (
					<div className="p-4 sm:p-6">
						<DashboardEmptyState
							icon={Scale}
							mascot="idle"
							title={t("emptyTitle")}
							description={t("emptyDesc")}
						/>
					</div>
				) : (
					<>
						{tab === "feed" && (
							<ListView
								pageKey="growth-history"
								listLabel={tCommon("viewToggle.list")}
								cardsLabel={tCommon("viewToggle.cards")}
								toggleLabel={tCommon("viewToggle.label")}
							>
								<DashboardTable caption={tGrowth("feedLevelTableCaption")} minWidth="min-w-[32rem]">
									<DashboardTHead>
										<DashboardTh>{tGrowth("dateCol")}</DashboardTh>
										<DashboardTh align="right">{tGrowth("feedLevelCol")}</DashboardTh>
										<DashboardTh align="right">{tGrowth("distanceCol")}</DashboardTh>
									</DashboardTHead>
									<tbody className="divide-y divide-gray-100 dark:divide-gray-700/50">
										{feedRows.map((row) => (
											<DashboardTr key={row.id}>
												<DashboardTd className="whitespace-nowrap font-medium text-gray-900 dark:text-gray-100">
													{formatFarmDateTime(row.recordedAt, tDates).fullDate}
												</DashboardTd>
												<DashboardTd className="text-right">
													<span
														className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ${
															row.levelPercent <= 5
																? "bg-red-100 text-red-700"
																: row.levelPercent <= 20
																	? "bg-amber-100 text-amber-700"
																	: "bg-green-100 text-green-700"
														}`}
													>
														{Math.round(row.levelPercent)}%
													</span>
												</DashboardTd>
												<DashboardTd className="text-right font-mono">
													{row.distanceCm.toFixed(1)} cm
												</DashboardTd>
											</DashboardTr>
										))}
									</tbody>
								</DashboardTable>
								<ItemCardGrid label={tGrowth("feedLevelTableCaption")} className="p-4">
									{feedRows.map((row) => (
										<DashboardCard key={row.id}>
											<div className="flex items-baseline justify-between gap-3">
												<p className="text-xs font-black text-[#0A3D62] dark:text-[#5b9bd5]">
													{formatFarmDateTime(row.recordedAt, tDates).fullDate}
												</p>
												<p className="text-sm font-black text-[#0A3D62] dark:text-[#5b9bd5]">
													{Math.round(row.levelPercent)}%
												</p>
											</div>
											<div className="mt-2">
												<DashboardCardRow label={tGrowth("distanceCol")}>
													{row.distanceCm.toFixed(1)} cm
												</DashboardCardRow>
											</div>
										</DashboardCard>
									))}
								</ItemCardGrid>
							</ListView>
						)}

						{tab === "growth" && (
							<ListView
								pageKey="growth-history"
								listLabel={tCommon("viewToggle.list")}
								cardsLabel={tCommon("viewToggle.cards")}
								toggleLabel={tCommon("viewToggle.label")}
							>
								<DashboardTable caption={tGrowth("tableCaption")} minWidth="min-w-[40rem]">
									<DashboardTHead>
										<DashboardTh>{tGrowth("dateCol")}</DashboardTh>
										<DashboardTh align="right">{t("columns.avgWeight")}</DashboardTh>
										<DashboardTh align="right">{t("columns.sgr")}</DashboardTh>
										<DashboardTh align="right">{tGrowth("avgLengthCol")}</DashboardTh>
										<DashboardTh align="right">{t("columns.weightGain")}</DashboardTh>
										<DashboardTh align="right">{t("columns.lengthGain")}</DashboardTh>
										<DashboardTh align="right">{t("columns.daysSince")}</DashboardTh>
									</DashboardTHead>
									<tbody className="divide-y divide-gray-100 dark:divide-gray-700/50">
										{growthRows.map((row) => (
											<DashboardTr key={row.id}>
												<DashboardTd className="whitespace-nowrap font-medium text-gray-900 dark:text-gray-100">
													{formatFarmDateTime(row.recordedAt, tDates).fullDate}
												</DashboardTd>
												<DashboardTd className="text-right">
													{row.avgWeightG.toFixed(1)} g
												</DashboardTd>
												<DashboardTd className="text-right font-bold">
													{row.sgrPctPerDay === null ? (
														<span className="text-gray-400">—</span>
													) : (
														<span
															className={row.sgrPctPerDay >= 0 ? "text-green-700" : "text-red-600"}
														>
															{row.sgrPctPerDay.toFixed(2)}
														</span>
													)}
												</DashboardTd>
												<DashboardTd className="text-right">
													{row.sampleLengthCm.toFixed(1)} cm
												</DashboardTd>
												<DashboardTd className="text-right font-bold">
													{row.weightGainG === null ? (
														<span className="text-gray-400">—</span>
													) : (
														<span
															className={row.weightGainG >= 0 ? "text-green-700" : "text-red-600"}
														>
															{row.weightGainG >= 0 ? "+" : ""}
															{row.weightGainG.toFixed(1)}
														</span>
													)}
												</DashboardTd>
												<DashboardTd className="text-right font-bold">
													{row.lengthGainCm === null ? (
														<span className="text-gray-400">—</span>
													) : (
														<span
															className={row.lengthGainCm >= 0 ? "text-green-700" : "text-red-600"}
														>
															{row.lengthGainCm >= 0 ? "+" : ""}
															{row.lengthGainCm.toFixed(1)}
														</span>
													)}
												</DashboardTd>
												<DashboardTd className="text-right">
													{row.daysSinceLast === null ? (
														<span className="text-gray-400">—</span>
													) : (
														<span className="inline-flex items-center rounded-full bg-blue-50 px-2 py-0.5 text-xs font-bold text-blue-700">
															{row.daysSinceLast}d
														</span>
													)}
												</DashboardTd>
											</DashboardTr>
										))}
									</tbody>
								</DashboardTable>
								<ItemCardGrid label={tGrowth("tableCaption")} className="p-4">
									{growthRows.map((row) => (
										<DashboardCard key={row.id}>
											<p className="text-xs font-black text-[#0A3D62] dark:text-[#5b9bd5]">
												{formatFarmDateTime(row.recordedAt, tDates).fullDate}
											</p>
											<div className="mt-2">
												<DashboardCardRow label={t("columns.avgWeight")}>
													{row.avgWeightG.toFixed(1)} g
												</DashboardCardRow>
												<DashboardCardRow label={t("columns.sgr")}>
													{row.sgrPctPerDay === null ? "—" : row.sgrPctPerDay.toFixed(2)}
												</DashboardCardRow>
												<DashboardCardRow label={tGrowth("avgLengthCol")}>
													{row.sampleLengthCm.toFixed(1)} cm
												</DashboardCardRow>
												<DashboardCardRow label={t("columns.weightGain")}>
													{row.weightGainG === null
														? "—"
														: `${row.weightGainG >= 0 ? "+" : ""}${row.weightGainG.toFixed(1)} g`}
												</DashboardCardRow>
												<DashboardCardRow label={t("columns.lengthGain")}>
													{row.lengthGainCm === null
														? "—"
														: `${row.lengthGainCm >= 0 ? "+" : ""}${row.lengthGainCm.toFixed(1)} cm`}
												</DashboardCardRow>
												<DashboardCardRow label={t("columns.daysSince")}>
													{row.daysSinceLast === null ? "—" : `${row.daysSinceLast}d`}
												</DashboardCardRow>
											</div>
										</DashboardCard>
									))}
								</ItemCardGrid>
							</ListView>
						)}

						{tab === "biomass" && (
							<ListView
								pageKey="growth-history"
								listLabel={tCommon("viewToggle.list")}
								cardsLabel={tCommon("viewToggle.cards")}
								toggleLabel={tCommon("viewToggle.label")}
							>
								<DashboardTable caption={tGrowth("biomassTableCaption")} minWidth="min-w-[40rem]">
									<DashboardTHead>
										<DashboardTh>{tGrowth("dateCol")}</DashboardTh>
										<DashboardTh>{tGrowth("batchCol")}</DashboardTh>
										<DashboardTh>{tGrowth("totalWeightCol")}</DashboardTh>
										<DashboardTh>{tGrowth("fishCountCol")}</DashboardTh>
										<DashboardTh>{tGrowth("avgLengthCol")}</DashboardTh>
										<DashboardTh align="right">{tGrowth("abwCol")}</DashboardTh>
									</DashboardTHead>
									<tbody className="divide-y divide-gray-100 dark:divide-gray-700/50">
										{biomassRows.map((row) => (
											<DashboardTr key={row.id}>
												<DashboardTd className="whitespace-nowrap font-medium text-gray-900 dark:text-gray-100">
													<div className="flex items-center gap-2">
														{formatFarmDateTime(row.recordedAt, tDates).fullDate}
														{row.source === "import" && (
															<span className="rounded-full bg-violet-100 px-1.5 py-0.5 text-[10px] font-bold text-violet-700 dark:bg-violet-900/40 dark:text-violet-300">
																{tGrowth("importedBadge")}
															</span>
														)}
														{row.source === "seed" && (
															<span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
																{tGrowth("seedBadge")}
															</span>
														)}
													</div>
												</DashboardTd>
												<DashboardTd className="whitespace-nowrap">
													{row.batchLabel ?? <span className="text-gray-400">—</span>}
												</DashboardTd>
												<DashboardTd>{row.sampleWeightKg.toFixed(2)} kg</DashboardTd>
												<DashboardTd>{row.sampleCount}</DashboardTd>
												<DashboardTd>{row.sampleLengthCm.toFixed(1)} cm</DashboardTd>
												<DashboardTd className="text-right font-bold text-[var(--ofd-base-deep)]">
													{(row.avgWeightKg * 1000).toFixed(1)} g
												</DashboardTd>
											</DashboardTr>
										))}
									</tbody>
								</DashboardTable>
								<ItemCardGrid label={tGrowth("biomassTableCaption")} className="p-4">
									{biomassRows.map((row) => (
										<DashboardCard key={row.id}>
											<p className="text-xs font-black text-[#0A3D62] dark:text-[#5b9bd5]">
												{formatFarmDateTime(row.recordedAt, tDates).fullDate}
											</p>
											<div className="mt-2">
												<DashboardCardRow label={tGrowth("batchCol")}>
													{row.batchLabel ?? "—"}
												</DashboardCardRow>
												<DashboardCardRow label={tGrowth("totalWeightCol")}>
													{row.sampleWeightKg.toFixed(2)} kg
												</DashboardCardRow>
												<DashboardCardRow label={tGrowth("fishCountCol")}>
													{row.sampleCount}
												</DashboardCardRow>
												<DashboardCardRow label={tGrowth("avgLengthCol")}>
													{row.sampleLengthCm.toFixed(1)} cm
												</DashboardCardRow>
												<DashboardCardRow label={tGrowth("abwCol")}>
													{(row.avgWeightKg * 1000).toFixed(1)} g
												</DashboardCardRow>
											</div>
										</DashboardCard>
									))}
								</ItemCardGrid>
							</ListView>
						)}
					</>
				)}

				{total > 0 && (
					<Pagination
						basePath={BASE_PATH}
						params={params}
						page={page}
						pageCount={pageCount}
						showing={t("pagination.showing", {
							from: firstRow,
							to: lastRow,
							total,
						})}
						previousLabel={t("pagination.previous")}
						nextLabel={t("pagination.next")}
						label={t("pagination.label")}
					/>
				)}
			</section>
		</DashboardPageShell>
	);
}
