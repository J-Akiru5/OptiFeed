/**
 * Freshness of a reported sensor reading (#620).
 *
 * Both the water probe and the RTC health bit arrive on a heartbeat. A value
 * that was true an hour ago is not evidence about now, so the viewer labels an
 * old reading "stale" with its age instead of presenting it as current.
 *
 * The window is the device's own offline window (`DeviceStatusPolicy`), which is
 * a platform setting: the same five minutes that make a unit offline also make
 * its last reading too old to trust.
 */

export type ReadingAgeUnit = "seconds" | "minutes" | "hours" | "days";

export interface ReadingAge {
	unit: ReadingAgeUnit;
	count: number;
}

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

function toTime(value: Date | string | null | undefined): number | null {
	if (value === null || value === undefined) return null;
	const time = value instanceof Date ? value.getTime() : new Date(value).getTime();
	return Number.isFinite(time) ? time : null;
}

/**
 * Age of a reading, rounded down to the largest sensible unit. Null when the
 * reading never happened: "never reported" is not the same as "old".
 */
export function readingAge(
	updatedAt: Date | string | null | undefined,
	now = Date.now(),
): ReadingAge | null {
	const time = toTime(updatedAt);
	if (time === null) return null;
	const elapsed = Math.max(0, now - time);
	if (elapsed < MINUTE_MS) return { unit: "seconds", count: Math.floor(elapsed / 1000) };
	if (elapsed < HOUR_MS) return { unit: "minutes", count: Math.floor(elapsed / MINUTE_MS) };
	if (elapsed < DAY_MS) return { unit: "hours", count: Math.floor(elapsed / HOUR_MS) };
	return { unit: "days", count: Math.floor(elapsed / DAY_MS) };
}

/**
 * True once a reading is older than the freshness window. A missing or
 * unparseable timestamp is "unknown", not stale; a non-positive window disables
 * the check rather than marking everything old.
 */
export function isReadingStale(
	updatedAt: Date | string | null | undefined,
	staleAfterMs: number,
	now = Date.now(),
): boolean {
	const time = toTime(updatedAt);
	if (time === null) return false;
	if (!Number.isFinite(staleAfterMs) || staleAfterMs <= 0) return false;
	return now - time > staleAfterMs;
}
