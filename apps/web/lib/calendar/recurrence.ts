import {
	datePartOf,
	farmDateTimeToUtcDate,
	joinDateAndTime,
	timePartOf,
} from "@/lib/calendar/datetime";
import { daysBetween, isValidDateOnly } from "@/lib/crop-cycle/dates";
import { Temporal } from "temporal-polyfill";

/**
 * Pure recurrence expander for the pond calendar (#195/#196).
 *
 * Recurring items are stored as one `PondEvent` row (frequency, interval,
 * until) and expanded into occurrences for the visible range. Every occurrence
 * is computed from the original anchor (`anchor.add(...)`) rather than from the
 * previous occurrence, so a monthly series on the 31st yields 31 Jan, 28 Feb,
 * 31 Mar instead of drifting to the 28th forever.
 */

export type RecurrenceFrequency = "DAILY" | "WEEKLY" | "MONTHLY";

export interface RecurrenceRule {
	freq: RecurrenceFrequency | null;
	interval?: number | null;
	/** Inclusive last day, `YYYY-MM-DD`. */
	until?: string | null;
}

export interface OccurrenceWindow {
	/** Inclusive, `YYYY-MM-DD`. */
	from: string;
	/** Inclusive, `YYYY-MM-DD`. */
	to: string;
}

export interface OccurrenceInput {
	/** `YYYY-MM-DD` for all-day items, `YYYY-MM-DDTHH:mm` for timed items. */
	start: string;
	end?: string | null;
	allDay: boolean;
	recurrence?: RecurrenceRule | null;
	window: OccurrenceWindow;
}

export interface CalendarOccurrence {
	/** Same shape as the input start. */
	start: string;
	end: string | null;
	/** UTC instant used for completion keys and reminders. */
	startUtc: Date;
	occurrenceKey: string;
}

export interface ExpansionResult {
	occurrences: CalendarOccurrence[];
	truncated: boolean;
}

export const MAX_OCCURRENCES = 500;
const MAX_INTERVAL = 365;

function normalizeInterval(value: number | null | undefined): number {
	if (typeof value !== "number" || !Number.isFinite(value)) return 1;
	return Math.min(MAX_INTERVAL, Math.max(1, Math.round(value)));
}

function occurrenceDate(
	anchor: Temporal.PlainDate,
	freq: RecurrenceFrequency | null,
	interval: number,
	index: number,
): Temporal.PlainDate {
	if (!freq || index === 0) return anchor;
	switch (freq) {
		case "DAILY":
			return anchor.add({ days: index * interval });
		case "WEEKLY":
			return anchor.add({ weeks: index * interval });
		case "MONTHLY":
			// Temporal constrains month ends (31 Jan + 1 month = 28 Feb) and,
			// because each step starts from the anchor, later months recover the
			// 31st instead of drifting.
			return anchor.add({ months: index * interval });
	}
}

/**
 * Expand one stored item into the occurrences that overlap `window`.
 * The result is capped at `MAX_OCCURRENCES`; `truncated` reports the cap.
 */
export function expandOccurrences(input: OccurrenceInput): ExpansionResult {
	const anchorDate = datePartOf(input.start);
	const anchor = Temporal.PlainDate.from(anchorDate);
	const startTime = timePartOf(input.start);
	const endDate = input.end ? datePartOf(input.end) : null;
	const endTime = input.end ? timePartOf(input.end) : null;
	const lengthDays = endDate ? Math.max(0, daysBetween(anchorDate, endDate)) : 0;

	const freq = input.recurrence?.freq ?? null;
	const interval = normalizeInterval(input.recurrence?.interval);
	const until =
		input.recurrence?.until && isValidDateOnly(input.recurrence.until)
			? input.recurrence.until
			: null;

	const occurrences: CalendarOccurrence[] = [];
	const maxSteps = freq ? MAX_OCCURRENCES * 4 : 1;

	for (let index = 0; index < maxSteps; index += 1) {
		const date = occurrenceDate(anchor, freq, interval, index).toString();
		if (until && date > until) break;
		if (date > input.window.to) break;

		const occurrenceEndDate = lengthDays > 0 ? addDateDays(date, lengthDays) : date;
		const endValue = input.end ? joinDateAndTime(occurrenceEndDate, endTime) : null;

		// Skip series occurrences that end before the visible range starts.
		if (occurrenceEndDate < input.window.from) {
			if (!freq) break;
			continue;
		}

		const start = joinDateAndTime(date, startTime);
		const startUtc = farmDateTimeToUtcDate(start);
		occurrences.push({
			start,
			end: endValue,
			startUtc,
			occurrenceKey: startUtc.toISOString(),
		});

		if (occurrences.length >= MAX_OCCURRENCES) {
			return { occurrences, truncated: true };
		}
		if (!freq) break;
	}

	return { occurrences, truncated: false };
}

function addDateDays(value: string, days: number): string {
	return Temporal.PlainDate.from(value).add({ days }).toString();
}
