import prisma from "@/lib/prisma";
import { resolveCurrentSchedule } from "@/lib/schedule/resolve-current";

export interface ChatContext {
	pondName: string;
	feedsPerDay: number;
	feedingRatePct: number;
	scheduleStart: Date;
	scheduleEnd: Date;
	deviceOnline: boolean;
	devicePaused: boolean;
	hopperLevelPct: number | null;
	waterTempC: number | null;
	waterTempOk: boolean;
	latestFcr: number | null;
	latestAbwG: number | null;
	sampleCount: number | null;
	feedingsToday: number;
	lastDispensedAt: Date | null;
	lastCommandStatus: string | null;
}

// Builds the live pond context used for the AI prompt. `pond.*` goes stale when
// a device is paired (saves queue ScheduleCommands), so the schedule/rate comes
// from resolveCurrentSchedule instead of the raw Pond row.
export async function buildChatContext(ownerId: string): Promise<ChatContext | null> {
	const pond = await prisma.pond.findFirst({
		where: { ownerId },
		include: { devices: true },
	});

	if (!pond) return null;

	const energyDevice = await prisma.energyDevice.findFirst({
		where: { pondId: pond.id },
		orderBy: { createdAt: "asc" },
		select: {
			id: true,
			isPaused: true,
			feedLevelPercent: true,
			waterTempC: true,
			waterTempOk: true,
			lastSeenAt: true,
		},
	});

	const currentConfig = await resolveCurrentSchedule(pond.id, energyDevice?.id ?? null);

	const startOfToday = new Date();
	startOfToday.setHours(0, 0, 0, 0);

	const [todayFeedEvents, latestFcr, latestBiomass, latestCommand] = await Promise.all([
		energyDevice
			? prisma.feedEvent.findMany({
					where: {
						deviceId: energyDevice.id,
						eventType: "feed_dispensed",
						receivedAt: { gte: startOfToday },
					},
					orderBy: { receivedAt: "desc" },
					select: { receivedAt: true },
				})
			: Promise.resolve([] as { receivedAt: Date }[]),
		prisma.fcrReport.findFirst({
			where: { pondId: pond.id },
			orderBy: { periodEnd: "desc" },
		}),
		prisma.biomassLog.findFirst({
			where: { pondId: pond.id },
			orderBy: { recordedAt: "desc" },
		}),
		energyDevice
			? prisma.scheduleCommand.findFirst({
					where: { deviceId: energyDevice.id },
					orderBy: { createdAt: "desc" },
					select: { status: true },
				})
			: Promise.resolve(null),
	]);

	const OFFLINE_THRESHOLD_MS = 15 * 60 * 1000;
	const now = Date.now();
	const deviceOnline =
		!!energyDevice?.lastSeenAt && now - energyDevice.lastSeenAt.getTime() <= OFFLINE_THRESHOLD_MS;

	return {
		pondName: pond.name
			.replace(/[\r\n]+/g, " ")
			.trim()
			.slice(0, 100),
		feedsPerDay: currentConfig?.feedsPerDay ?? pond.feedsPerDay,
		feedingRatePct: currentConfig?.feedingRatePct ?? pond.feedingRatePct,
		scheduleStart: currentConfig?.scheduleStart ?? pond.scheduleStart,
		scheduleEnd: currentConfig?.scheduleEnd ?? pond.scheduleEnd,
		deviceOnline,
		devicePaused: energyDevice?.isPaused ?? false,
		hopperLevelPct: energyDevice?.feedLevelPercent ?? null,
		waterTempC: energyDevice?.waterTempC ?? null,
		waterTempOk: energyDevice?.waterTempOk ?? false,
		latestFcr: latestFcr?.fcrValue ?? null,
		latestAbwG: latestBiomass ? latestBiomass.avgWeightKg * 1000 : null,
		sampleCount: latestBiomass?.sampleCount ?? null,
		feedingsToday: todayFeedEvents.length,
		lastDispensedAt: todayFeedEvents[0]?.receivedAt ?? null,
		lastCommandStatus: latestCommand?.status ?? null,
	};
}
