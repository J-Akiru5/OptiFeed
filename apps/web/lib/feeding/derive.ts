import { resolveDailyCapG } from "@/lib/limits-core";
import prisma from "@/lib/prisma";
import { getFeedingLimits } from "@/lib/settings/feeding-caps";
import { detectDoseViolation, maxDosePerMealG } from "@/lib/settings/pond-conflicts";
import { calculateNextFeeding } from "@/lib/volumeCalc";

/**
 * The one place that writes `EnergyDevice.gramsPerFeeding` from pond settings
 * (Amendment A-001, D6).
 *
 * Every caller that changes the feeding configuration — pond settings, a
 * biomass sample, a growth-plan adjustment, or an explicit resync — ends here,
 * so the website and the feeder always show the same formula result. Nothing
 * else may write the column.
 *
 * Issue #430: the dose is checked against the feeder's real limits *before* it
 * is written. The write paths used to check the dose that was stored and then
 * write a newly derived one, so a dose the feeder cannot run in one relay
 * window still reached it — and the pond settings then refused every later
 * edit, because the saved plan was already impossible.
 */
export interface DeriveOverrides {
	feedingRatePct?: number;
	feedsPerDay?: number;
	population?: number | null;
}

export type DeriveStatus =
	| "ready"
	| "updated"
	| "no_pond"
	| "no_device"
	| "no_biomass"
	| "no_population"
	| "invalid"
	| "exceeds_relay_time"
	| "exceeds_daily_ceiling";

export interface DeriveResult {
	status: DeriveStatus;
	/** The dose per meal; null when no dose could be derived. */
	grams: number | null;
	/** The daily total that dose would schedule. */
	dailyG: number | null;
	/** The biggest dose the feeder can run in one meal. */
	maxDoseG: number | null;
	/** The effective daily ceiling. */
	dailyCapG: number | null;
}

const EMPTY: Pick<DeriveResult, "grams" | "dailyG" | "maxDoseG" | "dailyCapG"> = {
	grams: null,
	dailyG: null,
	maxDoseG: null,
	dailyCapG: null,
};

/**
 * Work out the dose the feeder would run, and whether it can run it.
 *
 * This writes nothing. The caller decides what to do with the answer, so a
 * path that creates a command can refuse *before* it creates anything.
 */
export async function resolveDeviceDose(
	pondId: string,
	overrides?: DeriveOverrides,
): Promise<DeriveResult> {
	const pond = await prisma.pond.findUnique({
		where: { id: pondId },
		select: { feedingRatePct: true, feedsPerDay: true, population: true },
	});
	if (!pond) return { status: "no_pond", ...EMPTY };

	const device = await prisma.energyDevice.findFirst({
		where: { pondId },
		select: { id: true, gramsPerSecond: true, dailyCapG: true, hopperCapacityG: true },
	});
	if (!device) return { status: "no_device", ...EMPTY };

	const limits = await getFeedingLimits();
	const dailyCapG = resolveDailyCapG({
		configuredCapG: device.dailyCapG,
		hopperCapacityG: device.hopperCapacityG,
		dailyCapFactor: limits.dailyCapFactor,
	});
	const maxDoseG = maxDosePerMealG({
		gramsPerSecond: device.gramsPerSecond,
		maxDispenseMs: limits.maxDispenseMs,
	});

	const latestBiomass = await prisma.biomassLog.findFirst({
		where: { pondId },
		orderBy: { recordedAt: "desc" },
		select: { avgWeightKg: true },
	});
	if (!latestBiomass) {
		return { status: "no_biomass", grams: null, dailyG: null, maxDoseG, dailyCapG };
	}

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
		return { status: "no_population", grams: null, dailyG: null, maxDoseG, dailyCapG };
	}

	const feedsPerDay = overrides?.feedsPerDay ?? pond.feedsPerDay;
	const grams = calculateNextFeeding(
		latestBiomass.avgWeightKg,
		overrides?.feedingRatePct ?? pond.feedingRatePct,
		feedsPerDay,
		population,
	);
	if (grams === null || !Number.isFinite(grams) || grams <= 0) {
		return { status: "invalid", grams: null, dailyG: null, maxDoseG, dailyCapG };
	}

	const violation = detectDoseViolation({
		grams,
		feedsPerDay,
		constraints: {
			gramsPerSecond: device.gramsPerSecond,
			maxDispenseMs: limits.maxDispenseMs,
			effectiveDailyCapG: dailyCapG,
		},
	});

	return {
		status:
			violation === "relay-time"
				? "exceeds_relay_time"
				: violation === "daily-ceiling"
					? "exceeds_daily_ceiling"
					: "ready",
		grams,
		dailyG: grams * feedsPerDay,
		maxDoseG,
		dailyCapG,
	};
}

/**
 * Resolve the dose and write it to the feeder.
 *
 * A dose that the feeder cannot run is never written: the column keeps its
 * current value and the status says which limit blocked the change, so the
 * caller can refuse with a sentence the reader can act on.
 */
export async function deriveDeviceDose(
	pondId: string,
	overrides?: DeriveOverrides,
): Promise<DeriveResult> {
	const dose = await resolveDeviceDose(pondId, overrides);
	if (dose.status !== "ready" || dose.grams === null) return dose;

	await prisma.energyDevice.updateMany({
		where: { pondId },
		data: { gramsPerFeeding: dose.grams },
	});

	return { ...dose, status: "updated" };
}
