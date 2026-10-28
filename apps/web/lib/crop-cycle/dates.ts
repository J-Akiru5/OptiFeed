import { Temporal } from "temporal-polyfill";

/**
 * The farm operates in the Philippines. Cycle dates are date-only values, so
 * they must never be shifted by the browser/server timezone.
 */
export const FARM_TIME_ZONE = "Asia/Manila";

/** Today's calendar date in the farm's timezone, as `YYYY-MM-DD`. */
export function todayDateOnly(now: Date = new Date()): string {
	return Temporal.Instant.from(now.toISOString())
		.toZonedDateTimeISO(FARM_TIME_ZONE)
		.toPlainDate()
		.toString();
}

/** A timestamp rendered as the farm's calendar date, as `YYYY-MM-DD`. */
export function dateToFarmDateOnly(value: Date): string {
	return Temporal.Instant.from(value.toISOString())
		.toZonedDateTimeISO(FARM_TIME_ZONE)
		.toPlainDate()
		.toString();
}

export function isValidDateOnly(value: unknown): boolean {
	if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
	try {
		Temporal.PlainDate.from(value);
		return true;
	} catch {
		return false;
	}
}

export function parseDateOnly(value: string): Temporal.PlainDate {
	return Temporal.PlainDate.from(value);
}

export function addDays(value: string, days: number): string {
	return parseDateOnly(value).add({ days }).toString();
}

/** Whole calendar days from `from` to `to`; negative when `to` is earlier. */
export function daysBetween(from: string, to: string): number {
	return parseDateOnly(from).until(parseDateOnly(to)).days;
}

/** `YYYY-MM-DD` to the UTC-midnight Date that a `@db.Date` column expects. */
export function dateOnlyToUtcDate(value: string): Date {
	return new Date(`${value}T00:00:00.000Z`);
}

/** A `@db.Date` value back to `YYYY-MM-DD` without timezone drift. */
export function utcDateToDateOnly(value: Date): string {
	return value.toISOString().slice(0, 10);
}

export function formatDateOnly(value: Date | string): string {
	if (typeof value === "string") {
		if (isValidDateOnly(value)) return value;
		return value.slice(0, 10);
	}
	return utcDateToDateOnly(value);
}

/** Inclusive UTC bounds for a date-only range, for `DateTime` filters. */
export function dateRangeUtc(from: string, to: string): { gte: Date; lte: Date } {
	return {
		gte: dateOnlyToUtcDate(from),
		lte: new Date(`${addDays(to, 1)}T00:00:00.000Z`),
	};
}

/**
 * Half-open bounds covering the farm calendar days `from`..`to` inclusive.
 *
 * Use this for `timestamp(3)` instants (for example `FeedEvent.receivedAt`)
 * that are filtered by a farm date. Phase 4 of the calc audit: a Manila day
 * starts at 16:00 UTC on the previous date, so UTC-midnight bounds silently
 * moved up to 8 hours of feed between days.
 */
export function farmDayRangeUtc(from: string, to: string): { gte: Date; lt: Date } {
	const start = parseDateOnly(from).toZonedDateTime(FARM_TIME_ZONE).toInstant();
	const end = parseDateOnly(to).add({ days: 1 }).toZonedDateTime(FARM_TIME_ZONE).toInstant();
	return { gte: new Date(start.epochMilliseconds), lt: new Date(end.epochMilliseconds) };
}

/** Date-only events are stored at UTC midnight; render them back as a date. */
export function dateOnlyEventStart(value: Date | string): string {
	return formatDateOnly(value);
}
