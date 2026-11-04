import { getLiveCountForPond } from "@/lib/growth/live-count";
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
 * side is missing the ratio is not computable from the current window.
 *
 * Issue #875: a stored FcrReport row may still be shown when the current window
 * cannot be computed, but it is *never* presented as measured. Its coverage is
 * derived at read time from the FeedEvent and BiomassLog rows in the same
 * period, and the row is labelled unverified with a reason when the logs cannot
 * reproduce it. Stored rows are never rewritten or deleted. This module is the
 * single source of truth for both the computation and that provenance decision.
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
 * The one derivation every surface uses: the window's first sampling starts the
 * biomass baseline at the stocked count, the last sampling closes it at the live
 * count. Keeping this here means the growth page and the feed calculator cannot
 * disagree about what "computed FCR" means.
 */
export function computeFcrFromLogs(
	feedGivenKg: number,
	samples: readonly { avgWeightKg: number }[],
	stock: { stocked: number | null; live: number | null },
): FcrComputation {
	const first = samples[0];
	const last = samples[samples.length - 1];
	return computeFcr(
		feedGivenKg,
		first && stock.stocked !== null
			? { avgWeightKg: first.avgWeightKg, count: stock.stocked }
			: null,
		last && stock.live !== null ? { avgWeightKg: last.avgWeightKg, count: stock.live } : null,
	);
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
 * The stock window: the pond's active cycle, else null ("overall history").
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

/**
 * Computed FCR for a pond's current window, with the window returned so callers
 * can state which period they computed over. This is the only way a caller
 * should obtain a "computed" value.
 */
export async function computeFcrForPond(
	pondId: string,
): Promise<{ window: CycleWindow; computation: FcrComputation }> {
	const window = await activeWindowForPond(pondId);
	const [feedGivenKg, samples, liveCount] = await Promise.all([
		feedGivenKgInWindow(pondId, window),
		biomassSamplesInWindow(pondId, window),
		getLiveCountForPond(pondId),
	]);
	return {
		window,
		computation: computeFcrFromLogs(feedGivenKg, samples, liveCount),
	};
}

// ---------------------------------------------------------------------------
// Stored-report provenance (issue #875)
// ---------------------------------------------------------------------------

/**
 * Why a stored FcrReport row cannot be presented as measured.
 *
 * - `no-feed-logs`: the period has no `feed_dispensed` FeedEvent with grams.
 * - `no-biomass-samples`: fewer than two BiomassLog samples start and close
 *   the period, so the gain cannot be reproduced.
 * - `stored-contradicts-totals`: the row's own `totalFeedKg` and
 *   `biomassGainKg` do not produce its `fcrValue`.
 */
export type StoredFcrUnverifiedReason =
	| "no-feed-logs"
	| "no-biomass-samples"
	| "stored-contradicts-totals";

/** The three numbers a stored report claims about itself. */
export interface StoredFcrTotals {
	totalFeedKg: number;
	biomassGainKg: number;
	fcrValue: number;
}

/** A stored row plus the period it claims to cover. */
export interface StoredFcrRow extends StoredFcrTotals {
	/** Prisma returns Date; tests and older serialized shapes may hand back a string. */
	periodStart: Date | string | null | undefined;
	periodEnd: Date | string | null | undefined;
}

/** Log rows found inside a stored report's own period. */
export interface FcrLogCoverage {
	/** `feed_dispensed` FeedEvent rows with a positive gram value. */
	feedEvents: number;
	/** BiomassLog samples recorded inside the period. */
	biomassSamples: number;
}

export interface StoredFcrAssessment<T extends StoredFcrTotals = StoredFcrTotals> {
	report: T;
	/** The evidence the decision was made from, shown to an admin as-is. */
	coverage: FcrLogCoverage;
	reasons: StoredFcrUnverifiedReason[];
	/** True only when the logs cover the period *and* the row agrees with itself. */
	verified: boolean;
	/** The data-integrity signal an admin must see, kept separate from coverage. */
	contradictsTotals: boolean;
}

/** A gain needs a starting sample and a closing sample. */
export const FCR_MIN_BIOMASS_SAMPLES = 2;

/**
 * Absolute + relative tolerance for the stored identity. Values are commonly
 * stored with 2–3 decimals, so 0.02 absolute absorbs rounding; a ratio more
 * than 1 % off that is a real disagreement, not float noise.
 */
const FCR_IDENTITY_ABS_TOLERANCE = 0.02;
const FCR_IDENTITY_REL_TOLERANCE = 0.01;

/**
 * Does the row's own arithmetic hold? A non-positive or non-finite gain cannot
 * produce a ratio, so a non-zero claimed value contradicts it (0/0 is not a
 * ratio either). This is deliberately independent of log coverage: a row can
 * disagree with itself even when its period is well covered.
 */
export function storedFcrContradictsTotals(totals: StoredFcrTotals): boolean {
	const { totalFeedKg, biomassGainKg, fcrValue } = totals;
	if (!Number.isFinite(totalFeedKg) || !Number.isFinite(biomassGainKg)) return true;
	if (!Number.isFinite(fcrValue) || totalFeedKg < 0 || biomassGainKg < 0) return true;
	if (biomassGainKg === 0) return fcrValue !== 0;
	const expected = totalFeedKg / biomassGainKg;
	const tolerance = Math.max(
		FCR_IDENTITY_ABS_TOLERANCE,
		Math.abs(expected) * FCR_IDENTITY_REL_TOLERANCE,
	);
	return Math.abs(fcrValue - expected) > tolerance;
}

/** Every reason a stored row cannot be verified, in stable display order. */
export function storedFcrReasons(
	totals: StoredFcrTotals,
	coverage: FcrLogCoverage,
): StoredFcrUnverifiedReason[] {
	const reasons: StoredFcrUnverifiedReason[] = [];
	if (!(coverage.feedEvents > 0)) reasons.push("no-feed-logs");
	if (!(coverage.biomassSamples >= FCR_MIN_BIOMASS_SAMPLES)) reasons.push("no-biomass-samples");
	if (storedFcrContradictsTotals(totals)) reasons.push("stored-contradicts-totals");
	return reasons;
}

export function assessStoredFcrReport<T extends StoredFcrTotals>(
	report: T,
	coverage: FcrLogCoverage,
): StoredFcrAssessment<T> {
	const reasons = storedFcrReasons(report, coverage);
	return {
		report,
		coverage,
		reasons,
		verified: reasons.length === 0,
		contradictsTotals: reasons.includes("stored-contradicts-totals"),
	};
}

function toMillis(value: Date | string | null | undefined): number | null {
	if (value instanceof Date) {
		const time = value.getTime();
		return Number.isFinite(time) ? time : null;
	}
	if (typeof value === "string") {
		const time = Date.parse(value);
		return Number.isFinite(time) ? time : null;
	}
	return null;
}

/** Log coverage for one stored row, read from the two source tables. */
export async function storedFcrCoverageForReport(
	pondId: string,
	report: StoredFcrRow,
): Promise<FcrLogCoverage> {
	const from = toMillis(report.periodStart);
	const to = toMillis(report.periodEnd);
	if (from === null || to === null || from > to) {
		return { feedEvents: 0, biomassSamples: 0 };
	}

	const devices = await prisma.energyDevice.findMany({
		where: { pondId },
		select: { id: true },
	});
	const [feedEvents, biomassSamples] = await Promise.all([
		devices.length === 0
			? Promise.resolve(0)
			: prisma.feedEvent.count({
					where: {
						deviceId: { in: devices.map((device) => device.id) },
						eventType: "feed_dispensed",
						grams: { gt: 0 },
						receivedAt: { gte: new Date(from), lte: new Date(to) },
					},
				}),
		prisma.biomassLog.count({
			where: { pondId, recordedAt: { gte: new Date(from), lte: new Date(to) } },
		}),
	]);
	return { feedEvents, biomassSamples };
}

/**
 * Coverage for several stored rows in one pair of reads, so a page showing a
 * report history does not run two queries per row. `reports` may arrive in any
 * order; the returned assessments keep that order.
 */
export async function loadStoredFcrAssessments<T extends StoredFcrRow>(
	pondId: string,
	reports: readonly T[],
	options?: { deviceIds?: readonly string[] },
): Promise<StoredFcrAssessment<T>[]> {
	if (reports.length === 0) return [];

	const bounds = reports
		.map((report) => ({
			from: toMillis(report.periodStart),
			to: toMillis(report.periodEnd),
		}))
		.filter((bound): bound is { from: number; to: number } => {
			return bound.from !== null && bound.to !== null && bound.from <= bound.to;
		});
	if (bounds.length === 0) {
		const empty = { feedEvents: 0, biomassSamples: 0 };
		return reports.map((report) => assessStoredFcrReport(report, empty));
	}

	const from = new Date(Math.min(...bounds.map((bound) => bound.from)));
	const to = new Date(Math.max(...bounds.map((bound) => bound.to)));
	const deviceIds =
		options?.deviceIds ??
		(
			await prisma.energyDevice.findMany({
				where: { pondId },
				select: { id: true },
			})
		).map((device) => device.id);
	const [feedEvents, biomassSamples] = await Promise.all([
		deviceIds.length === 0
			? Promise.resolve([] as { receivedAt: Date }[])
			: prisma.feedEvent.findMany({
					where: {
						deviceId: { in: [...deviceIds] },
						eventType: "feed_dispensed",
						grams: { gt: 0 },
						receivedAt: { gte: from, lte: to },
					},
					select: { receivedAt: true },
				}),
		prisma.biomassLog.findMany({
			where: { pondId, recordedAt: { gte: from, lte: to } },
			select: { recordedAt: true },
		}),
	]);

	const feedTimes = feedEvents.map((event) => event.receivedAt.getTime());
	const biomassTimes = biomassSamples.map((sample) => sample.recordedAt.getTime());
	const countBetween = (times: readonly number[], start: number, end: number) =>
		times.reduce((count, time) => (time >= start && time <= end ? count + 1 : count), 0);

	return reports.map((report) => {
		const start = toMillis(report.periodStart);
		const end = toMillis(report.periodEnd);
		const coverage =
			start === null || end === null || start > end
				? { feedEvents: 0, biomassSamples: 0 }
				: {
						feedEvents: countBetween(feedTimes, start, end),
						biomassSamples: countBetween(biomassTimes, start, end),
					};
		return assessStoredFcrReport(report, coverage);
	});
}

/**
 * What a surface should show for FCR. `computed` always wins; a stored value is
 * only returned when no positive computed value exists, and it carries its
 * provenance so the UI can label it. `stored` must be newest-first.
 */
export interface FcrDisplay<T extends StoredFcrTotals = StoredFcrTotals> {
	value: number;
	source: "computed" | "stored";
	/** Empty for a computed value, and for a stored row the logs reproduce. */
	unverifiedReasons: StoredFcrUnverifiedReason[];
	storedReport: T | null;
}

export function resolveFcrDisplay<T extends StoredFcrTotals>(
	computed: number | null | undefined,
	storedNewestFirst: readonly StoredFcrAssessment<T>[],
): FcrDisplay<T> | null {
	if (typeof computed === "number" && Number.isFinite(computed) && computed > 0) {
		return {
			value: computed,
			source: "computed",
			unverifiedReasons: [],
			storedReport: null,
		};
	}

	const latest = storedNewestFirst[0];
	if (!latest || !Number.isFinite(latest.report.fcrValue) || latest.report.fcrValue <= 0) {
		return null;
	}
	return {
		value: latest.report.fcrValue,
		source: "stored",
		unverifiedReasons: latest.reasons,
		storedReport: latest.report,
	};
}

/**
 * The value a calculation or a prediction may consume: a computed FCR, or a
 * stored row whose logs reproduce it. An unverified stored value must never
 * become a decision input, so this returns null instead.
 */
export function verifiedFcrValue<T extends StoredFcrTotals>(
	display: FcrDisplay<T> | null,
): number | null {
	if (!display) return null;
	if (display.source === "computed") return display.value;
	return display.unverifiedReasons.length === 0 ? display.value : null;
}
