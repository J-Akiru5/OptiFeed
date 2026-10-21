import { Pagination } from "@/components/ui/pagination";
import { parseQueryFilters } from "@/lib/actions/query-filters";
import { formatDateTimeLocal } from "@/lib/date-local";
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
import { getPageCount, parsePage, parsePageSize, resolveDateRange } from "@/lib/pagination";
import { getActivePond } from "@/lib/pond-selection";
import prisma from "@/lib/prisma";
import { ArrowLeft, Package, Scale, TrendingUp } from "lucide-react";
import { getTranslations } from "next-intl/server";
import Link from "next/link";

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
	const pond = await getActivePond();

	const raw = await searchParams;
	const tabParam = first(raw.tab);
	const tab: GrowthHistoryTab = isGrowthHistoryTab(tabParam) ? tabParam : "feed";
	let page = parsePage(first(raw.page));
	const pageSize = parsePageSize(first(raw.pageSize));
	const from = first(raw.from) ?? "";
	const to = first(raw.to) ?? "";
	const q = first(raw.q) ?? "";

	const explicitRange = resolveDateRange(from || undefined, to || undefined);
	const searchRange = parseQueryFilters(q).recordedBetween;
	const range = explicitRange ?? searchRange;

	if (!pond) {
		const tSch = await getTranslations("dashboard.schedule");
		return (
			<div className="flex h-[50vh] items-center justify-center">
				<p className="text-lg text-gray-500 dark:text-gray-400">{tSch("noPondData")}</p>
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
		<div className="mx-auto max-w-7xl space-y-6 pb-20 animate-in fade-in duration-500">
			<header>
				<Link
					href="/dashboard/growth"
					className="inline-flex items-center gap-1.5 text-sm font-semibold text-[var(--ofd-base-deep)] hover:underline"
				>
					<ArrowLeft className="size-4" />
					{t("backToGrowth")}
				</Link>
				<h1 className="mt-2 text-3xl font-extrabold tracking-tight text-[var(--ofd-base-deep)]">
					{t("title")}
				</h1>
				<p className="mt-1 text-gray-500 dark:text-gray-400">{t("desc", { pond: pond.name })}</p>
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
							className={`inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-bold transition-colors ${
								active
									? "border-[var(--ofd-base)] bg-[var(--ofd-base)] text-white shadow-sm"
									: "border-gray-200 bg-white text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300 dark:hover:bg-gray-800"
							}`}
						>
							<Icon className="size-4" />
							{t(`tabs.${entry}`)}
						</Link>
					);
				})}
			</nav>

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
							className="h-9 rounded-lg border border-gray-200 bg-white px-3 text-sm font-normal text-gray-700 outline-none placeholder:text-gray-400 focus:border-[var(--ofd-base)] focus:ring-1 focus:ring-[var(--ofd-base)] dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200"
						/>
					</label>
					<label className="flex flex-col gap-1 text-xs font-semibold text-gray-500 dark:text-gray-400">
						{t("filters.from")}
						<input
							type="date"
							name="from"
							defaultValue={from}
							className="h-9 rounded-lg border border-gray-200 bg-white px-3 text-sm font-normal text-gray-700 outline-none focus:border-[var(--ofd-base)] focus:ring-1 focus:ring-[var(--ofd-base)] dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200"
						/>
					</label>
					<label className="flex flex-col gap-1 text-xs font-semibold text-gray-500 dark:text-gray-400">
						{t("filters.to")}
						<input
							type="date"
							name="to"
							defaultValue={to}
							className="h-9 rounded-lg border border-gray-200 bg-white px-3 text-sm font-normal text-gray-700 outline-none focus:border-[var(--ofd-base)] focus:ring-1 focus:ring-[var(--ofd-base)] dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200"
						/>
					</label>
					<div className="flex items-center gap-2">
						<button
							type="submit"
							className="h-9 rounded-lg bg-[var(--ofd-base)] px-4 text-sm font-bold text-white transition-colors hover:brightness-110"
						>
							{t("filters.apply")}
						</button>
						<Link
							href={tabHref(tab)}
							className="inline-flex h-9 items-center rounded-lg px-3 text-sm font-semibold text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800"
						>
							{t("filters.clear")}
						</Link>
					</div>
				</form>

				<div className="overflow-x-auto">
					{tab === "feed" && (
						<table className="w-full text-left text-sm text-gray-600 dark:text-gray-300">
							<thead className="bg-gray-50 text-xs font-semibold uppercase text-gray-500 dark:bg-gray-800 dark:text-gray-400">
								<tr>
									<th className="px-4 py-3">{tGrowth("dateCol")}</th>
									<th className="px-4 py-3 text-right">{tGrowth("feedLevelCol")}</th>
									<th className="px-4 py-3 text-right">{tGrowth("distanceCol")}</th>
								</tr>
							</thead>
							<tbody className="divide-y divide-gray-100 dark:divide-gray-700/50">
								{feedRows.map((row) => (
									<tr key={row.id} className="hover:bg-gray-50 dark:hover:bg-gray-800">
										<td className="whitespace-nowrap px-4 py-3 font-medium text-gray-900 dark:text-gray-100">
											{formatDateTimeLocal(row.recordedAt, tDates).fullDate}
										</td>
										<td className="px-4 py-3 text-right">
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
										</td>
										<td className="px-4 py-3 text-right font-mono">
											{row.distanceCm.toFixed(1)} cm
										</td>
									</tr>
								))}
							</tbody>
						</table>
					)}

					{tab === "growth" && (
						<table className="w-full text-left text-sm text-gray-600 dark:text-gray-300">
							<thead className="bg-gray-50 text-xs font-semibold uppercase text-gray-500 dark:bg-gray-800 dark:text-gray-400">
								<tr>
									<th className="px-3 py-3 lg:px-4">{tGrowth("dateCol")}</th>
									<th className="px-3 py-3 text-right lg:px-4">{t("columns.avgWeight")}</th>
									<th className="px-3 py-3 text-right lg:px-4">{tGrowth("avgLengthCol")}</th>
									<th className="px-3 py-3 text-right lg:px-4">{t("columns.weightGain")}</th>
									<th className="px-3 py-3 text-right lg:px-4">{t("columns.lengthGain")}</th>
									<th className="hidden px-3 py-3 text-right lg:table-cell lg:px-4">
										{t("columns.daysSince")}
									</th>
								</tr>
							</thead>
							<tbody className="divide-y divide-gray-100 dark:divide-gray-700/50">
								{growthRows.map((row) => (
									<tr key={row.id} className="hover:bg-gray-50 dark:hover:bg-gray-800">
										<td className="whitespace-nowrap px-3 py-3 font-medium text-gray-900 dark:text-gray-100 lg:px-4">
											{formatDateTimeLocal(row.recordedAt, tDates).fullDate}
										</td>
										<td className="px-3 py-3 text-right lg:px-4">{row.avgWeightG.toFixed(1)}</td>
										<td className="px-3 py-3 text-right lg:px-4">
											{row.sampleLengthCm.toFixed(1)}
										</td>
										<td className="px-3 py-3 text-right font-bold lg:px-4">
											{row.weightGainG === null ? (
												<span className="text-gray-400">—</span>
											) : (
												<span className={row.weightGainG >= 0 ? "text-green-600" : "text-red-500"}>
													{row.weightGainG >= 0 ? "+" : ""}
													{row.weightGainG.toFixed(1)}
												</span>
											)}
										</td>
										<td className="px-3 py-3 text-right font-bold lg:px-4">
											{row.lengthGainCm === null ? (
												<span className="text-gray-400">—</span>
											) : (
												<span className={row.lengthGainCm >= 0 ? "text-green-600" : "text-red-500"}>
													{row.lengthGainCm >= 0 ? "+" : ""}
													{row.lengthGainCm.toFixed(1)}
												</span>
											)}
										</td>
										<td className="hidden px-3 py-3 text-right lg:table-cell lg:px-4">
											{row.daysSinceLast === null ? (
												<span className="text-gray-400">—</span>
											) : (
												<span className="inline-flex items-center rounded-full bg-blue-50 px-2 py-0.5 text-xs font-bold text-blue-700">
													{row.daysSinceLast}d
												</span>
											)}
										</td>
									</tr>
								))}
							</tbody>
						</table>
					)}

					{tab === "biomass" && (
						<table className="w-full text-left text-sm text-gray-600 dark:text-gray-300">
							<thead className="bg-gray-50 text-xs font-semibold uppercase text-gray-500 dark:bg-gray-800 dark:text-gray-400">
								<tr>
									<th className="px-3 py-3 lg:px-4">{tGrowth("dateCol")}</th>
									<th className="hidden px-3 py-3 lg:table-cell lg:px-4">{tGrowth("batchCol")}</th>
									<th className="px-3 py-3 lg:px-4">{tGrowth("totalWeightCol")}</th>
									<th className="px-3 py-3 lg:px-4">{tGrowth("fishCountCol")}</th>
									<th className="px-3 py-3 lg:px-4">{tGrowth("avgLengthCol")}</th>
									<th className="px-3 py-3 text-right lg:px-4">{tGrowth("abwCol")}</th>
								</tr>
							</thead>
							<tbody className="divide-y divide-gray-100 dark:divide-gray-700/50">
								{biomassRows.map((row) => (
									<tr key={row.id} className="hover:bg-gray-50 dark:hover:bg-gray-800">
										<td className="whitespace-nowrap px-3 py-3 font-medium text-gray-900 dark:text-gray-100 lg:px-4">
											<div className="flex items-center gap-2">
												{formatDateTimeLocal(row.recordedAt, tDates).fullDate}
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
										</td>
										<td className="hidden whitespace-nowrap px-3 py-3 lg:table-cell lg:px-4">
											{row.batchLabel ?? <span className="text-gray-400">—</span>}
										</td>
										<td className="px-3 py-3 lg:px-4">{row.sampleWeightKg.toFixed(2)}</td>
										<td className="px-3 py-3 lg:px-4">{row.sampleCount}</td>
										<td className="px-3 py-3 lg:px-4">{row.sampleLengthCm.toFixed(1)}</td>
										<td className="px-3 py-3 text-right font-bold text-[var(--ofd-base-deep)] lg:px-4">
											{(row.avgWeightKg * 1000).toFixed(1)}
										</td>
									</tr>
								))}
							</tbody>
						</table>
					)}

					{total === 0 && (
						<p className="px-6 py-12 text-center text-sm text-gray-500 dark:text-gray-400">
							{t("empty")}
						</p>
					)}
				</div>

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
					/>
				)}
			</section>
		</div>
	);
}
