import prisma from "@/lib/prisma";
import { calculateNextFeeding } from "@/lib/volumeCalc";

/**
 * The one place that writes `EnergyDevice.gramsPerFeeding` from pond settings
 * (Amendment A-001, D6).
 *
 * Every caller that changes the feeding configuration — pond settings, a
 * biomass sample, a growth-plan adjustment, or an explicit resync — ends here,
 * so the website and the feeder always show the same formula result. Nothing
 * else may write the column.
 */
export interface DeriveOverrides {
	feedingRatePct?: number;
	feedsPerDay?: number;
	population?: number | null;
}

export type DeriveStatus =
	| "updated"
	| "no_pond"
	| "no_device"
	| "no_biomass"
	| "no_population"
	| "invalid";

export interface DeriveResult {
	status: DeriveStatus;
	grams: number | null;
}

export async function deriveDeviceDose(
	pondId: string,
	overrides?: DeriveOverrides,
): Promise<DeriveResult> {
	const pond = await prisma.pond.findUnique({
		where: { id: pondId },
		select: { feedingRatePct: true, feedsPerDay: true, population: true },
	});
	if (!pond) return { status: "no_pond", grams: null };

	const device = await prisma.energyDevice.findFirst({
		where: { pondId },
		select: { id: true },
	});
	if (!device) return { status: "no_device", grams: null };

	const latestBiomass = await prisma.biomassLog.findFirst({
		where: { pondId },
		orderBy: { recordedAt: "desc" },
		select: { avgWeightKg: true },
	});
	if (!latestBiomass) return { status: "no_biomass", grams: null };

	const population = overrides?.population !== undefined ? overrides.population : pond.population;
	if (!population || population <= 0) {
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
		return { status: "no_population", grams: null };
	}

	const grams = calculateNextFeeding(
		latestBiomass.avgWeightKg,
		overrides?.feedingRatePct ?? pond.feedingRatePct,
		overrides?.feedsPerDay ?? pond.feedsPerDay,
		population,
	);
	if (grams === null || !Number.isFinite(grams) || grams <= 0) {
		return { status: "invalid", grams: null };
	}

	await prisma.energyDevice.updateMany({
		where: { pondId },
		data: { gramsPerFeeding: grams },
	});

	return { status: "updated", grams };
}
