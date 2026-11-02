import { describe, expect, it } from "vitest";

import type { CalendarEventDto } from "@/lib/crop-cycle/calendar";
import { countDayEvents, eventDay, groupDayEvents } from "@/lib/crop-cycle/day-groups";

function event(
	overrides: Partial<CalendarEventDto> & { id: string; type: CalendarEventDto["type"] },
) {
	return {
		title: overrides.id,
		start: "2026-11-02T08:00:00",
		allDay: false,
		editable: false,
		pondId: "pond-1",
		pondName: "Pond 1",
		status: "done",
		...overrides,
	} as CalendarEventDto;
}

describe("calendar day groups (#534)", () => {
	it("reads the day from a timestamp or a date-only start", () => {
		expect(eventDay(event({ id: "a", type: "device", start: "2026-11-02T08:00:00" }))).toBe(
			"2026-11-02",
		);
		expect(eventDay(event({ id: "b", type: "harvest", start: "2026-11-02", allDay: true }))).toBe(
			"2026-11-02",
		);
	});

	it("keeps only the requested day", () => {
		const events = [
			event({ id: "today", type: "device", start: "2026-11-02T09:00:00" }),
			event({ id: "tomorrow", type: "device", start: "2026-11-03T09:00:00" }),
		];

		expect(groupDayEvents(events, "2026-11-02").flatMap((g) => g.events.map((e) => e.id))).toEqual([
			"today",
		]);
		expect(countDayEvents(events, "2026-11-02")).toBe(1);
	});

	it("orders groups alerts-first and feeding last", () => {
		const events = [
			event({ id: "feed", type: "feeding", start: "2026-11-02T06:00:00" }),
			event({ id: "harvest", type: "harvest", start: "2026-11-02", allDay: true }),
			event({ id: "alert", type: "device", start: "2026-11-02T07:30:00" }),
			event({ id: "sample", type: "sampling", start: "2026-11-02", allDay: true }),
			event({ id: "manual", type: "manual", start: "2026-11-02T10:00:00" }),
		];

		expect(groupDayEvents(events, "2026-11-02").map((group) => group.type)).toEqual([
			"device",
			"harvest",
			"sampling",
			"manual",
			"feeding",
		]);
	});

	it("drops empty groups and sorts each group by start", () => {
		const events = [
			event({ id: "later", type: "device", start: "2026-11-02T18:00:00" }),
			event({ id: "earlier", type: "device", start: "2026-11-02T06:00:00" }),
			event({ id: "marker", type: "manual", start: "2026-11-02T12:00:00" }),
		];

		const groups = groupDayEvents(events, "2026-11-02");

		expect(groups).toHaveLength(2);
		expect(groups[0].events.map((e) => e.id)).toEqual(["earlier", "later"]);
		expect(groups.every((group) => group.events.length > 0)).toBe(true);
	});

	it("counts a busy day without truncating it", () => {
		const events = Array.from({ length: 156 }, (_, index) =>
			event({
				id: `alert-${index}`,
				type: "device",
				start: `2026-11-02T${String(index % 24).padStart(2, "0")}:00:00`,
			}),
		);

		expect(countDayEvents(events, "2026-11-02")).toBe(156);
		expect(groupDayEvents(events, "2026-11-02")[0].events).toHaveLength(156);
	});
});
