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
	kind?: string;
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
