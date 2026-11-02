import type { CalendarEventDto, CalendarEventType } from "./calendar";

/**
 * Day-panel order (#534): warnings first, then the work a farmer acts on.
 * Feeding sits last because it repeats several times a day.
 */
export const DAY_GROUP_ORDER: CalendarEventType[] = [
	"device",
	"harvest",
	"sampling",
	"manual",
	"feeding",
];

export interface DayGroup {
	type: CalendarEventType;
	events: CalendarEventDto[];
}

/** The calendar day an event belongs to, as `YYYY-MM-DD`. */
export function eventDay(event: CalendarEventDto): string {
	return event.start.slice(0, 10);
}

/** Every event on `day`, grouped by type in `DAY_GROUP_ORDER`. */
export function groupDayEvents(events: CalendarEventDto[], day: string): DayGroup[] {
	const onDay = events
		.filter((event) => eventDay(event) === day)
		.sort((a, b) => a.start.localeCompare(b.start));

	return DAY_GROUP_ORDER.map((type) => ({
		type,
		events: onDay.filter((event) => event.type === type),
	})).filter((group) => group.events.length > 0);
}

/** Total events on `day`, including background feeding bands. */
export function countDayEvents(events: CalendarEventDto[], day: string): number {
	return events.filter((event) => eventDay(event) === day).length;
}
