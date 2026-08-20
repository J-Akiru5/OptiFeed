import { DataExportButton, DataImportDialog } from "@/components/DataImportExport";
import { FeedEventHistoryTable } from "@/components/FeedEventHistoryTable";
import { getFeedEvents } from "@/lib/actions/history";
import { getCurrentPondOwnerId } from "@/lib/auth/session";
import prisma from "@/lib/prisma";
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
	const pond = await prisma.pond.findFirst({
		where: { ownerId: await getCurrentPondOwnerId() },
	});

	if (!pond) {
		return (
			<div className="flex h-[50vh] items-center justify-center">
				<p className="text-lg text-gray-500">{tSch("noPondData")}</p>
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
			hopperCapacityG: true,
			gramsPerFeeding: true,
		},
	});

	const energyDevice = energyDevices[0];

	// Live device-confirmed dispenses written by POST /api/ingest (FeedEvent).
	const initialPage = await getFeedEvents({
		deviceIds: energyDevices.map((d) => d.id),
		cursor: null,
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

	return (
		<div className="space-y-8 pb-20 animate-in fade-in duration-500">
			<header className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
				<div>
					<h1 className="text-3xl font-extrabold tracking-tight text-[var(--ofd-base-deep)]">
						{t("title")}
					</h1>
					<p className="text-gray-500 mt-1">{t("desc", { pond: pond.name })}</p>
				</div>
				<div className="flex items-center gap-3">
					<DataImportDialog />
					<DataExportButton />
				</div>
			</header>

			<div className="grid grid-cols-1 md:grid-cols-3 gap-6">
				<div className="bg-white rounded-3xl p-6 shadow-sm border border-gray-100 flex items-center gap-4">
					<div className="h-14 w-14 rounded-2xl bg-green-50 text-green-600 flex items-center justify-center">
						<CheckCircle2 className="h-7 w-7" />
					</div>
					<div>
						<p className="text-sm font-semibold text-gray-500 uppercase tracking-wider">
							{t("recentDispensed")}
						</p>
						<p className="text-2xl font-extrabold text-[var(--ofd-base-deep)]">
							{(totalDispensed / 1000).toFixed(1)}{" "}
							<span className="text-base text-gray-400 font-medium">kg</span>
						</p>
					</div>
				</div>

				<div className="bg-white rounded-3xl p-6 shadow-sm border border-gray-100 flex items-center gap-4">
					<div className="h-14 w-14 rounded-2xl bg-blue-50 text-blue-600 flex items-center justify-center">
						<Clock className="h-7 w-7" />
					</div>
					<div>
						<p className="text-sm font-semibold text-gray-500 uppercase tracking-wider">
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

				<div className="bg-white rounded-3xl p-6 shadow-sm border border-gray-100 flex items-center gap-4">
					<div className="h-14 w-14 rounded-2xl bg-orange-50 text-orange-600 flex items-center justify-center">
						<Package className="h-7 w-7" />
					</div>
					<div>
						<p className="text-sm font-semibold text-gray-500 uppercase tracking-wider">
							{t("feedLevel")}
						</p>
						<p className="text-2xl font-extrabold text-[var(--ofd-base-deep)]">
							{energyDevice?.feedLevelPercent !== null &&
							energyDevice?.feedLevelPercent !== undefined
								? `${Math.round(energyDevice.feedLevelPercent)}%`
								: "—"}
						</p>
						<p className="text-xs text-gray-400 mt-0.5">{t("feedLevelDesc")}</p>
					</div>
				</div>
			</div>

			<div className="bg-white rounded-3xl shadow-sm border border-gray-100 overflow-hidden">
				<div className="p-6 border-b border-gray-100 bg-gray-50/50">
					<h3 className="font-bold text-gray-800 flex items-center gap-2">
						<CalendarDays className="h-5 w-5 text-gray-400" /> {t("eventLog")}
					</h3>
				</div>
				<FeedEventHistoryTable
					deviceIds={energyDevices.map((d) => d.id)}
					initialItems={initialPage.items}
					initialHasMore={initialPage.hasMore}
					initialNextCursor={initialPage.nextCursor}
				/>
			</div>
		</div>
	);
}
