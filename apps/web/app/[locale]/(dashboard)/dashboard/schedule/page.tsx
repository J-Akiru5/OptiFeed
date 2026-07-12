import { ScheduleControls } from "@/components/ScheduleControls";
import prisma from "@/lib/prisma";
import { Calendar, Clock, Droplets } from "lucide-react";
import { getTranslations } from "next-intl/server";

export const revalidate = 0;

export default async function SchedulePage() {
	const t = await getTranslations("dashboard.schedule");
	const pond = await prisma.pond.findFirst({
		where: { ownerId: "demo-farmer-1" },
		include: { devices: true },
	});

	if (!pond || !pond.devices.length) {
		return (
			<div className="flex h-[50vh] items-center justify-center">
				<p className="text-lg text-gray-500">{t("noPondData")}</p>
			</div>
		);
	}

	const device = pond.devices[0];

	const energyDevice = await prisma.energyDevice.findFirst({
		where: { pondId: pond.id },
		orderBy: { createdAt: "asc" },
	});

	// Helper to format Prisma DateTime to a readable time (HH:MM AM/PM)
	const formatTime = (date: Date) => {
		return new Intl.DateTimeFormat("en-US", {
			hour: "numeric",
			minute: "2-digit",
			hour12: true,
		}).format(date);
	};

	return (
		<div className="space-y-8 max-w-5xl">
			<div>
				<h1 className="text-3xl font-bold text-[var(--ofd-base)]">{t("title")}</h1>
				<p className="mt-2 text-gray-700">{t("desc")}</p>
			</div>

			{/* Interactive Controls (Client Component) */}
			<ScheduleControls
				deviceId={energyDevice?.id ?? device.id}
				initialIsPaused={device.isPaused}
			/>

			{/* Read-Only Schedule Details */}
			<div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
				<div className="border-b border-gray-100 bg-gray-50/50 px-6 py-4">
					<h3 className="font-semibold text-gray-900">{t("configTitle")}</h3>
				</div>
				<div className="p-6 grid grid-cols-1 md:grid-cols-3 gap-6">
					{/* Active Window */}
					<div className="flex items-start gap-4">
						<div className="bg-blue-50 p-3 rounded-lg text-blue-600">
							<Clock size={24} />
						</div>
						<div>
							<p className="text-sm text-gray-500 font-medium mb-1">{t("activeWindow")}</p>
							<p className="text-gray-900 font-semibold text-lg">
								{formatTime(pond.scheduleStart)} - {formatTime(pond.scheduleEnd)}
							</p>
							<p className="text-xs text-gray-400 mt-1">{t("activeWindowDesc")}</p>
						</div>
					</div>

					{/* Feeds Per Day */}
					<div className="flex items-start gap-4">
						<div className="bg-purple-50 p-3 rounded-lg text-purple-600">
							<Calendar size={24} />
						</div>
						<div>
							<p className="text-sm text-gray-500 font-medium mb-1">{t("frequency")}</p>
							<p className="text-gray-900 font-semibold text-lg">
								{t("timesPerDay", { count: pond.feedsPerDay })}
							</p>
							<p className="text-xs text-gray-400 mt-1">{t("frequencyDesc")}</p>
						</div>
					</div>

					{/* Feeding Rate */}
					<div className="flex items-start gap-4">
						<div className="bg-emerald-50 p-3 rounded-lg text-emerald-600">
							<Droplets size={24} />
						</div>
						<div>
							<p className="text-sm text-gray-500 font-medium mb-1">{t("feedRateTitle")}</p>
							<p className="text-gray-900 font-semibold text-lg">{pond.feedingRatePct}%</p>
							<p className="text-xs text-gray-400 mt-1">{t("feedRateDesc")}</p>
						</div>
					</div>
				</div>
			</div>
		</div>
	);
}
