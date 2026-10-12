import prisma from "@/lib/prisma";
import { calculateNextFeeding } from "@/lib/volumeCalc";

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
 *   Daily Feed (g) = Total Biomass (g) × Feeding Rate (%)
 *   Feed per Meal (g) = Daily Feed (g) ÷ Feeds Per Day   (2 decimals)
 *
 * `config` overrides the Pond row (for callers that just saved new values).
 * No-op (returns null) when the pond has no biomass sample yet.
 */
export async function syncDeviceGramsForPond(
	pondId: string,
	config?: GramsSyncConfig,
): Promise<number | null> {
	const pond = await prisma.pond.findUnique({
		where: { id: pondId },
		select: { feedingRatePct: true, feedsPerDay: true, population: true },
	});
	if (!pond) return null;

	const latestBiomass = await prisma.biomassLog.findFirst({
		where: { pondId },
		orderBy: { recordedAt: "desc" },
		select: { avgWeightKg: true },
	});
	if (!latestBiomass) return null;

	const grams = calculateNextFeeding(
		latestBiomass.avgWeightKg,
		config?.feedingRatePct ?? pond.feedingRatePct,
		config?.feedsPerDay ?? pond.feedsPerDay,
		config?.population !== undefined ? config.population : pond.population,
	);

	await prisma.energyDevice.updateMany({
		where: { pondId },
		data: { gramsPerFeeding: grams },
	});

	return grams;
}
