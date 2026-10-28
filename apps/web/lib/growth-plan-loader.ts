import { DEFAULT_FISH_COUNT } from "@/lib/constants";
import { dateToFarmDateOnly, todayDateOnly } from "@/lib/crop-cycle/dates";
import { type GrowthPlan, buildGrowthPlan } from "@/lib/growth-plan";
import { parsePondProfile } from "@/lib/pond-profile";
import { predictionUpperBound } from "@/lib/prediction";
import prisma from "@/lib/prisma";
import { resolveCurrentSchedule } from "@/lib/schedule/resolve-current";

export interface LoadedGrowthPlan {
	plan: GrowthPlan;
	pondId: string;
	pondName: string;
	deviceId: string | null;
	cycleId: string | null;
	canApply: boolean;
}

/**
 * Load everything the target-weight plan needs and build it with the pure
 * engine. Server-only; used by the Growth page, the assistant context and the
 * apply action so all three see the same numbers.
 */
export async function loadGrowthPlanForPond(
	pondId: string,
	options: { ownerId?: string } = {},
): Promise<LoadedGrowthPlan | null> {
	const pond = await prisma.pond.findFirst({
		where: { id: pondId, ...(options.ownerId ? { ownerId: options.ownerId } : {}) },
		select: {
			id: true,
			name: true,
			population: true,
			feedingRatePct: true,
			feedsPerDay: true,
			isFallow: true,
			notificationPrefs: true,
		},
	});
	if (!pond) return null;

	const [activeCycle, latestSamples, energyDevice, latestFcr] = await Promise.all([
		prisma.cropCycle.findFirst({
			where: { pondId, status: "ACTIVE" },
			select: {
				id: true,
				label: true,
				stockingDate: true,
				stockingCount: true,
				stockingAvgWeightG: true,
				growOutDays: true,
				targetHarvestDate: true,
				targetHarvestWeightG: true,
				expectedSurvivalPct: true,
			},
		}),
		prisma.biomassLog.findMany({
			where: { pondId },
			orderBy: [{ recordedAt: "desc" }, { id: "desc" }],
			take: 2,
			select: {
				id: true,
				recordedAt: true,
				avgWeightKg: true,
				sampleCount: true,
			},
		}),
		prisma.energyDevice.findFirst({
			where: { pondId },
			orderBy: { createdAt: "asc" },
			select: {
				id: true,
				gramsPerFeeding: true,
				hopperCapacityG: true,
				dailyCapG: true,
			},
		}),
		prisma.fcrReport.findFirst({
			where: { pondId },
			orderBy: { periodEnd: "desc" },
			select: { fcrValue: true },
		}),
	]);

	const currentConfig = await resolveCurrentSchedule(pondId, energyDevice?.id ?? null);
	const recentAdjustments = energyDevice
		? await prisma.deviceStateEvent.findMany({
				where: { deviceId: energyDevice.id, eventType: "growth_plan_applied" },
				orderBy: { createdAt: "desc" },
				take: 20,
				select: { createdAt: true, metadata: true },
			})
		: [];
	const lastAdjustment = activeCycle
		? (recentAdjustments.find((event) => {
				const metadata = event.metadata;
				return (
					metadata !== null &&
					typeof metadata === "object" &&
					!Array.isArray(metadata) &&
					(metadata as Record<string, unknown>).cycleId === activeCycle.id
				);
			}) ?? null)
		: null;

	const profile = parsePondProfile(pond.notificationPrefs);
	const feedsPerDay = currentConfig?.feedsPerDay ?? pond.feedsPerDay;
	const latest = latestSamples[0] ?? null;
	const previous = latestSamples[1] ?? null;

	const plan = buildGrowthPlan({
		cycle: activeCycle
			? {
					id: activeCycle.id,
					label: activeCycle.label,
					stockingDate: activeCycle.stockingDate.toISOString().slice(0, 10),
					stockingCount: activeCycle.stockingCount,
					stockingAvgWeightG: activeCycle.stockingAvgWeightG,
					growOutDays: activeCycle.growOutDays,
					targetHarvestDate: activeCycle.targetHarvestDate.toISOString().slice(0, 10),
					targetHarvestWeightG: activeCycle.targetHarvestWeightG,
					expectedSurvivalPct: activeCycle.expectedSurvivalPct,
				}
			: null,
		latestSample: latest
			? {
					id: latest.id,
					date: dateToFarmDateOnly(latest.recordedAt),
					avgWeightG: latest.avgWeightKg * 1000,
					sampleCount: latest.sampleCount,
				}
			: null,
		previousSample: previous
			? {
					id: previous.id,
					date: dateToFarmDateOnly(previous.recordedAt),
					avgWeightG: previous.avgWeightKg * 1000,
					sampleCount: previous.sampleCount,
				}
			: null,
		population: activeCycle?.stockingCount ?? pond.population ?? DEFAULT_FISH_COUNT,
		feedingRatePct: currentConfig?.feedingRatePct ?? pond.feedingRatePct,
		feedsPerDay,
		currentGramsPerFeeding: energyDevice?.gramsPerFeeding ?? null,
		deviceMaxGramsPerFeeding: predictionUpperBound(
			feedsPerDay,
			energyDevice?.hopperCapacityG ?? null,
			energyDevice?.dailyCapG ?? null,
		),
		hasDevice: Boolean(energyDevice),
		latestFcr: latestFcr?.fcrValue ?? null,
		lastAdjustmentAt: lastAdjustment ? dateToFarmDateOnly(lastAdjustment.createdAt) : null,
		today: todayDateOnly(),
		pond: {
			areaM2: profile.areaM2,
			averageDepthM: profile.averageDepthM,
			feedPricePerKg: profile.feedPricePerKg,
		},
		currency: "PHP",
	});

	return {
		plan,
		pondId: pond.id,
		pondName: pond.name,
		deviceId: energyDevice?.id ?? null,
		cycleId: activeCycle?.id ?? null,
		canApply: Boolean(energyDevice && activeCycle),
	};
}
