/**
 * Feeding slots as clock minutes, and the inverse used by the schedule import.
 *
 * The feeder spaces `feeds` meals evenly from `scheduleStart` to `scheduleEnd`
 * (a window that ends before it starts runs past midnight), exactly as
 * `computeNextFeedingSlot` does. The schedule is therefore described by three
 * numbers, not a free list of times, so an imported list of times is accepted
 * only when it is the even spacing of some window.
 */

import { FEEDS_PER_DAY_MAX, FEEDS_PER_DAY_MIN } from "@/lib/limits";

export const MINUTES_PER_DAY = 24 * 60;

/** One meal's start, in minutes after midnight (0-1439), in feeding order. */
export function feedingSlotMinutes(startMin: number, endMin: number, feeds: number): number[] {
	const count = Math.max(1, Math.round(feeds));
	const end = endMin >= startMin ? endMin : endMin + MINUTES_PER_DAY;
	const interval = count > 1 ? (end - startMin) / (count - 1) : 0;
	return Array.from(
		{ length: count },
		(_, index) => Math.round(startMin + index * interval) % MINUTES_PER_DAY,
	);
}

export function formatClock(minutes: number): string {
	const wrapped = ((minutes % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
	const hours = Math.floor(wrapped / 60);
	return `${String(hours).padStart(2, "0")}:${String(wrapped % 60).padStart(2, "0")}`;
}

/**
 * The clock times of every meal in a schedule window, as `HH:MM` strings.
 *
 * The dashboard preview calls this on each render, so the list always follows
 * the current window and frequency instead of the last command the device
 * applied (#431). Invalid draft input yields an empty list rather than a
 * misleading partial schedule.
 */
export function scheduleSlotTimes(
	scheduleStart: string,
	scheduleEnd: string,
	feedsPerDay: number,
): string[] {
	const start = parseClock(scheduleStart);
	const end = parseClock(scheduleEnd);
	if (start === null || end === null) return [];
	if (!Number.isFinite(feedsPerDay) || feedsPerDay < FEEDS_PER_DAY_MIN) return [];

	const feeds = Math.min(FEEDS_PER_DAY_MAX, Math.round(feedsPerDay));
	return feedingSlotMinutes(start, end, feeds).map(formatClock);
}

/** `H:MM`, `HH:MM` or `HH:MM:SS` on a 24-hour clock; null for anything else. */
export function parseClock(text: string): number | null {
	const match = /^([01]?\d|2[0-3]):([0-5]\d)(?::[0-5]\d(?:\.\d+)?)?$/.exec(text.trim());
	return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

export interface DerivedSchedule {
	scheduleStart: string;
	scheduleEnd: string;
	feedsPerDay: number;
}

export type DeriveScheduleResult =
	| { ok: true; value: DerivedSchedule }
	| { ok: false; reason: "empty" | "tooMany" | "uneven" };

/** Allowed drift of one minute per slot: the feeder rounds each slot to a whole minute. */
const SPACING_TOLERANCE_MIN = 1;

/**
 * The window and meal count a list of feeding times describes. The times must
 * be in feeding order; the first is the window start and the last its end.
 */
export function deriveSchedule(minutes: number[], maxMeals: number): DeriveScheduleResult {
	if (minutes.length === 0) return { ok: false, reason: "empty" };
	if (minutes.length > maxMeals) return { ok: false, reason: "tooMany" };

	const first = minutes[0];
	const last = minutes[minutes.length - 1];
	if (minutes.length > 1) {
		const span = (last - first + MINUTES_PER_DAY) % MINUTES_PER_DAY;
		if (span === 0) return { ok: false, reason: "uneven" };
		const interval = span / (minutes.length - 1);
		let previous = 0;
		for (let index = 0; index < minutes.length; index += 1) {
			const offset = (minutes[index] - first + MINUTES_PER_DAY) % MINUTES_PER_DAY;
			const drift = Math.abs(offset - index * interval);
			if (drift > SPACING_TOLERANCE_MIN || (index > 0 && offset <= previous)) {
				return { ok: false, reason: "uneven" };
			}
			previous = offset;
		}
	}

	return {
		ok: true,
		value: {
			scheduleStart: formatClock(first),
			scheduleEnd: formatClock(last),
			feedsPerDay: minutes.length,
		},
	};
}
