import { type CalibrationDriftResult, computeCalibrationDrift } from "@/lib/calibration/drift";
import { loadCalibrationDriftWindow } from "@/lib/calibration/drift-data";
import { startOfDayInTimeZone } from "@/lib/chart-windows";
import { DEFAULT_FISH_COUNT, OFFLINE_THRESHOLD_MS, PH_TZ } from "@/lib/constants";
import { todayDateOnly } from "@/lib/crop-cycle/dates";
import { toPredictionCycleContext } from "@/lib/crop-cycle/prediction-context";
import { totalBiomassG } from "@/lib/feed-calc";
import { MACHINE_FEED_SOURCES } from "@/lib/feed-figures";
import type { GrowthPlan } from "@/lib/growth-plan";
import { loadGrowthPlanForPond } from "@/lib/growth-plan-loader";
import { computeDeterministicPrediction } from "@/lib/prediction";
import prisma from "@/lib/prisma";
import { resolveCurrentSchedule } from "@/lib/schedule/resolve-current";

export interface ChatContext {
	pondName: string;
	feedsPerDay: number;
	feedingRatePct: number;
	population: number;
	totalBiomassG: number | null;
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
	currentGramsPerFeeding: number | null;
	predictedFeedGrams: number | null;
	predictedFeedReasoning: string | null;
	lastSampleAt: Date | null;
	isFallow: boolean;
	cycleLabel: string | null;
	growOutDay: number | null;
	daysToHarvest: number | null;
	targetHarvestDate: string | null;
	targetHarvestWeightG: number | null;
	growthPlan: GrowthPlan | null;
	/** Rule-based drift check from the last 7 days (issue #191, E8). */
	calibrationDrift: CalibrationDriftResult;
}

// Builds the live pond context used for the AI prompt. `pond.*` goes stale when
// a device is paired (saves queue ScheduleCommands), so the schedule/rate comes
// from resolveCurrentSchedule instead of the raw Pond row.
export async function buildChatContext(ownerId: string): Promise<ChatContext | null> {
	const pond = await prisma.pond.findFirst({
		where: { ownerId, status: "ACTIVE" },
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
			gramsPerFeeding: true,
			hopperCapacityG: true,
		},
	});

	const currentConfig = await resolveCurrentSchedule(pond.id, energyDevice?.id ?? null);

	// "Today" is the farm day (Asia/Manila), not the server runtime's day. On a
	// UTC host the local midnight is 08:00 in Manila, which dropped every
	// early-morning feeding from the count the assistant reports.
	const startOfToday = startOfDayInTimeZone(new Date(), PH_TZ);

	const [todayFeedEvents, latestFcr, latestBiomass, latestCommand, activeCycle, driftWindow] =
		await Promise.all([
			energyDevice
				? prisma.feedEvent.findMany({
						where: {
							deviceId: energyDevice.id,
							eventType: "feed_dispensed",
							// "Feedings today" counts device feedings; an imported
							// hand-fed daily total is one record, not a feeding slot.
							source: { in: [...MACHINE_FEED_SOURCES] },
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
			prisma.cropCycle.findFirst({
				where: { pondId: pond.id, status: "ACTIVE" },
				select: {
					id: true,
					label: true,
					stockingDate: true,
					stockingCount: true,
					growOutDays: true,
					targetHarvestDate: true,
					targetHarvestWeightG: true,
					expectedSurvivalPct: true,
				},
			}),
			// One loader owns the drift window (device dispenses only, no hand_fed).
			energyDevice
				? loadCalibrationDriftWindow(energyDevice.id)
				: Promise.resolve({ feeds: [], levels: [], start: new Date() }),
		]);

	const calibrationDrift = computeCalibrationDrift({
		feeds: driftWindow.feeds,
		levels: driftWindow.levels,
		hopperCapacityG: energyDevice?.hopperCapacityG ?? null,
	});

	const now = Date.now();
	const deviceOnline =
		!!energyDevice?.lastSeenAt && now - energyDevice.lastSeenAt.getTime() <= OFFLINE_THRESHOLD_MS;

	// Deterministic feeding prediction (no AI call — keeps chat fast and free).
	const latestFcrValue = latestFcr?.fcrValue ?? null;
	const cycleContext = activeCycle ? toPredictionCycleContext(activeCycle, todayDateOnly()) : null;
	const prediction = computeDeterministicPrediction({
		feedingRatePct: currentConfig?.feedingRatePct ?? pond.feedingRatePct,
		feedsPerDay: currentConfig?.feedsPerDay ?? pond.feedsPerDay,
		population: pond.population ?? DEFAULT_FISH_COUNT,
		avgWeightKg: latestBiomass?.avgWeightKg ?? null,
		latestFcr: latestFcrValue,
		currentGrams: energyDevice?.gramsPerFeeding ?? null,
		hopperCapacityG: null,
		lastSampleAt: latestBiomass?.recordedAt ?? null,
		isFallow: pond.isFallow,
		cycle: cycleContext,
	});

	const loadedPlan = await loadGrowthPlanForPond(pond.id, { ownerId });

	return {
		pondName: pond.name
			.replace(/[\r\n]+/g, " ")
			.trim()
			.slice(0, 100),
		feedsPerDay: currentConfig?.feedsPerDay ?? pond.feedsPerDay,
		feedingRatePct: currentConfig?.feedingRatePct ?? pond.feedingRatePct,
		population: pond.population ?? DEFAULT_FISH_COUNT,
		totalBiomassG: latestBiomass ? totalBiomassG(pond.population, latestBiomass.avgWeightKg) : null,
		scheduleStart: currentConfig?.scheduleStart ?? pond.scheduleStart,
		scheduleEnd: currentConfig?.scheduleEnd ?? pond.scheduleEnd,
		deviceOnline,
		devicePaused: energyDevice?.isPaused ?? false,
		hopperLevelPct: energyDevice?.feedLevelPercent ?? null,
		waterTempC: energyDevice?.waterTempC ?? null,
		waterTempOk: energyDevice?.waterTempOk ?? false,
		latestFcr: latestFcrValue,
		latestAbwG: latestBiomass ? latestBiomass.avgWeightKg * 1000 : null,
		sampleCount: latestBiomass?.sampleCount ?? null,
		feedingsToday: todayFeedEvents.length,
		lastDispensedAt: todayFeedEvents[0]?.receivedAt ?? null,
		lastCommandStatus: latestCommand?.status ?? null,
		currentGramsPerFeeding: energyDevice?.gramsPerFeeding ?? null,
		predictedFeedGrams: prediction.grams,
		predictedFeedReasoning: prediction.grams !== null ? prediction.reasoning : null,
		lastSampleAt: latestBiomass?.recordedAt ?? null,
		isFallow: pond.isFallow,
		cycleLabel: cycleContext?.label ?? null,
		growOutDay: cycleContext?.growOutDay ?? null,
		daysToHarvest: cycleContext?.daysToHarvest ?? null,
		targetHarvestDate: cycleContext?.targetHarvestDate ?? null,
		targetHarvestWeightG: cycleContext?.targetHarvestWeightG ?? null,
		growthPlan: loadedPlan?.plan ?? null,
		calibrationDrift,
	};
}
