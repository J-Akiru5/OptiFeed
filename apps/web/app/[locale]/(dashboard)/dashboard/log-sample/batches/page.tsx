import {
	DashboardCard,
	DashboardCardRow,
	DashboardTHead,
	DashboardTable,
	DashboardTd,
	DashboardTh,
	DashboardTr,
} from "@/components/dashboard/dashboard-table";
import { DashboardEmptyState, DashboardPageHeader } from "@/components/dashboard/dashboard-ui";
import { BiomassLogActions } from "@/components/growth/BiomassLogActions";
import { ItemCardGrid } from "@/components/ui/item-card";
import { Pagination } from "@/components/ui/pagination";
import { ListView } from "@/components/ui/view-toggle";
import { Link } from "@/i18n/routing";
import { canWrite } from "@/lib/auth/session";
import { getBatchLogPage, parseBatchFilter } from "@/lib/batch-logs";
import { formatFarmDateTime } from "@/lib/date-local";
import { getPageCount, parsePage } from "@/lib/pagination";
import { getActivePond } from "@/lib/pond-selection";
import { getListPageSize } from "@/lib/settings/platform";
import { ArrowLeft, ChevronRight, Scale } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { Fragment } from "react";

export const revalidate = 0;

const BASE_PATH = "/dashboard/log-sample/batches";

