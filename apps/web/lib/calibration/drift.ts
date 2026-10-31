/**
 * Rule-based calibration drift detector (issue #191, decision E8).
 *
 * Compares the feed the device reported dispensing over the recent window with
 * the hopper-level drop observed by the ultrasonic sensor. A large disagreement
 * means the configured grams-per-second no longer matches reality and the
 * operator should re-run calibration.
 *
 * Pure and dependency-free so the refill segmentation and the thresholds are
 * unit-testable without a database. The caller supplies the last 7 days of
 * readings.
 */

export type CalibrationDriftStatus = "ok" | "drift" | "insufficient_data";

export interface DriftFeedSample {
	grams: number | null;
	receivedAt: Date;
}

export interface DriftLevelSample {
	levelPercent: number;
	recordedAt: Date;
}

export interface CalibrationDriftInput {
	feeds: readonly DriftFeedSample[];
	levels: readonly DriftLevelSample[];
	hopperCapacityG: number | null | undefined;
}

export interface CalibrationDriftResult {
	status: CalibrationDriftStatus;
	/** Sum of `feed_dispensed` grams in the window. */
	dispensedG: number;
	/** Grams implied by the hopper-level drop, refills excluded. */
	observedG: number;
	/** (observed − dispensed) ÷ dispensed × 100. Null when there is no data. */
	diffPct: number | null;
}

/** Fewer than this many confirmed feeds cannot support a conclusion. */
export const DRIFT_MIN_FEEDS = 3;
/** Fewer than this many level readings cannot show a drop. */
export const DRIFT_MIN_LEVEL_READINGS = 2;
/** |diffPct| above this percentage is reported as drift. */
export const DRIFT_THRESHOLD_PCT = 15;
/**
 * A positive level jump larger than this many percentage points is a refill,
 * not sensor noise: the drop measured before it must not be counted against
 * the feed dispensed after it.
 */
export const DRIFT_REFILL_JUMP_POINTS = 5;

function round1(value: number): number {
	return Math.round(value * 10) / 10;
}

function round2(value: number): number {
	return Math.round(value * 100) / 100;
}

function isFiniteNumber(value: unknown): value is number {
	return typeof value === "number" && Number.isFinite(value);
}

/**
 * Grams represented by the observed level drop, with each refill starting a new
 * segment.
 *
 * Readings are walked in time order against a baseline (the last level that was
 * actually counted):
 *
 * - a fall below the baseline is a real drop: count it and move the baseline
 *   down;
 * - a rise at or below `DRIFT_REFILL_JUMP_POINTS` is sensor noise and is
 *   ignored **without raising the baseline**, so a later fall is measured from
 *   the true peak instead of counting the same pellets twice (70 → 75 → 60 is
 *   10 points, not 15);
 * - a larger rise is a refill: it starts a new segment and the drop measured
 *   before it is kept (that feed was dispensed and counted by the device).
 */
export function levelDropGrams(
	levels: readonly DriftLevelSample[],
	hopperCapacityG: number,
): number {
	if (!(hopperCapacityG > 0) || levels.length < 2) return 0;

	const sorted = [...levels]
		.filter((level) => isFiniteNumber(level.levelPercent))
		.sort((a, b) => a.recordedAt.getTime() - b.recordedAt.getTime());
	if (sorted.length < 2) return 0;

	let baseline = sorted[0].levelPercent;
	let dropPoints = 0;

	for (let index = 1; index < sorted.length; index += 1) {
		const current = sorted[index].levelPercent;
		const delta = current - baseline;

		if (delta > DRIFT_REFILL_JUMP_POINTS) {
			// Refill: new segment, baseline at the new level.
			baseline = current;
			continue;
		}

		if (delta < 0) {
			dropPoints += -delta;
			baseline = current;
		}
	}

	return round1((dropPoints / 100) * hopperCapacityG);
}

/**
 * Compare dispensed grams with the observed hopper-level drop.
 *
 * `insufficient_data` wins over a numerical result: without enough feeds, a
 * capacity, two level readings, or any dispensed grams, an error percentage
 * would describe noise rather than drift.
 */
export function computeCalibrationDrift(input: CalibrationDriftInput): CalibrationDriftResult {
	const feeds = input.feeds.filter((feed) => isFiniteNumber(feed.grams) && feed.grams > 0);
	const dispensedG = round1(feeds.reduce((total, feed) => total + (feed.grams ?? 0), 0));

	const capacity =
		isFiniteNumber(input.hopperCapacityG) && input.hopperCapacityG > 0
			? input.hopperCapacityG
			: null;

	const usableLevels = input.levels.filter((level) => isFiniteNumber(level.levelPercent));

	if (
		feeds.length < DRIFT_MIN_FEEDS ||
		capacity === null ||
		usableLevels.length < DRIFT_MIN_LEVEL_READINGS ||
		dispensedG <= 0
	) {
		return {
			status: "insufficient_data",
			dispensedG,
			observedG: 0,
			diffPct: null,
		};
	}

	const observedG = levelDropGrams(usableLevels, capacity);
	if (observedG <= 0) {
		return {
			status: "insufficient_data",
			dispensedG,
			observedG,
			diffPct: null,
		};
	}

	const diffPct = round2(((observedG - dispensedG) / dispensedG) * 100);

	return {
		status: Math.abs(diffPct) > DRIFT_THRESHOLD_PCT ? "drift" : "ok",
		dispensedG,
		observedG,
		diffPct,
	};
}
