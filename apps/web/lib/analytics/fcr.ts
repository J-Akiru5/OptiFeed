import prisma from "@/lib/prisma";

/**
 * In-app FCR (issue #453): feed conversion ratio is *computed* from the two
 * records it actually comes from — FeedEvent dispensed grams and biomass
 * samples — instead of being imported or hand-typed. Read-only: nothing here
 * writes FcrReport rows and nothing changes what the device is told to
 * dispense.
 *
 * FCR = feed given (kg) / biomass gained (kg), per pond and per cycle.
 *
 * Biomass gained is derived from the same stock the live count uses: the fl01
 * sampling's average fish weight times the stocking count, minus the latest
 * sample's average weight times the current live count (the live count derives
 * from the mortality log exactly like lib/growth/live-count.ts). When either
 * side is missing the ratio is not computable and `undefined` is returned; the
 * page falls back to stored FcrReport rows so old ponds keep showing a tile.
 */

export interface CycleWindow {
	/** Cycle the window belongs to; null when computed "overall" (all history). */
	cycleId: string | null;
	/** Inclusive window start; null means beginning of the pond's history. */
	from: Date | null;
	/** Inclusive window end; null means now. */
	to: Date | null;
}

export interface FcrComputation {
	/** Feed dispensed inside the window, in kilograms. */
	feedGivenKg: number;
	/** Live biomass gained inside the window, in kilograms. */
	biomassGainKg: number;
	/** FCR = feed / gain; null when biomass gain is zero (no mass gained). */
	fcr: number | null;
}

export interface StockSource {
	/** Fish stocked (cycle stock count or the legacy hand-typed population). */
	stocked: number;
	/** Fish alive now (derived live count clamped at zero). */
	live: number;
}

/**
 * Pure calculation for the fixed-data tests: the first/last average weights are
 * passed in so the caller controls what "first" means (cycle window or overall
 * history) and the function stays deterministic.
 */
export function computeFcr(
	feedGivenKg: number,
	first: { avgWeightKg: number; count: number } | null,
	last: { avgWeightKg: number; count: number } | null,
): FcrComputation {
	const feed = Math.max(0, feedGivenKg);
	if (!first || !last) {
		return { feedGivenKg: feed, biomassGainKg: 0, fcr: null };
	}
	const startKg = Math.max(0, first.avgWeightKg) * Math.max(0, first.count);
	const endKg = Math.max(0, last.avgWeightKg) * Math.max(0, last.count);
	// Mortality rows double-populate a shrinking pond, so a loss is still a
	// "gain" of zero, never negative biomass used to flatter the ratio.
	const biomassGainKg = Math.max(0, endKg - startKg);
	const fcr = biomassGainKg > 0 ? feed / biomassGainKg : null;
	return { feedGivenKg: feed, biomassGainKg, fcr };
}

/**
 * Feed actually given inside one window: the sum of FeedEvent grams from
 * feed_dispensed events (deprecated FeedingEvent rows are not counted — those
 * are no longer written).
 */
export async function feedGivenKgInWindow(
	pondId: string,
	window: { from: Date | null; to: Date | null },
): Promise<number> {
	const devices = await prisma.energyDevice.findMany({
		where: { pondId },
		select: { id: true },
	});
	if (devices.length === 0) return 0;

	const aggregate = await prisma.feedEvent.aggregate({
		where: {
			deviceId: { in: devices.map((device) => device.id) },
			eventType: "feed_dispensed",
			grams: { not: null },
			...(window.from || window.to
				? {
						receivedAt: {
							...(window.from ? { gte: window.from } : {}),
							...(window.to ? { lte: window.to } : {}),
						},
					}
				: {}),
		},
		_sum: { grams: true },
	});
	return Math.max(0, aggregate._sum.grams ?? 0) / 1000;
}

/**
 * First and last biomass samples inside a window (ascending by recordedAt).
 */
export async function biomassSamplesInWindow(
	pondId: string,
	window: { from: Date | null; to: Date | null },
): Promise<{ avgWeightKg: number; count: number; recordedAt: Date }[]> {
	const logs = await prisma.biomassLog.findMany({
		where: {
			pondId,
			...(window.from || window.to
				? {
						recordedAt: {
							...(window.from ? { gte: window.from } : {}),
							...(window.to ? { lte: window.to } : {}),
						},
					}
				: {}),
		},
		orderBy: { recordedAt: "asc" },
		select: { avgWeightKg: true, sampleCount: true, recordedAt: true },
	});
	return logs.map((log) => ({
		avgWeightKg: log.avgWeightKg,
		count: log.sampleCount,
		recordedAt: log.recordedAt,
	}));
}

/**
 * The stock window: the pond's active cycle, else null ("overall history",
 * legacy keep-working path that uses the stored FcrReport rows on the page).
 */
export async function activeWindowForPond(pondId: string): Promise<CycleWindow> {
	const cycle = await prisma.cropCycle.findFirst({
		where: { pondId, status: "ACTIVE" },
		select: { id: true, stockingDate: true, actualHarvestDate: true },
	});
	if (!cycle) {
		return { cycleId: null, from: null, to: null };
	}
	return {
		cycleId: cycle.id,
		from: cycle.stockingDate,
		to: cycle.actualHarvestDate ?? null,
	};
}
