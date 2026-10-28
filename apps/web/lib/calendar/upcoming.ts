import type { CalendarEventDto } from "@/lib/crop-cycle/calendar";
import { addDays } from "@/lib/crop-cycle/dates";

/**
 * The one "Upcoming events" rule (#248).
 *
 * The page rail, the offline Harvest snapshot and the calendar API all look at
 * the same farm-local window from today forward. Before #248 the Harvest page
 * built its own list from persisted `PondEvent` rows only, so it missed the
 * derived sampling reminders and showed "No upcoming events" while the Calendar
 * page showed the sampling due dates. The window and the selection now live
 * here, so both entry points cannot drift again.
 *
 * This module is imported by a client component: keep it free of Prisma and
 * other server-only dependencies. `loadUpcomingCalendarEvents` in
 * `event-sources.ts` reads the events with the same parameters.
 */

/** Days ahead the upcoming rail and the offline snapshot look. */
export const UPCOMING_WINDOW_DAYS = 45;

/** Items the upcoming rail shows (and the offline snapshot stores). */
export const UPCOMING_LIMIT = 5;

export interface UpcomingWindow {
	/** Inclusive farm-local `YYYY-MM-DD` start, i.e. today. */
	from: string;
	/** Inclusive farm-local `YYYY-MM-DD` end. */
	to: string;
}

/** The inclusive date window every "upcoming" consumer must request. */
export function upcomingWindow(today: string): UpcomingWindow {
	return { from: today, to: addDays(today, UPCOMING_WINDOW_DAYS) };
}

/**
 * Filter, sort and cap an event stream for the upcoming list.
 *
 * Events keep their farm-local start strings (`YYYY-MM-DD` or
 * `YYYY-MM-DDTHH:mm`), so a lexical date comparison is timezone-safe. Past
 * events are dropped and the nearest first N are returned.
 */
export function selectUpcomingEvents(
	events: readonly CalendarEventDto[],
	today: string,
	limit: number = UPCOMING_LIMIT,
): CalendarEventDto[] {
	return events
		.filter((event) => event.start.slice(0, 10) >= today)
		.sort((a, b) => a.start.localeCompare(b.start))
		.slice(0, limit);
}
