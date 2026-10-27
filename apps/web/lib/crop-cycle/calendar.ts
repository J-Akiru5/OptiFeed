export type CalendarEventType = "harvest" | "sampling" | "manual" | "feeding" | "device";

export type CalendarEventStatus = "planned" | "done" | "missed" | "cancelled";

export interface CalendarEventDto {
	id: string;
	title: string;
	start: string;
	end?: string;
	allDay: boolean;
	type: CalendarEventType;
	status?: CalendarEventStatus;
	/** The stored `PondEvent.type` (`MAINTENANCE`, `HARVEST_PLANNED`, ...). */
	kind?: string;
	/** Event (time range) or Task (due date + checkbox). */
	itemKind?: "EVENT" | "TASK";
	/** `#RRGGBB`, or null to use the type's default colour. */
	color?: string | null;
	source?: string | null;
	/** The stored row id, without the `pond:` calendar-id prefix. */
	pondEventId?: string;
	/** The stored `DeviceStateEvent.eventType`, for translated labels. */
	deviceEventType?: string;
	/** The creator/actor user id, when the caller asked for it (platform calendar). */
	createdByUserId?: string | null;
	/** UTC ISO instant of this occurrence, used for completion and reminders. */
	occurrenceKey?: string;
	recurrenceFreq?: "DAILY" | "WEEKLY" | "MONTHLY" | null;
	recurrenceInterval?: number | null;
	recurrenceUntil?: string | null;
	/** The series anchor in the same farm-local shape as `start`. */
	seriesStartsAt?: string;
	seriesEndsAt?: string | null;
	reminderMinutes?: number[];
	/** A task occurrence (or a one-off task) is checked. */
	completed?: boolean;
	editable: boolean;
	display?: "auto" | "background";
	pondId: string;
	pondName: string;
	cycleLabel?: string | null;
	notes?: string | null;
	href?: string;
}

export const CALENDAR_EVENT_TYPES: CalendarEventType[] = [
	"harvest",
	"sampling",
	"manual",
	"feeding",
	"device",
];

export function isCalendarEventType(value: string): value is CalendarEventType {
	return (CALENDAR_EVENT_TYPES as readonly string[]).includes(value);
}

export function pondEventCalendarType(
	type: "STOCKING" | "HARVEST_PLANNED" | "HARVEST_ACTUAL" | "SAMPLING" | "MAINTENANCE" | "OTHER",
): CalendarEventType {
	return type === "HARVEST_PLANNED" || type === "HARVEST_ACTUAL" ? "harvest" : "manual";
}
