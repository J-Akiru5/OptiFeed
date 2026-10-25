import { LogSampleForm } from "@/components/LogSampleForm";
import { Link } from "@/i18n/routing";
import { canWrite } from "@/lib/auth/session";
import { summarizeBatches } from "@/lib/batch-summary";
import { formatDateTimeLocal } from "@/lib/date-local";
import { getActivePond } from "@/lib/pond-selection";
import prisma from "@/lib/prisma";
import { resolveCurrentSchedule } from "@/lib/schedule/resolve-current";
import { ChevronRight } from "lucide-react";
import { getTranslations } from "next-intl/server";

export const revalidate = 0; // Ensure data is fresh

export default async function LogSamplePage() {
	const t = await getTranslations("dashboard.logSample");
	const tSch = await getTranslations("dashboard.schedule");
	const tDates = await getTranslations("dates");
	const pond = await getActivePond();

	if (!pond) {
		return (
			<div className="flex h-[50vh] items-center justify-center">
				<p className="text-lg text-gray-500 dark:text-gray-400">{tSch("noPondData")}</p>
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

	const logRows = await prisma.biomassLog.findMany({
		where: { pondId: pond.id },
		select: { batchLabel: true, sampleCount: true, sampleWeightKg: true, recordedAt: true },
		orderBy: { recordedAt: "desc" },
	});
	const batches = summarizeBatches(logRows);

	return (
		<div className="space-y-6 pb-20 animate-in fade-in duration-150 max-w-4xl">
			<header className="mb-10">
				<h1 className="text-3xl font-extrabold tracking-tight text-[var(--ofd-base-deep)]">
					{t("title")}
				</h1>
				<p className="text-gray-500 dark:text-gray-400 mt-2 text-lg">
					{t.rich("desc", {
						pond: pond.name,
						bold: (chunks) => <strong className="font-semibold text-gray-700">{chunks}</strong>,
					})}
				</p>
			</header>

			<div className="bg-white dark:bg-gray-900 rounded-3xl p-8 shadow-sm border border-gray-100 dark:border-gray-700/50">
				<LogSampleForm
					pondId={pond.id}
					feedingRatePct={currentConfig?.feedingRatePct ?? pond.feedingRatePct}
					feedsPerDay={currentConfig?.feedsPerDay ?? pond.feedsPerDay}
					population={pond.population}
					canWrite={writeAccess}
					batchLabels={batchLabels}
					scope={pond.ownerId}
				/>
			</div>

			<section aria-labelledby="saved-batches-heading" className="pt-4">
				<h2
					id="saved-batches-heading"
					className="text-xl font-extrabold tracking-tight text-[var(--ofd-base-deep)] mb-4"
				>
					{t("savedBatches")}
				</h2>

				{batches.length === 0 ? (
					<p className="rounded-3xl bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-700/50 shadow-sm p-6 text-sm text-gray-500 dark:text-gray-400">
						{t("noBatches")}
					</p>
				) : (
					<div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
						{batches.map((batch) => (
							<Link
								key={batch.label ?? "__unlabeled__"}
								href={
									batch.label
										? `/dashboard/log-sample/batches?label=${encodeURIComponent(batch.label)}`
										: "/dashboard/log-sample/batches?unlabeled=1"
								}
								title={t("viewLogs")}
								className="group block rounded-3xl border border-gray-100 bg-white p-6 shadow-sm transition hover:border-[var(--ofd-base)]/30 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ofd-base)] focus-visible:ring-offset-2 dark:border-gray-700/50 dark:bg-gray-900 dark:focus-visible:ring-offset-gray-900"
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
										<ChevronRight className="h-4 w-4 text-gray-300 transition group-hover:translate-x-0.5 group-hover:text-[var(--ofd-base)]" />
									</div>
								</div>

								<div className="mt-4 grid grid-cols-2 gap-3 border-t border-gray-100 dark:border-gray-700/50 pt-4">
									<div>
										<p className="text-[11px] uppercase font-bold tracking-wider text-gray-400">
											{t("totalSamples")}
										</p>
										<p className="text-sm font-black text-gray-700 dark:text-gray-100 mt-0.5">
											{batch.totalSampleCount}
										</p>
									</div>
									<div>
										<p className="text-[11px] uppercase font-bold tracking-wider text-gray-400">
											{t("avgWeight")}
										</p>
										<p className="text-sm font-black text-gray-700 dark:text-gray-100 mt-0.5">
											{(batch.avgWeightKg * 1000).toFixed(1)}g
										</p>
									</div>
								</div>
								<span className="sr-only">{t("viewLogs")}</span>
							</Link>
						))}
					</div>
				)}
			</section>
		</div>
	);
}
