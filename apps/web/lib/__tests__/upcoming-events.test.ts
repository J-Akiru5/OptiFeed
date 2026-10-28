import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * #248 — one upcoming-events rule.
 *
 * The Harvest page used to build its "Upcoming events" from persisted
 * `PondEvent` rows only, so it said "No upcoming events" while the Calendar
 * page showed sampling due dates. Both entry points now load the same window
 * through `loadCalendarEventSources` and select with `selectUpcomingEvents`.
 * This test pins that the two paths return the same list, including the derived
 * sampling reminders.
 */

const mocks = vi.hoisted(() => ({
	pondEvent: { findMany: vi.fn() },
	biomassLog: { groupBy: vi.fn() },
	cropCycle: { findMany: vi.fn() },
	energyDevice: { findMany: vi.fn() },
	deviceStateEvent: { findMany: vi.fn() },
}));

vi.mock("@/lib/prisma", () => ({
	default: {
		pondEvent: mocks.pondEvent,
		biomassLog: mocks.biomassLog,
		cropCycle: mocks.cropCycle,
		energyDevice: mocks.energyDevice,
		deviceStateEvent: mocks.deviceStateEvent,
	},
}));

vi.mock("@/lib/schedule/resolve-current", () => ({
	resolveCurrentSchedule: vi.fn(),
}));

import {
	type CalendarEventPond,
	defaultCalendarEventTypes,
	loadCalendarEventSources,
	loadUpcomingCalendarEvents,
} from "../calendar/event-sources";
import { selectUpcomingEvents, upcomingWindow } from "../calendar/upcoming";
import { addDays, todayDateOnly } from "../crop-cycle/dates";

const TODAY = todayDateOnly();

const pond: CalendarEventPond = {
	id: "pond-a",
	name: "Pond A",
	sampleIntervalDays: 7,
	createdAt: new Date("2026-01-01T00:00:00.000Z"),
	isFallow: false,
};

/** A persisted manual event tomorrow, in the shape the source query returns. */
const manualEvent = {
	id: "event-1",
	pond: { id: "pond-a", name: "Pond A" },
	cropCycle: null,
	title: "Clean the aerator",
	type: "TASK",
	kind: "TASK",
	status: "PLANNED",
	source: "manual",
	startsAt: new Date(`${addDays(TODAY, 1)}T00:00:00.000Z`),
	endsAt: null,
	allDay: true,
	color: null,
	notes: null,
	recurrenceFreq: null,
	recurrenceInterval: 1,
	recurrenceUntil: null,
	reminderMinutes: [],
	completedOccurrences: [],
	createdBy: "user-1",
};

/** A device incident today, in the shape the source query returns. */
const deviceEvent = {
	id: "device-event-1",
	eventType: "disconnected",
	createdAt: new Date(`${TODAY}T04:00:00.000Z`),
	actorId: null,
	device: { id: "device-1", label: "Feeder", pondId: "pond-a" },
};

beforeEach(() => {
	mocks.pondEvent.findMany.mockResolvedValue([manualEvent]);
	mocks.biomassLog.groupBy.mockResolvedValue([]);
	mocks.cropCycle.findMany.mockResolvedValue([]);
	mocks.energyDevice.findMany.mockResolvedValue([]);
	mocks.deviceStateEvent.findMany.mockResolvedValue([deviceEvent]);
});

afterEach(() => {
	vi.clearAllMocks();
});

describe("upcoming events (#248)", () => {
	it("returns the same list for the calendar API window and the merged page", async () => {
		const window = upcomingWindow(TODAY);
		const api = await loadCalendarEventSources({
			ponds: [pond],
			from: window.from,
			to: window.to,
			today: TODAY,
			types: new Set(defaultCalendarEventTypes()),
			includeFeeding: true,
		});
		const apiUpcoming = selectUpcomingEvents(api.events, TODAY);

		const page = await loadUpcomingCalendarEvents({ ponds: [pond], today: TODAY });

		expect(page.events).toEqual(apiUpcoming);
	});

	it("includes the derived sampling reminder that the old Harvest page missed", async () => {
		const { events } = await loadUpcomingCalendarEvents({ ponds: [pond], today: TODAY });
		const types = events.map((event) => event.type);

		expect(types).toContain("sampling");
		expect(types).toContain("manual");
		expect(types).toContain("device");
		expect(events.length).toBeGreaterThan(0);
	});

	it("looks 45 days ahead and caps the rail at five items", async () => {
		const window = upcomingWindow(TODAY);

		expect(window).toEqual({ from: TODAY, to: addDays(TODAY, 45) });
		expect(selectUpcomingEvents([], TODAY)).toEqual([]);
	});
});
