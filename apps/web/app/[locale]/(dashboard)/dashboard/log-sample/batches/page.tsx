import { Pagination } from "@/components/ui/pagination";
import { Link } from "@/i18n/routing";
import { getBatchLogPage, parseBatchFilter } from "@/lib/batch-logs";
import { formatDateTimeLocal } from "@/lib/date-local";
import { getPageCount, parsePage, parsePageSize } from "@/lib/pagination";
import { getActivePond } from "@/lib/pond-selection";
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
	const [t, tDates, tSch, tPagination, pond] = await Promise.all([
		getTranslations("dashboard.logSample"),
		getTranslations("dates"),
		getTranslations("dashboard.schedule"),
		getTranslations("dashboard.growth.history.pagination"),
		getActivePond(),
	]);

	if (!pond) {
		return (
			<div className="flex h-[50vh] items-center justify-center">
				<p className="text-lg text-gray-500 dark:text-gray-400">{tSch("noPondData")}</p>
			</div>
		);
	}

	const raw = await searchParams;
	const filter = parseBatchFilter(first(raw.label), first(raw.unlabeled));
	let page = parsePage(first(raw.page));
	const pageSize = parsePageSize(first(raw.pageSize));

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
		? formatDateTimeLocal(summary.firstRecordedAt, tDates).date
		: null;
	const lastDate = summary.lastRecordedAt
		? formatDateTimeLocal(summary.lastRecordedAt, tDates).date
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
					className="inline-flex items-center gap-1.5 text-sm font-bold text-[var(--ofd-base)] transition hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ofd-base)] focus-visible:ring-offset-2"
				>
					<ArrowLeft className="h-4 w-4" />
					{t("backToLogSample")}
				</Link>

				<div className="flex items-start gap-3">
					<div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-[#0A3D62]/5 text-[#0A3D62] dark:bg-white/5 dark:text-[#5b9bd5]">
						<Scale className="h-6 w-6" />
					</div>
					<div className="min-w-0">
						<h1 className="truncate text-2xl font-black tracking-tight text-[var(--ofd-base-deep)] sm:text-3xl">
							{batchName}
						</h1>
						<p className="text-sm text-gray-500 dark:text-gray-400">
							{t("batchDesc", { pond: pond.name })}
						</p>
					</div>
				</div>
			</div>

			<section aria-label={t("savedBatches")} className="grid grid-cols-2 gap-3 lg:grid-cols-4">
				<div className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm dark:border-gray-700/50 dark:bg-gray-900">
					<p className="text-[10px] font-bold uppercase tracking-wider text-gray-400">
						{t("batchEntries")}
					</p>
					<p className="mt-1 text-xl font-black text-[var(--ofd-base-deep)]">
						{summary.entryCount}
					</p>
				</div>
				<div className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm dark:border-gray-700/50 dark:bg-gray-900">
					<p className="text-[10px] font-bold uppercase tracking-wider text-gray-400">
						{t("batchSamples")}
					</p>
					<p className="mt-1 text-xl font-black text-[var(--ofd-base-deep)]">
						{summary.totalSampleCount}
					</p>
				</div>
				<div className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm dark:border-gray-700/50 dark:bg-gray-900">
					<p className="text-[10px] font-bold uppercase tracking-wider text-gray-400">
						{t("batchAvgWeight")}
					</p>
					<p className="mt-1 text-xl font-black text-[var(--ofd-base-deep)]">
						{summary.avgWeightKg !== null ? `${(summary.avgWeightKg * 1000).toFixed(1)} g` : "—"}
					</p>
				</div>
				<div className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm dark:border-gray-700/50 dark:bg-gray-900">
					<p className="text-[10px] font-bold uppercase tracking-wider text-gray-400">
						{t("batchDateRange")}
					</p>
					<p className="mt-1 text-sm font-black text-[var(--ofd-base-deep)]">{dateRange}</p>
				</div>
			</section>

			<section className="overflow-hidden rounded-3xl border border-gray-100 bg-white shadow-sm dark:border-gray-700/50 dark:bg-gray-900">
				{entries.length === 0 ? (
					<p className="px-6 py-12 text-center text-sm text-gray-500 dark:text-gray-400">
						{t("batchNoEntries")}
					</p>
				) : (
					<>
						<div className="overflow-x-auto">
							<table className="w-full min-w-[760px] text-left text-sm text-gray-600 dark:text-gray-300">
								<thead className="bg-gray-50 text-xs font-semibold uppercase text-gray-500 dark:bg-gray-800 dark:text-gray-400">
									<tr>
										<th className="px-4 py-3">{t("batchEntryDate")}</th>
										<th className="px-4 py-3 text-right">{t("batchEntrySamples")}</th>
										<th className="px-4 py-3 text-right">{t("batchEntryAvgWeight")}</th>
										<th className="px-4 py-3 text-right">{t("batchEntryLength")}</th>
										<th className="px-4 py-3 text-right">{t("batchEntryTotalWeight")}</th>
										<th className="px-4 py-3 text-right">{t("batchEntrySource")}</th>
									</tr>
								</thead>
								<tbody className="divide-y divide-gray-100 dark:divide-gray-700/50">
									{entries.map((entry) => (
										<Fragment key={entry.id}>
											<tr className="hover:bg-gray-50 dark:hover:bg-gray-800">
												<td className="whitespace-nowrap px-4 py-3 font-medium text-gray-900 dark:text-gray-100">
													{formatDateTimeLocal(entry.recordedAt, tDates).full}
												</td>
												<td className="px-4 py-3 text-right">{entry.sampleCount}</td>
												<td className="px-4 py-3 text-right">
													{(entry.avgWeightKg * 1000).toFixed(1)} g
												</td>
												<td className="px-4 py-3 text-right">
													{entry.sampleLengthCm.toFixed(1)} cm
												</td>
												<td className="px-4 py-3 text-right">
													{entry.sampleWeightKg.toFixed(2)} kg
												</td>
												<td className="px-4 py-3 text-right text-xs uppercase tracking-wide text-gray-500">
													{entry.source
														? entry.source.charAt(0).toUpperCase() + entry.source.slice(1)
														: "—"}
												</td>
											</tr>
											{entry.fishSamples.length > 0 && (
												<tr className="bg-gray-50/60 dark:bg-gray-800/30">
													<td colSpan={6} className="px-4 pb-4 pt-0">
														<details className="group">
															<summary className="inline-flex cursor-pointer list-none items-center gap-1.5 py-2 text-xs font-bold text-[var(--ofd-base)] hover:underline">
																<ChevronRight className="h-3.5 w-3.5 transition group-open:rotate-90" />
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
																		<span className="font-bold text-gray-400">#{index + 1}</span>{" "}
																		<span className="font-semibold">
																			{fish.weightGrams.toFixed(1)} g
																		</span>
																		{fish.lengthCm > 0 && (
																			<span className="text-gray-500">
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
							</table>
						</div>

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
							/>
						)}
					</>
				)}
			</section>
		</div>
	);
}
