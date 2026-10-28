import { MAX_FEED_GRAMS_PER_REQUEST } from "@/lib/limits";
import { resolveLiveFish } from "@/lib/population";
import { getPondPopulation } from "@/lib/population-server";
import prisma from "@/lib/prisma";
import { calculateNextFeeding } from "@/lib/volumeCalc";

export type GramsSyncConfig = {
	feedingRatePct?: number;
	feedsPerDay?: number;
	/** Stocked count just saved on the pond settings form (not live fish). */
	population?: number | null;
};

export interface PondFeedAmount {
	/** Per-meal grams the pond's schedule should dispense, null when not computable. */
	grams: number | null;
	/** Live fish used for the calculation (see lib/population.ts). */
	population: number | null;
	stockedCount: number | null;
	populationSource: string;
	/** Why `grams` is null — surfaced in the device event, never swallowed. */
	reason: "no_sample" | "no_population" | "invalid_result" | "over_device_limit" | null;
}

/**
 * The per-meal feed amount for a pond, from its latest biomass sample and the
 * pond's **live** fish count.
 *
 *   Daily Feed (g) = Live fish × ABW (g) × Feeding Rate (%)
 *   Feed per Meal (g) = Daily Feed (g) ÷ Feeds Per Day   (2 decimals)
 *
 * One implementation for the dashboard, the schedule save and the device sync:
 * `syncDeviceGramsForPond` writes this value and the schedule action validates
 * this value, so what is checked is what is dispensed.
 *
 * `config` overrides the Pond row (for callers that just saved new values). A
 * `population` override is the stocked count the farmer just entered; the
 * active cycle's survival still applies on top of it.
 *
 * Returns `null` only when the pond does not exist. An unknown population or
 * sample yields `grams: null` with a reason — never a default fish count.
 */
export async function computePondFeedAmount(
	pondId: string,
	config?: GramsSyncConfig,
): Promise<PondFeedAmount | null> {
	const pond = await prisma.pond.findUnique({
		where: { id: pondId },
		select: { feedingRatePct: true, feedsPerDay: true },
	});
	if (!pond) return null;

	const context = await getPondPopulation(pondId);
	const live =
		config?.population === undefined
			? context
			: resolveLiveFish({
					stockedCount: config.population,
					expectedSurvivalPct: context.survivalPct,
					mortalityCount: null,
				});

	const base = {
		population: live.liveFish,
		stockedCount: live.stockedCount,
		populationSource: live.source,
	};

	const latestBiomass = await prisma.biomassLog.findFirst({
		where: { pondId },
		orderBy: { recordedAt: "desc" },
		select: { avgWeightKg: true },
	});
	if (!latestBiomass) return { ...base, grams: null, reason: "no_sample" };

	if (!live.liveFish || live.liveFish <= 0) {
		return { ...base, grams: null, reason: "no_population" };
	}

	const feedingRatePct = config?.feedingRatePct ?? pond.feedingRatePct;
	const feedsPerDay = config?.feedsPerDay ?? pond.feedsPerDay;
	const grams = calculateNextFeeding(
		latestBiomass.avgWeightKg,
		feedingRatePct,
		feedsPerDay,
		live.liveFish,
	);

	if (grams === null || !Number.isFinite(grams) || grams <= 0) {
		return { ...base, grams: null, reason: "invalid_result" };
	}

	// A dose above the per-request server cap is not a schedule value; the
	// caller must lower the rate/meals or add feeders. Never write it silently.
	if (grams > MAX_FEED_GRAMS_PER_REQUEST) {
		return { ...base, grams: null, reason: "over_device_limit" };
	}

	return { ...base, grams, reason: null };
}

/**
 * Recomputes `energyDevice.gramsPerFeeding` for a pond from the latest biomass
 * sample — keeping the value the ESP32 dispenses in sync with the value the
 * dashboard shows.
 *
 * No-op (returns null) when the pond has no biomass sample or no live-fish
 * count; both are recorded as a device event so the farmer can see why the
 * automatic adjustment did not happen.
 */
export async function syncDeviceGramsForPond(
	pondId: string,
	config?: GramsSyncConfig,
): Promise<number | null> {
	const amount = await computePondFeedAmount(pondId, config);
	if (!amount) return null;

	if (amount.grams === null) {
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
						reason:
							amount.reason === "no_population"
								? "population not set — cannot compute biomass without a live-fish count"
								: amount.reason === "no_sample"
									? "no biomass sample yet — feed volume unchanged"
									: amount.reason === "over_device_limit"
										? `calculated feed per meal is above the ${MAX_FEED_GRAMS_PER_REQUEST} g device limit — lower the rate or add meals/feeders`
										: "calculated feed amount is not a usable number — adjust the rate or meals per day",
						pondId,
						population: amount.population,
						populationSource: amount.populationSource,
					},
				},
			});
		}
		return null;
	}

	await prisma.energyDevice.updateMany({
		where: { pondId },
		data: { gramsPerFeeding: amount.grams },
	});

	return amount.grams;
}
