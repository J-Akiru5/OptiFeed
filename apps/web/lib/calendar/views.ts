/**
 * Calendar view names shared by the farmer, admin and platform calendars.
 *
 * FullCalendar view names are stable strings; keeping them here lets the small
 * default-view rule be unit tested without importing the client bundle.
 */
export const CALENDAR_DEFAULT_VIEW = "dayGridMonth";
export const CALENDAR_NARROW_VIEW = "listMonth";
export const CALENDAR_TOOLBAR_VIEWS = "dayGridMonth,timeGridWeek,timeGridDay,listMonth";

/** Agenda is the default below 640 px (E25), month otherwise. */
export function initialCalendarView(isNarrow: boolean): string {
	return isNarrow ? CALENDAR_NARROW_VIEW : CALENDAR_DEFAULT_VIEW;
}
