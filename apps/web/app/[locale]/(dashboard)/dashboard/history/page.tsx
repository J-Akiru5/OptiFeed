import { formatDateTimeLocal } from "@/lib/date-local";
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
	const tDates = await getTranslations("dates");
	const pond = await prisma.pond.findFirst({
		where: { ownerId: "demo-farmer-1" },
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
	const events = await prisma.feedEvent.findMany({
		where: {
			deviceId: { in: energyDevices.map((d) => d.id) },
			eventType: "feed_dispensed",
		},
		orderBy: { receivedAt: "desc" },
		take: 50,
	});

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

	// Use next-intl for localization
	const formatDate = (date: Date) => {
		return formatDateTimeLocal(date, tDates).fullDate;
	};

	const formatTime = (date: Date) => {
		return formatDateTimeLocal(date, tDates).time;
	};

	return (
		<div className="space-y-8 pb-20 animate-in fade-in duration-500">
			<header>
				<h1 className="text-3xl font-extrabold tracking-tight text-[var(--ofd-base-deep)]">
					{t("title")}
				</h1>
				<p className="text-gray-500 mt-1">{t("desc", { pond: pond.name })}</p>
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
				<div className="divide-y divide-gray-100">
					{events.map((event) => (
						<div
							key={event.id}
							className="p-4 sm:p-6 flex items-center justify-between hover:bg-gray-50 transition-colors"
						>
							<div className="flex items-center gap-4">
								<div className="h-10 w-10 rounded-full bg-green-100 text-green-600 flex items-center justify-center">
									<CheckCircle2 className="h-5 w-5" />
								</div>
								<div>
									<p className="font-semibold text-gray-900">{formatDate(event.receivedAt)}</p>
									<p className="font-semibold text-gray-900 flex items-center gap-2">
										<span className="text-xs font-medium px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 flex items-center gap-1">
											<Clock className="h-3 w-3" /> {formatTime(event.receivedAt)}
										</span>
									</p>
									<p className="text-sm text-gray-500 mt-0.5">
										{event.source ? sourceLabel(event.source) : t("confirmedDispense")}
									</p>
								</div>
							</div>
							<div className="text-right">
								<p className="font-bold text-gray-900">{event.grams ?? 0}g</p>
							</div>
						</div>
					))}

					{events.length === 0 && (
						<div className="p-10 text-center text-gray-500">{t("noEvents")}</div>
					)}
				</div>
			</div>
		</div>
	);
}
