import { PH_TZ } from "@/lib/constants";
import { farmWallClock } from "@/lib/date-local";

/**
 * Specific Growth Rate (SGR), the standard aquaculture measure (Hopkins 1992):
 *
 *   SGR (%/day) = 100 × (ln(W2) − ln(W1)) / (t2 − t1 in days)
 *
 * `W` is the mean body weight per fish of a sampling (`BiomassLog.avgWeightKg`).
 * The formula is unit-free as long as both weights use the same unit, so this
 * module never converts; callers pass kilograms and format grams themselves.
 *
 * Pure date/number math — no Prisma, no request context — so the growth page,
 * the history table and the tests all share exactly one implementation.
 */

const DAY_MS = 86_400_000;

export interface SgrSample {
	recordedAt: Date;
	/** Mean body weight per fish. Any unit, as long as every sample uses it. */
	avgWeightKg: number;
}

export interface SgrSeriesPoint {
	from: Date;
	to: Date;
	/** Calendar days in Asia/Manila between the two samplings, or null. */
	days: number | null;
	sgrPctPerDay: number | null;
	averageDailyGainG: number | null;
}

export type SgrUnavailableReason = "insufficientSamples" | "invalidWeight" | "intervalTooShort";

/** Midnight of the sample's farm day (Asia/Manila) as a UTC epoch. */
function startOfFarmDayMs(date: Date): number {
	const clock = farmWallClock(date, PH_TZ);
	return Date.UTC(clock.year, clock.month - 1, clock.day);
}

/**
 * Elapsed days between two instants, counted in Asia/Manila calendar days.
 *
 * Two samples on different farm dates count whole calendar days, so a morning
 * sample and an evening sample 30 hours later are "2 days", matching how a
 * farmer reads the dates. Two samples that share a date fall back to the exact
 * fractional elapsed time (still under one day).
 *
 * Returns null for an invalid or non-positive interval.
 */
export function elapsedFarmDays(from: Date, to: Date): number | null {
	const fromMs = from.getTime();
	const toMs = to.getTime();
	if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || toMs <= fromMs) return null;

	const calendarDays = (startOfFarmDayMs(to) - startOfFarmDayMs(from)) / DAY_MS;
	if (Number.isFinite(calendarDays) && calendarDays > 0) return calendarDays;
	return (toMs - fromMs) / DAY_MS;
}

/**
 * SGR between two samplings, or null when it is not meaningful: a weight that
 * is not positive, an elapsed interval under one day, or invalid dates. A
 * negative result is valid (weight loss) and is never clamped.
 */
export function computeSgr(w1: number, t1: Date, w2: number, t2: Date): number | null {
	if (!(w1 > 0) || !(w2 > 0)) return null;
	const days = elapsedFarmDays(t1, t2);
	if (days === null || !Number.isFinite(days) || days < 1) return null;
	const sgr = (100 * (Math.log(w2) - Math.log(w1))) / days;
	return Number.isFinite(sgr) ? sgr : null;
}

function sortedSamples(samples: readonly SgrSample[]): SgrSample[] {
	return [...samples].sort((a, b) => a.recordedAt.getTime() - b.recordedAt.getTime());
}

function dailyGain(w1: number, t1: Date, w2: number, t2: Date): number | null {
	const days = elapsedFarmDays(t1, t2);
	if (days === null || !Number.isFinite(days) || days < 1) return null;
	const gain = (w2 - w1) * 1000;
	return Number.isFinite(gain) ? gain / days : null;
}

/** Per-interval SGR, oldest interval first, from channels of consecutive samples. */
export function sgrSeries(samples: readonly SgrSample[]): SgrSeriesPoint[] {
	const sorted = sortedSamples(samples);
	const points: SgrSeriesPoint[] = [];
	for (let index = 1; index < sorted.length; index += 1) {
		const previous = sorted[index - 1];
		const current = sorted[index];
		points.push({
			from: previous.recordedAt,
			to: current.recordedAt,
			days: elapsedFarmDays(previous.recordedAt, current.recordedAt),
			sgrPctPerDay: computeSgr(
				previous.avgWeightKg,
				previous.recordedAt,
				current.avgWeightKg,
				current.recordedAt,
			),
			averageDailyGainG: dailyGain(
				previous.avgWeightKg,
				previous.recordedAt,
				current.avgWeightKg,
				current.recordedAt,
			),
		});
	}
	return points;
}

/** SGR from the first to the latest sampling. */
export function overallSgr(samples: readonly SgrSample[]): number | null {
	const sorted = sortedSamples(samples);
	if (sorted.length < 2) return null;
	const first = sorted[0];
	const last = sorted[sorted.length - 1];
	return computeSgr(first.avgWeightKg, first.recordedAt, last.avgWeightKg, last.recordedAt);
}

/** Companion value: mean grams gained per fish per day, first to latest sample. */
export function averageDailyGain(samples: readonly SgrSample[]): number | null {
	const sorted = sortedSamples(samples);
	if (sorted.length < 2) return null;
	const first = sorted[0];
	const last = sorted[sorted.length - 1];
	return dailyGain(first.avgWeightKg, first.recordedAt, last.avgWeightKg, last.recordedAt);
}

/** Why SGR cannot be shown for these samples, or null when it can. */
export function sgrUnavailableReason(samples: readonly SgrSample[]): SgrUnavailableReason | null {
	const sorted = sortedSamples(samples);
	if (sorted.length < 2) return "insufficientSamples";
	const first = sorted[0];
	const last = sorted[sorted.length - 1];
	if (!(first.avgWeightKg > 0) || !(last.avgWeightKg > 0)) return "invalidWeight";
	const days = elapsedFarmDays(first.recordedAt, last.recordedAt);
	if (days === null || !Number.isFinite(days) || days < 1) return "intervalTooShort";
	return null;
}
