/**
 * Relative time for device "last seen" surfaces (#891).
 *
 * The device page printed an offline age in hours only, so a unit that had
 * been down for three days read "75h 12m" — a number the operator has to divide
 * in their head. One threshold now decides the unit: under a day it stays in
 * minutes/hours, at a day or more it switches to days, and the formatters keep
 * the app's existing wording ("2h 5m", "3d 21h", "3d ago").
 *
 * `now` is a parameter rather than a `Date.now()` call so the thresholds are
 * testable and so a caller can drive a value from a ticking clock instead of
 * freezing at first render.
 */

export interface ElapsedParts {
	/** Whole days elapsed. */
	days: number;
	/** Whole hours inside the current day (0–23). */
	hours: number;
	/** Whole minutes inside the current hour (0–59). */
	minutes: number;
	/** Whole seconds, floored at zero. */
	seconds: number;
}

export type RelativeAgeUnit = "now" | "minutes" | "hours" | "days";

export interface RelativeAge {
	unit: RelativeAgeUnit;
	/** The count for minutes/hours/days; 0 for "now". */
	count: number;
}

function toMillis(value: Date | string | number): number | null {
	const millis = value instanceof Date ? value.getTime() : new Date(value).getTime();
	return Number.isFinite(millis) ? millis : null;
}

function nowMillis(now: Date | number): number {
	return now instanceof Date ? now.getTime() : now;
}

/** Broken-down elapsed time, or null for a missing/invalid timestamp. */
export function elapsedParts(
	from: Date | string | number | null | undefined,
	now: Date | number = Date.now(),
): ElapsedParts | null {
	if (from === null || from === undefined) return null;
	const fromMs = toMillis(from);
	if (fromMs === null) return null;

	const totalSeconds = Math.max(0, Math.floor((nowMillis(now) - fromMs) / 1000));
	const totalMinutes = Math.floor(totalSeconds / 60);
	const totalHours = Math.floor(totalMinutes / 60);

	return {
		days: Math.floor(totalHours / 24),
		hours: totalHours % 24,
		minutes: totalMinutes % 60,
		seconds: totalSeconds,
	};
}

/**
 * The display unit for a relative age: the value switches to days exactly when
 * a full day has elapsed, so "23h ago" never becomes "1d ago" early and a
 * three-day outage never reads in hours.
 */
export function relativeAge(
	from: Date | string | number | null | undefined,
	now: Date | number = Date.now(),
): RelativeAge | null {
	const parts = elapsedParts(from, now);
	if (!parts) return null;

	if (parts.seconds < 60) return { unit: "now", count: 0 };
	if (parts.seconds < 3600) return { unit: "minutes", count: Math.floor(parts.seconds / 60) };
	if (parts.days === 0) return { unit: "hours", count: Math.floor(parts.seconds / 3600) };
	return { unit: "days", count: parts.days };
}
