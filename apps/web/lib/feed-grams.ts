import { feedPerMealG, liveFishCount, totalBiomassG } from "@/lib/feed-calc";
import prisma from "@/lib/prisma";

export type GramsSyncConfig = {
	feedingRatePct?: number;
	feedsPerDay?: number;
	population?: number | null;
};

/**
 * Recomputes `energyDevice.gramsPerFeeding` for a pond from the latest biomass
 * sample — keeping the value the ESP32 dispenses in sync with the value the
 * dashboard shows:
 *
 *   Live fish      = population × expected survival %  (lib/feed-calc.ts)
 *   Daily Feed (g) = Total Biomass (g) × Feeding Rate (%)
 *   Feed per Meal (g) = Daily Feed (g) ÷ Feeds Per Day   (2 decimals)
 *
 * The population comes from the active crop cycle when the pond row has none,
 * and its mortality allowance (`expectedSurvivalPct`) is applied either way, so
 * a 300-fish pond at 95 % survival feeds 285 fish, as the team's data sheet
 * does. `config` overrides the Pond row (for callers that just saved new
 * values). No-op (returns null) when no live count or biomass sample exists.
 */
export async function syncDeviceGramsForPond(
	pondId: string,
	config?: GramsSyncConfig,
): Promise<number | null> {
	const pond = await prisma.pond.findUnique({
		where: { id: pondId },
		select: {
			feedingRatePct: true,
			feedsPerDay: true,
			population: true,
			cropCycles: {
				where: { status: "ACTIVE" },
				orderBy: { createdAt: "desc" },
				take: 1,
				select: { stockingCount: true, expectedSurvivalPct: true },
			},
		},
	});
	if (!pond) return null;

	const latestBiomass = await prisma.biomassLog.findFirst({
		where: { pondId },
		orderBy: { recordedAt: "desc" },
		select: { avgWeightKg: true },
	});
	if (!latestBiomass) return null;

	const cycle = pond.cropCycles?.[0] ?? null;
	const population = config?.population !== undefined ? config.population : pond.population;
	const fishCount =
		typeof population === "number" && population > 0 ? population : (cycle?.stockingCount ?? null);
	const liveCount = liveFishCount(fishCount, cycle?.expectedSurvivalPct ?? null);

	if (liveCount === null) {
		const device = await prisma.energyDevice.findFirst({
			where: { pondId },
			select: { id: true },
		});
		if (device) {
			await prisma.deviceStateEvent.create({
				data: {
					deviceId: device.id,
					eventType: "auto_adjust_skipped",
					source: "system",
					metadata: {
						reason: "population not set — cannot compute biomass without a fish count",
						pondId,
						avgWeightKg: latestBiomass.avgWeightKg,
					},
				},
			});
		}
		return null;
	}

	const grams = feedPerMealG(
		totalBiomassG(liveCount, latestBiomass.avgWeightKg),
		config?.feedingRatePct ?? pond.feedingRatePct,
		config?.feedsPerDay ?? pond.feedsPerDay,
	);

	await prisma.energyDevice.updateMany({
		where: { pondId },
		data: { gramsPerFeeding: grams },
	});

	return grams;
}
