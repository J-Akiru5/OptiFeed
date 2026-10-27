import { LogSampleForm } from "@/components/LogSampleForm";
import { DashboardEmptyState, DashboardPageHeader } from "@/components/dashboard/dashboard-ui";
import { Pagination } from "@/components/ui/pagination";
import { Link } from "@/i18n/routing";
import { canWrite } from "@/lib/auth/session";
import { getBatchSummaryPage } from "@/lib/batch-logs";
import { formatDateTimeLocal } from "@/lib/date-local";
import { parsePage } from "@/lib/pagination";
import { getActivePond } from "@/lib/pond-selection";
import prisma from "@/lib/prisma";
import { resolveCurrentSchedule } from "@/lib/schedule/resolve-current";
import { getListPageSize } from "@/lib/settings/platform";
import { ChevronRight, Scale } from "lucide-react";
import { getTranslations } from "next-intl/server";

export const revalidate = 0; // Ensure data is fresh

export default async function LogSamplePage({
	searchParams,
}: {
	searchParams: Promise<{ page?: string }>;
}) {
	const params = await searchParams;
	const page = parsePage(params.page);
	const [t, tCommon, tSch, tDates, pond, pageSize] = await Promise.all([
		getTranslations("dashboard.logSample"),
		getTranslations("dashboard.common"),
		getTranslations("dashboard.schedule"),
		getTranslations("dates"),
		getActivePond(),
		getListPageSize(),
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

	const energyDevice = await prisma.energyDevice.findFirst({
		where: { pondId: pond.id },
		select: { id: true },
	});

	const batchRows = await prisma.biomassLog.findMany({
		where: { pondId: pond.id, batchLabel: { not: null } },
		select: { batchLabel: true },
		orderBy: { recordedAt: "desc" },
		distinct: ["batchLabel"],
		take: 20,
	});
	const batchLabels = batchRows
		.map((r) => r.batchLabel)
		.filter((label): label is string => label !== null);

	// `pond.*` goes stale when a device is paired (saves queue ScheduleCommands);
	// prefer the newest pending/sent command, then the last applied one.
	const currentConfig = await resolveCurrentSchedule(pond.id, energyDevice?.id ?? null);
	const writeAccess = await canWrite();

	const logRows = await getBatchSummaryPage({ pondId: pond.id, page, pageSize });
	const batches = logRows.rows;
	const firstRow = logRows.total === 0 ? 0 : (logRows.page - 1) * logRows.pageSize + 1;
	const lastRow = Math.min(logRows.page * logRows.pageSize, logRows.total);

	return (
		<div className="space-y-6 pb-20 animate-in fade-in duration-150 max-w-4xl">
			<DashboardPageHeader
				icon={Scale}
				title={t("title")}
				description={t.rich("desc", {
					pond: pond.name,
					bold: (chunks) => (
						<strong className="font-semibold text-gray-700 dark:text-gray-200">{chunks}</strong>
					),
				})}
			/>

			<section
				aria-label={t("formLabel")}
				className="bg-white dark:bg-gray-900 rounded-3xl p-4 shadow-sm border border-gray-100 dark:border-gray-700/50 sm:p-8"
			>
				<LogSampleForm
					pondId={pond.id}
					feedingRatePct={currentConfig?.feedingRatePct ?? pond.feedingRatePct}
					feedsPerDay={currentConfig?.feedsPerDay ?? pond.feedsPerDay}
					population={pond.population}
					canWrite={writeAccess}
					batchLabels={batchLabels}
					scope={pond.ownerId}
				/>
			</section>

			<section aria-labelledby="saved-batches-heading" className="pt-4">
				<h2
					id="saved-batches-heading"
					className="text-xl font-extrabold tracking-tight text-[var(--ofd-base-deep)] mb-4"
				>
					{t("savedBatches")}
				</h2>

				{batches.length === 0 ? (
					<DashboardEmptyState
						icon={Scale}
						title={t("noBatchesTitle")}
						description={t("noBatchesDesc")}
					/>
				) : (
					<ul aria-label={t("batchesLabel")} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
						{batches.map((batch) => (
							<li key={batch.label ?? "__unlabeled__"} className="min-w-0">
								<Link
									href={
										batch.label
											? `/dashboard/log-sample/batches?label=${encodeURIComponent(batch.label)}`
											: "/dashboard/log-sample/batches?unlabeled=1"
									}
									aria-label={`${batch.label ?? t("unlabeled")} — ${t("viewLogs")}`}
									className="group block h-full rounded-3xl border border-gray-100 bg-white p-6 shadow-sm transition hover:border-[var(--ofd-base)]/30 hover:shadow-md focus-visible:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0A3D62] dark:border-gray-700/50 dark:bg-gray-900 dark:focus-visible:outline-[#8fc0ea]"
								>
									<div className="flex items-start justify-between gap-3">
										<div className="min-w-0">
											<p className="truncate font-bold text-[var(--ofd-base-deep)]">
												{batch.label ?? t("unlabeled")}
											</p>
											<p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
												{t("lastSaved", {
													date: formatDateTimeLocal(batch.lastSavedAt, tDates).full,
												})}
											</p>
										</div>
										<div className="flex shrink-0 items-center gap-2">
											<span className="inline-flex items-center px-2.5 py-1 rounded-full bg-[var(--ofd-base)]/10 text-[var(--ofd-base)] text-xs font-bold">
												{t("entries", { count: batch.entryCount })}
											</span>
											<ChevronRight
												aria-hidden="true"
												className="h-4 w-4 text-gray-400 transition group-hover:translate-x-0.5 group-hover:text-[var(--ofd-base)]"
											/>
										</div>
									</div>

									<div className="mt-4 grid grid-cols-2 gap-3 border-t border-gray-100 dark:border-gray-700/50 pt-4">
										<div>
											<p className="text-[11px] uppercase font-bold tracking-wider text-gray-600 dark:text-gray-400">
												{t("totalSamples")}
											</p>
											<p className="text-sm font-black text-gray-700 dark:text-gray-100 mt-0.5">
												{batch.totalSampleCount}
											</p>
										</div>
										<div>
											<p className="text-[11px] uppercase font-bold tracking-wider text-gray-600 dark:text-gray-400">
												{t("avgWeight")}
											</p>
											<p className="text-sm font-black text-gray-700 dark:text-gray-100 mt-0.5">
												{(batch.avgWeightKg * 1000).toFixed(1)} g
											</p>
										</div>
									</div>
								</Link>
							</li>
						))}
					</ul>
				)}

				{logRows.total > 0 && (
					<Pagination
						basePath="/dashboard/log-sample"
						page={logRows.page}
						pageCount={Math.max(1, Math.ceil(logRows.total / logRows.pageSize))}
						showing={tCommon("pagination.showing", {
							from: firstRow,
							to: lastRow,
							total: logRows.total,
						})}
						previousLabel={tCommon("pagination.previous")}
						nextLabel={tCommon("pagination.next")}
						label={tCommon("pagination.label")}
					/>
				)}
			</section>
		</div>
	);
}
