import {
	CALENDAR_DEFAULT_VIEW,
	CALENDAR_NARROW_VIEW,
	CALENDAR_TOOLBAR_VIEWS,
	initialCalendarView,
} from "@/lib/calendar/views";
import { describe, expect, it } from "vitest";

describe("calendar view defaults", () => {
	it("starts on the month grid on a wide screen", () => {
		expect(initialCalendarView(false)).toBe(CALENDAR_DEFAULT_VIEW);
	});

	it("starts on the agenda below 640 px", () => {
		expect(initialCalendarView(true)).toBe(CALENDAR_NARROW_VIEW);
	});

	it("offers month, week, day and agenda views", () => {
		expect(CALENDAR_TOOLBAR_VIEWS.split(",")).toEqual([
			"dayGridMonth",
			"timeGridWeek",
			"timeGridDay",
			"listMonth",
		]);
	});
});
