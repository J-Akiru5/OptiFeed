import { DataExportButton, DataImportDialog } from "@/components/DataImportExport";
import { FeedEventHistoryTable } from "@/components/FeedEventHistoryTable";
import { DashboardEmptyState, DashboardPageHeader } from "@/components/dashboard/dashboard-ui";
import { FeedLevelDisplay } from "@/components/feed-level-display";
import { SnapshotWriter } from "@/components/pwa/snapshot-writer";
import { getFeedEvents } from "@/lib/actions/history";
import { canWrite } from "@/lib/auth/session";
import { isDeviceOffline } from "@/lib/feed-level-display";
import type { HistorySnapshotData } from "@/lib/offline/snapshots";
import { getActivePond } from "@/lib/pond-selection";
import prisma from "@/lib/prisma";
import { getListPageSize } from "@/lib/settings/platform";
import { CalendarDays, CheckCircle2, Clock, Package } from "lucide-react";
import { getTranslations } from "next-intl/server";

export const revalidate = 0;

const SOURCE_LABELS: Record<string, string> = {
	scheduled: "scheduled",
	dashboard: "dashboard",
	button: "button",
};

export default async function HistoryPage() {
	const t = await getTranslations("dashboard.history");
	const tSch = await getTranslations("dashboard.schedule");
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

	// Live device-confirmed dispenses written by POST /api/ingest (FeedEvent).
	const pageSize = await getListPageSize();
	const initialPage = await getFeedEvents({
		deviceIds: energyDevices.map((d) => d.id),
		page: 1,
		pageSize,
	});
	const events = initialPage.items;

	// Calculate stats
	const totalDispensed = events.reduce((sum, e) => sum + (e.grams ?? 0), 0);
	const sourceCounts: Record<string, number> = {};
	for (const event of events) {
		if (event.source) {
			sourceCounts[event.source] = (sourceCounts[event.source] ?? 0) + 1;
		}
	}

	const sourceLabel = (s: string) => {
		const key = SOURCE_LABELS[s] ?? "dashboard";
		return t(`source_${key}`);
	};

	const writeAccess = await canWrite();
	const feedLevelOffline = isDeviceOffline(energyDevice?.lastSeenAt ?? null);

	const historySnapshot: HistorySnapshotData = {
		pondName: pond.name,
		totalDispensedG: totalDispensed,
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
			<div className="grid grid-cols-1 gap-6 md:grid-cols-3">
				<div className="bg-white dark:bg-gray-900 rounded-3xl p-6 shadow-sm border border-gray-100 dark:border-gray-700/50 flex items-center gap-4">
					<div className="h-14 w-14 rounded-2xl bg-green-50 text-green-600 flex items-center justify-center">
						<CheckCircle2 aria-hidden="true" className="h-7 w-7" />
					</div>
					<div>
						<p className="text-sm font-semibold text-gray-600 uppercase tracking-wider dark:text-gray-400">
							{t("recentDispensed")}
						</p>
						<p className="text-2xl font-extrabold text-[var(--ofd-base-deep)]">
							{(totalDispensed / 1000).toFixed(1)}{" "}
							<span className="text-base text-gray-500 font-medium">kg</span>
						</p>
					</div>
				</div>

				<div className="bg-white dark:bg-gray-900 rounded-3xl p-6 shadow-sm border border-gray-100 dark:border-gray-700/50 flex items-center gap-4">
					<div className="h-14 w-14 rounded-2xl bg-blue-50 text-blue-600 flex items-center justify-center">
						<Clock aria-hidden="true" className="h-7 w-7" />
					</div>
					<div>
						<p className="text-sm font-semibold text-gray-600 uppercase tracking-wider dark:text-gray-400">
							{t("sourceBreakdown")}
						</p>
						<div className="mt-1 space-y-0.5">
							{["scheduled", "dashboard", "button"].map((src) => (
								<p key={src} className="text-sm font-bold text-[var(--ofd-base-deep)]">
									{sourceLabel(src)}: {sourceCounts[src] ?? 0}
								</p>
							))}
						</div>
					</div>
				</div>

				<div className="bg-white dark:bg-gray-900 rounded-3xl p-6 shadow-sm border border-gray-100 dark:border-gray-700/50 flex items-center gap-4">
					<div className="h-14 w-14 rounded-2xl bg-orange-50 text-orange-600 flex items-center justify-center">
						<Package aria-hidden="true" className="h-7 w-7" />
					</div>
					<div>
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

			<div className="bg-white dark:bg-gray-900 rounded-3xl shadow-sm border border-gray-100 dark:border-gray-700/50 overflow-hidden">
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