interface BatchLogsPageProps {
	searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function first(value: string | string[] | undefined): string | undefined {
	return Array.isArray(value) ? value[0] : value;
}

export default async function BatchLogsPage({ searchParams }: BatchLogsPageProps) {
	const [t, tDates, tSch, tPagination, tHist, tCommon, pond, writeAccess] = await Promise.all([
		getTranslations("dashboard.logSample"),
		getTranslations("dates"),
		getTranslations("dashboard.schedule"),
		getTranslations("dashboard.growth.history.pagination"),
		getTranslations("dashboard.history"),
		getTranslations("dashboard.common"),
		getActivePond(),
		canWrite(),
	]);

	if (!pond) {
		return (
			<div className="mx-auto max-w-2xl py-10">
				<DashboardEmptyState
					icon={Scale}
					title={tSch("noPondData")}
					description={tSch("noDeviceDesc")}
				/>
			</div>
		);
	}

	const raw = await searchParams;
	const filter = parseBatchFilter(first(raw.label), first(raw.unlabeled));
	let page = parsePage(first(raw.page));
	const pageSize = await getListPageSize();

	if (!filter) {
		return (
			<div className="mx-auto flex min-h-[50vh] max-w-2xl flex-col items-center justify-center rounded-3xl border border-dashed border-[#0A3D62]/20 bg-white p-8 text-center dark:border-white/10 dark:bg-gray-900">
				<div className="flex h-14 w-14 items-center justify-center rounded-3xl bg-[#0A3D62]/5 text-[#0A3D62] dark:bg-white/5 dark:text-[#5b9bd5]">
					<Scale className="h-7 w-7" />
				</div>
				<h1 className="mt-3 text-xl font-black text-gray-900 dark:text-gray-100">
					{t("batchMissingTitle")}
				</h1>
				<p className="mt-1 max-w-md text-sm text-gray-500 dark:text-gray-400">
					{t("batchMissingDesc")}
				</p>
				<Link
					href="/dashboard/log-sample"
					className="mt-5 inline-flex items-center gap-2 rounded-xl bg-[var(--ofd-base)] px-4 py-2.5 text-sm font-bold text-white transition hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ofd-base)] focus-visible:ring-offset-2"
				>
					<ArrowLeft className="h-4 w-4" />
					{t("backToLogSample")}
				</Link>
			</div>
		);
	}

	let result = await getBatchLogPage({ pondId: pond.id, filter, page, pageSize });
	const pageCount = getPageCount(result.total, pageSize);
	if (page > pageCount) {
		page = pageCount;
		result = await getBatchLogPage({ pondId: pond.id, filter, page, pageSize });
	}

	const { total, entries, summary } = result;
	const firstRow = total === 0 ? 0 : (page - 1) * pageSize + 1;
	const lastRow = Math.min(page * pageSize, total);
	const params: Record<string, string> =
		filter.kind === "unlabeled" ? { unlabeled: "1" } : { label: filter.label };
	const batchName = filter.kind === "unlabeled" ? t("unlabeled") : filter.label;
	const firstDate = summary.firstRecordedAt
		? formatFarmDateTime(summary.firstRecordedAt, tDates).date
		: null;
	const lastDate = summary.lastRecordedAt
		? formatFarmDateTime(summary.lastRecordedAt, tDates).date
		: null;
	const dateRange =
		firstDate && lastDate
			? firstDate === lastDate
				? firstDate
				: `${firstDate} – ${lastDate}`
			: "—";

	return (
		<div className="mx-auto w-full min-w-0 max-w-4xl space-y-6 pb-20 animate-in fade-in duration-150 [contain:inline-size]">
			<div className="space-y-4">
				<Link
					href="/dashboard/log-sample"
					className="inline-flex min-h-11 items-center gap-1.5 rounded-lg text-sm font-bold text-[#0A3D62] transition hover:underline focus-visible:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0A3D62] dark:text-[#8fc0ea] dark:focus-visible:outline-[#8fc0ea]"
				>
					<ArrowLeft aria-hidden="true" className="h-4 w-4" />
					{t("backToLogSample")}
				</Link>

				<DashboardPageHeader
					icon={Scale}
					title={batchName}
					description={t("batchDesc", { pond: pond.name })}
				/>
			</div>

			<section aria-label={t("savedBatches")} className="grid grid-cols-2 gap-3 lg:grid-cols-4">
				<div className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm dark:border-gray-700/50 dark:bg-gray-900">
					<p className="text-[10px] font-bold uppercase tracking-wider text-gray-600 dark:text-gray-400">
						{t("batchEntries")}
					</p>
					<p className="mt-1 text-xl font-black text-[var(--ofd-base-deep)]">
						{summary.entryCount}
					</p>
				</div>
				<div className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm dark:border-gray-700/50 dark:bg-gray-900">
					<p className="text-[10px] font-bold uppercase tracking-wider text-gray-600 dark:text-gray-400">
						{t("batchSamples")}
					</p>
					<p className="mt-1 text-xl font-black text-[var(--ofd-base-deep)]">
						{summary.totalSampleCount}
					</p>
				</div>
				<div className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm dark:border-gray-700/50 dark:bg-gray-900">
					<p className="text-[10px] font-bold uppercase tracking-wider text-gray-600 dark:text-gray-400">
						{t("batchAvgWeight")}
					</p>
					<p className="mt-1 text-xl font-black text-[var(--ofd-base-deep)]">
						{summary.avgWeightKg !== null ? `${(summary.avgWeightKg * 1000).toFixed(1)} g` : "—"}
					</p>
				</div>
				<div className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm dark:border-gray-700/50 dark:bg-gray-900">
					<p className="text-[10px] font-bold uppercase tracking-wider text-gray-600 dark:text-gray-400">
						{t("batchDateRange")}
					</p>
					<p className="mt-1 text-sm font-black text-[var(--ofd-base-deep)]">{dateRange}</p>
				</div>
			</section>

			<section className="overflow-hidden rounded-3xl border border-gray-100 bg-white shadow-sm dark:border-gray-700/50 dark:bg-gray-900">
				{entries.length === 0 ? (
					<div className="p-4 sm:p-6">
						<DashboardEmptyState
							icon={Scale}
							title={t("batchNoEntries")}
							description={t("noBatchesDesc")}
						/>
					</div>
				) : (
					<>
						<ListView
							pageKey="biomass-batches"
							listLabel={tCommon("viewToggle.list")}
							cardsLabel={tCommon("viewToggle.cards")}
							toggleLabel={tCommon("viewToggle.label")}
						>
							<DashboardTable
								caption={t("batchDesc", { pond: pond.name })}
								minWidth="min-w-[48rem]"
							>
								<DashboardTHead>
									<DashboardTh>{t("batchEntryDate")}</DashboardTh>
									<DashboardTh align="right">{t("batchEntrySamples")}</DashboardTh>
									<DashboardTh align="right">{t("batchEntryAvgWeight")}</DashboardTh>
									<DashboardTh align="right">{t("batchEntryLength")}</DashboardTh>
									<DashboardTh align="right">{t("batchEntryTotalWeight")}</DashboardTh>
									<DashboardTh align="right">{t("batchEntrySource")}</DashboardTh>
									<DashboardTh align="right">{t("batchEntryActions")}</DashboardTh>
								</DashboardTHead>
								<tbody className="divide-y divide-gray-100 dark:divide-gray-700/50">
									{entries.map((entry) => (
										<Fragment key={entry.id}>
											<DashboardTr>
												<DashboardTd className="whitespace-nowrap font-medium text-gray-900 dark:text-gray-100">
													{formatFarmDateTime(entry.recordedAt, tDates).full}
												</DashboardTd>
												<DashboardTd className="text-right">{entry.sampleCount}</DashboardTd>
												<DashboardTd className="text-right">
													{(entry.avgWeightKg * 1000).toFixed(1)} g
												</DashboardTd>
												<DashboardTd className="text-right">
													{entry.sampleLengthCm.toFixed(1)} cm
												</DashboardTd>
												<DashboardTd className="text-right">
													{entry.sampleWeightKg.toFixed(2)} kg
												</DashboardTd>
												<DashboardTd className="text-right text-xs uppercase tracking-wide text-gray-600 dark:text-gray-400">
													{entry.source
														? tHist.has(`source_${entry.source}`)
															? tHist(`source_${entry.source}`)
															: entry.source
														: "—"}
												</DashboardTd>
												<DashboardTd className="text-right">
													<BiomassLogActions
														canWrite={writeAccess}
														log={{
															id: entry.id,
															recordedAt: entry.recordedAt.toISOString(),
															sampleCount: entry.sampleCount,
															sampleWeightKg: entry.sampleWeightKg,
															sampleLengthCm: entry.sampleLengthCm,
															batchLabel: filter.kind === "unlabeled" ? null : filter.label,
														}}
													/>
												</DashboardTd>
											</DashboardTr>
											{entry.fishSamples.length > 0 && (
												<tr className="bg-gray-50/60 dark:bg-gray-800/30">
													<td colSpan={7} className="px-4 pb-4 pt-0">
														<details className="group">
															<summary className="inline-flex min-h-11 cursor-pointer list-none items-center gap-1.5 py-2 text-xs font-bold text-[#0A3D62] hover:underline dark:text-[#8fc0ea]">
																<ChevronRight
																	aria-hidden="true"
																	className="h-3.5 w-3.5 transition group-open:rotate-90"
																/>
																{t("batchIndividualSamples", {
																	count: entry.fishSamples.length,
																})}
															</summary>
															<ul className="mt-1 grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
																{entry.fishSamples.map((fish, index) => (
																	<li
																		key={fish.id}
																		className="rounded-lg border border-gray-100 bg-white px-2.5 py-1.5 text-xs text-gray-600 dark:border-gray-700/50 dark:bg-gray-900 dark:text-gray-300"
																	>
																		<span className="font-bold text-gray-500">#{index + 1}</span>{" "}
																		<span className="font-semibold">
																			{fish.weightGrams.toFixed(1)} g
																		</span>
																		{fish.lengthCm > 0 && (
																			<span className="text-gray-600 dark:text-gray-400">
																				{" "}
																				· {fish.lengthCm.toFixed(1)} cm
																			</span>
																		)}
																	</li>
																))}
															</ul>
														</details>
													</td>
												</tr>
											)}
										</Fragment>
									))}
								</tbody>
							</DashboardTable>

							<ItemCardGrid label={t("batchDesc", { pond: pond.name })} className="p-4">
								{entries.map((entry) => (
									<DashboardCard key={entry.id}>
										<div className="flex items-baseline justify-between gap-3">
											<p className="text-xs font-black text-[#0A3D62] dark:text-[#5b9bd5]">
												{formatFarmDateTime(entry.recordedAt, tDates).full}
											</p>
											<BiomassLogActions
												canWrite={writeAccess}
												log={{
													id: entry.id,
													recordedAt: entry.recordedAt.toISOString(),
													sampleCount: entry.sampleCount,
													sampleWeightKg: entry.sampleWeightKg,
													sampleLengthCm: entry.sampleLengthCm,
													batchLabel: filter.kind === "unlabeled" ? null : filter.label,
												}}
											/>
										</div>
										<div className="mt-2">
											<DashboardCardRow label={t("batchEntrySamples")}>
												{entry.sampleCount}
											</DashboardCardRow>
											<DashboardCardRow label={t("batchEntryAvgWeight")}>
												{(entry.avgWeightKg * 1000).toFixed(1)} g
											</DashboardCardRow>
											<DashboardCardRow label={t("batchEntryLength")}>
												{entry.sampleLengthCm.toFixed(1)} cm
											</DashboardCardRow>
											<DashboardCardRow label={t("batchEntryTotalWeight")}>
												{entry.sampleWeightKg.toFixed(2)} kg
											</DashboardCardRow>
											<DashboardCardRow label={t("batchEntrySource")}>
												{entry.source
													? tHist.has(`source_${entry.source}`)
														? tHist(`source_${entry.source}`)
														: entry.source
													: "—"}
											</DashboardCardRow>
										</div>
										{entry.fishSamples.length > 0 && (
											<details className="mt-2 border-t border-gray-100 pt-2 dark:border-gray-700/50">
												<summary className="inline-flex min-h-11 cursor-pointer list-none items-center gap-1.5 text-xs font-bold text-[#0A3D62] dark:text-[#8fc0ea]">
													<ChevronRight aria-hidden="true" className="h-3.5 w-3.5" />
													{t("batchIndividualSamples", { count: entry.fishSamples.length })}
												</summary>
												<ul className="mt-1 grid gap-1.5">
													{entry.fishSamples.map((fish, index) => (
														<li
															key={fish.id}
															className="rounded-lg border border-gray-100 px-2.5 py-1.5 text-xs text-gray-600 dark:border-gray-700/50 dark:text-gray-300"
														>
															<span className="font-bold text-gray-500">#{index + 1}</span> ·{" "}
															<span className="font-semibold">{fish.weightGrams.toFixed(1)} g</span>
															{fish.lengthCm > 0 && <span> · {fish.lengthCm.toFixed(1)} cm</span>}
														</li>
													))}
												</ul>
											</details>
										)}
									</DashboardCard>
								))}
							</ItemCardGrid>
						</ListView>

						{total > 0 && (
							<Pagination
								basePath={BASE_PATH}
								params={params}
								page={page}
								pageCount={pageCount}
								showing={tPagination("showing", {
									from: firstRow,
									to: lastRow,
									total,
								})}
								previousLabel={tPagination("previous")}
								nextLabel={tPagination("next")}
								label={tPagination("label")}
							/>
						)}
					</>
				)}
			</section>
		</div>
	);
}
