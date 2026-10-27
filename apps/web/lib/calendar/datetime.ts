import { FARM_TIME_ZONE } from "@/lib/crop-cycle/dates";
import { Temporal } from "temporal-polyfill";

/**
 * Farm-local calendar value helpers.
 *
 * All-day values are `YYYY-MM-DD`; timed values are naive farm-local
 * `YYYY-MM-DDTHH:mm` (the same shape FullCalendar emits for the pond
 * calendar's feeding bands). Persisting converts the naive value to a UTC
 * instant using the farm time zone, so a browser in another time zone cannot
 * shift a 09:00 feeding reminder.
 */

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/;

export function isDateOnlyValue(value: unknown): value is string {
	if (typeof value !== "string" || !DATE_ONLY.test(value)) return false;
	try {
		Temporal.PlainDate.from(value);
		return true;
	} catch {
		return false;
	}
}

export function isFarmDateTimeValue(value: unknown): value is string {
	if (typeof value !== "string" || !DATE_TIME.test(value)) return false;
	try {
		Temporal.PlainDateTime.from(normalizeSeconds(value));
		return true;
	} catch {
		return false;
	}
}

/** A calendar value is either a date-only day or a naive farm-local instant. */
export function isCalendarDateTimeValue(value: unknown): value is string {
	return isDateOnlyValue(value) || isFarmDateTimeValue(value);
}

export function datePartOf(value: string): string {
	return value.slice(0, 10);
}

export function timePartOf(value: string): string | null {
	return value.includes("T") ? value.slice(11, 16) : null;
}

export function joinDateAndTime(date: string, time: string | null): string {
	return time ? `${date}T${time}` : date;
}

function normalizeSeconds(value: string): string {
	return value.length === 16 ? `${value}:00` : value;
}

/** Naive farm-local value to the UTC instant the database stores. */
export function farmDateTimeToUtcDate(value: string): Date {
	if (isDateOnlyValue(value)) return new Date(`${value}T00:00:00.000Z`);
	const plain = Temporal.PlainDateTime.from(normalizeSeconds(value));
	return new Date(plain.toZonedDateTime(FARM_TIME_ZONE).toInstant().toString());
}

/** A stored instant back to the naive farm-local value the UI edits. */
export function utcDateToFarmDateTime(value: Date): string {
	const zoned = Temporal.Instant.from(value.toISOString()).toZonedDateTimeISO(FARM_TIME_ZONE);
	const time = `${String(zoned.hour).padStart(2, "0")}:${String(zoned.minute).padStart(2, "0")}`;
	return joinDateAndTime(zoned.toPlainDate().toString(), time);
}

/** A stored instant rendered as the farm's calendar day. */
export function utcDateToFarmDateOnly(value: Date): string {
	return Temporal.Instant.from(value.toISOString())
		.toZonedDateTimeISO(FARM_TIME_ZONE)
		.toPlainDate()
		.toString();
}

/**
 * Normalise a FullCalendar `startStr`/`endStr` (which may carry an offset, a
 * `Z`, or seconds) to the value shape the calendar persists.
 */
export function fullCalendarValueToFarmValue(value: string, allDay: boolean): string {
	if (allDay) return value.slice(0, 10);
	if (/[zZ]$|[+-]\d{2}:?\d{2}$/.test(value)) {
		return utcDateToFarmDateTime(new Date(value));
	}
	return value.slice(0, 16);
}
