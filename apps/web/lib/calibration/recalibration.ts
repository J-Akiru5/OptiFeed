/**
 * Per-device recalibration schedule (issue #191).
 *
 * Pure helpers shared by the Hardware page, the dashboard badge and the reminder
 * cron. Kept separate from the Prisma service so the date math is testable
 * without a database.
 */

export const RECALIBRATION_INTERVAL_MIN_DAYS = 7;
export const RECALIBRATION_INTERVAL_MAX_DAYS = 180;
export const DEFAULT_RECALIBRATION_INTERVAL_DAYS = 30;

const DAY_MS = 24 * 60 * 60 * 1000;

export interface RecalibrationStatus {
	/** Instant the device became due, or null when it was never calibrated. */
	dueAt: Date | null;
	isOverdue: boolean;
	/** Whole days past `dueAt`; 0 while it is not yet due. */
	daysOverdue: number;
}

export function isValidRecalibrationIntervalDays(days: number): boolean {
	return (
		Number.isInteger(days) &&
		days >= RECALIBRATION_INTERVAL_MIN_DAYS &&
		days <= RECALIBRATION_INTERVAL_MAX_DAYS
	);
}

/** Normalise an out-of-range stored value to the supported window. */
export function clampRecalibrationIntervalDays(days: number | null | undefined): number {
	if (typeof days !== "number" || !Number.isFinite(days)) {
		return DEFAULT_RECALIBRATION_INTERVAL_DAYS;
	}
	const whole = Math.round(days);
	if (whole < RECALIBRATION_INTERVAL_MIN_DAYS) return RECALIBRATION_INTERVAL_MIN_DAYS;
	if (whole > RECALIBRATION_INTERVAL_MAX_DAYS) return RECALIBRATION_INTERVAL_MAX_DAYS;
	return whole;
}

/** Due instant = last calibration + interval. Null when never calibrated. */
export function recalibrationDueAt(
	lastCalibratedAt: Date | null | undefined,
	intervalDays: number,
): Date | null {
	if (!lastCalibratedAt || Number.isNaN(lastCalibratedAt.getTime())) return null;
	const interval = clampRecalibrationIntervalDays(intervalDays);
	return new Date(lastCalibratedAt.getTime() + interval * DAY_MS);
}

export function getRecalibrationStatus(
	lastCalibratedAt: Date | null | undefined,
	intervalDays: number,
	now: Date = new Date(),
): RecalibrationStatus {
	const dueAt = recalibrationDueAt(lastCalibratedAt, intervalDays);
	if (!dueAt) return { dueAt: null, isOverdue: false, daysOverdue: 0 };

	const overdueMs = now.getTime() - dueAt.getTime();
	if (overdueMs < 0) return { dueAt, isOverdue: false, daysOverdue: 0 };

	return {
		dueAt,
		isOverdue: true,
		daysOverdue: Math.floor(overdueMs / DAY_MS),
	};
}

/**
 * Idempotency key for the overdue reminder. One reminder per due date: a second
 * cron run on the same day must not create another notification, while a later
 * calibration produces a new due date and therefore a new key.
 */
export function recalibrationDedupeKey(deviceId: string, dueAt: Date): string {
	return `recal:${deviceId}:${dueAt.toISOString().slice(0, 10)}`;
}
