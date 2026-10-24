import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	pond: { findMany: vi.fn() },
	pondEvent: { findMany: vi.fn() },
	biomassLog: { groupBy: vi.fn() },
	cropCycle: { findMany: vi.fn() },
	energyDevice: { findMany: vi.fn() },
	deviceStateEvent: { findMany: vi.fn() },
	resolveCurrentSchedule: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
	default: {
		pond: mocks.pond,
		pondEvent: mocks.pondEvent,
		biomassLog: mocks.biomassLog,
		cropCycle: mocks.cropCycle,
		energyDevice: mocks.energyDevice,
		deviceStateEvent: mocks.deviceStateEvent,
	},
}));

vi.mock("@/lib/schedule/resolve-current", () => ({
	resolveCurrentSchedule: mocks.resolveCurrentSchedule,
}));

vi.mock("@/lib/auth/with-auth", () => ({
	withAuth:
		(
			handler: (
				request: Request,
				context: { ownerId: string; user: { id: string; email: string } },
			) => Promise<Response>,
		) =>
		async (request: Request) =>
			handler(request, {
				ownerId: "owner-1",
				user: { id: "user-1", email: "owner@example.com" },
			}),
}));

import { GET } from "@/app/api/calendar/events/route";
import {
	CALENDAR_EVENT_TYPES,
	type CalendarEventDto,
	type CalendarEventType,
	isCalendarEventType,
	pondEventCalendarType,
} from "../crop-cycle/calendar";
import { addDays, todayDateOnly } from "../crop-cycle/dates";

const TODAY = todayDateOnly();
const FROM = addDays(TODAY, 1);
const TO = addDays(TODAY, 40);

const pondA = {
	id: "pond-a",
	name: "Pond A",
	sampleIntervalDays: 7,
	createdAt: new Date("2026-01-01T00:00:00.000Z"),
	isFallow: false,
};

const pondB = {
	id: "pond-b",
	name: "Pond B",
	sampleIntervalDays: 14,
	createdAt: new Date("2026-02-01T00:00:00.000Z"),
	isFallow: false,
};

type MockedFunction = { mockReset: () => void };

function resetMockTree(value: unknown): void {
	if (!value || typeof value !== "object") return;
	for (const nested of Object.values(value as Record<string, unknown>)) {
		if (typeof nested === "function" && "mockReset" in nested) {
			(nested as MockedFunction).mockReset();
			continue;
		}
		if (nested && typeof nested === "object") resetMockTree(nested);
	}
}

function resetAllMocks(): void {
	for (const value of Object.values(mocks)) {
		if (typeof value === "function" && "mockReset" in value) {
			(value as MockedFunction).mockReset();
			continue;
		}
		if (value && typeof value === "object") resetMockTree(value);
	}
}

interface CalendarBody {
	data?: {
		events: CalendarEventDto[];
		truncated: boolean;
		from: string;
		to: string;
	};
	error?: { code: string; message: string };
}

async function callCalendar(params: Record<string, string> = {}) {
	const search = new URLSearchParams({ from: FROM, to: TO, ...params });
	const response = await GET(
		new Request(`http://test.local/api/calendar/events?${search.toString()}`) as never,
	);
	const body = (await response.json()) as CalendarBody;
	return { response, body, events: body.data?.events ?? [] };
}

function persistedEvent(overrides: Record<string, unknown> = {}) {
	return {
		id: "event-1",
		title: "Harvest planned",
		startsAt: new Date(`${FROM}T00:00:00.000Z`),
		status: "PLANNED",
		type: "HARVEST_PLANNED",
		source: "cycle",
		notes: null,
		pond: { id: "pond-a", name: "Pond A" },
		cropCycle: { label: "Batch A" },
		...overrides,
	};
}

function feedingSchedule(overrides: Record<string, unknown> = {}) {
	return {
		scheduleStart: new Date("1970-01-01T06:00:00.000Z"),
		scheduleEnd: new Date("1970-01-01T18:00:00.000Z"),
		feedsPerDay: 3,
		feedingRatePct: 3,
		...overrides,
	};
}

let consoleError: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
	resetAllMocks();
	consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
	mocks.pond.findMany.mockResolvedValue([pondA, pondB]);
	mocks.pondEvent.findMany.mockResolvedValue([]);
	mocks.biomassLog.groupBy.mockResolvedValue([]);
	mocks.cropCycle.findMany.mockResolvedValue([]);
	mocks.energyDevice.findMany.mockResolvedValue([]);
	mocks.deviceStateEvent.findMany.mockResolvedValue([]);
	mocks.resolveCurrentSchedule.mockResolvedValue(null);
});

afterEach(() => {
	consoleError.mockRestore();
});

describe("calendar helper types", () => {
	it("recognises the calendar event type union", () => {
		expect(CALENDAR_EVENT_TYPES).toEqual(["harvest", "sampling", "manual", "feeding", "device"]);
		for (const type of CALENDAR_EVENT_TYPES) {
			expect(isCalendarEventType(type)).toBe(true);
		}
		for (const value of ["", "all", "Harvest", "sampling ", "device_event"]) {
			expect(isCalendarEventType(value)).toBe(false);
		}
	});

	it("maps every persisted pond event type to a calendar type", () => {
		const expected: Record<string, CalendarEventType> = {
			STOCKING: "manual",
			HARVEST_PLANNED: "harvest",
			HARVEST_ACTUAL: "harvest",
			SAMPLING: "manual",
			MAINTENANCE: "manual",
			OTHER: "manual",
		};
		for (const [type, calendarType] of Object.entries(expected)) {
			expect(pondEventCalendarType(type as Parameters<typeof pondEventCalendarType>[0])).toBe(
				calendarType,
			);
		}
	});

	it("keeps the documented DTO shape", () => {
		const dto: CalendarEventDto = {
			id: "pond:event-1",
			title: "Harvest planned",
			start: "2026-10-24",
			allDay: true,
			type: "harvest",
			status: "planned",
			kind: "HARVEST_PLANNED",
			editable: true,
			pondId: "pond-a",
			pondName: "Pond A",
			cycleLabel: "Batch A",
			notes: null,
			href: "/dashboard/harvest",
		};
		expect(dto).toMatchObject({
			id: expect.stringContaining(":"),
			allDay: true,
			editable: true,
			type: "harvest",
		});
	});
});

describe("GET /api/calendar/events validation", () => {
	it("rejects invalid from/to dates", async () => {
		const invalid = await callCalendar({ from: "2026-02-30" });
		expect(invalid.response.status).toBe(422);
		expect(invalid.body.error?.code).toBe("VALIDATION_FAILED");
		expect(invalid.body.error?.message).toContain("valid YYYY-MM-DD");

		const missing = await callCalendar({ to: "not-a-date" });
		expect(missing.response.status).toBe(422);
	});

	it("rejects an empty or inverted range", async () => {
		const empty = await callCalendar({ from: TODAY, to: TODAY });
		expect(empty.response.status).toBe(422);
		expect(empty.body.error?.message).toContain("between 1 and 400 days");

		const inverted = await callCalendar({ from: addDays(TODAY, 2), to: TODAY });
		expect(inverted.response.status).toBe(422);
	});

	it("rejects a range longer than 400 days", async () => {
		const result = await callCalendar({
			from: addDays(TODAY, -200),
			to: addDays(TODAY, 201),
		});
		expect(result.response.status).toBe(422);
		expect(result.body.error?.message).toContain("400");
	});

	it("returns 404 when the farm has no active pond", async () => {
		mocks.pond.findMany.mockResolvedValue([]);

		const result = await callCalendar();

		expect(result.response.status).toBe(404);
		expect(result.body.error?.code).toBe("NOT_FOUND");
		expect(result.body.error?.message).toBe("No active pond.");
	});

	it("returns 404 for a pond that the caller does not own", async () => {
		const result = await callCalendar({ pondId: "pond-other" });

		expect(result.response.status).toBe(404);
		expect(result.body.error?.message).toBe("Pond not found.");
		expect(mocks.pondEvent.findMany).not.toHaveBeenCalled();
	});

	it("scopes the pond query to the authenticated owner", async () => {
		await callCalendar();

		expect(mocks.pond.findMany).toHaveBeenCalledWith({
			where: { ownerId: "owner-1", status: "ACTIVE" },
			select: {
				id: true,
				name: true,
				sampleIntervalDays: true,
				createdAt: true,
				isFallow: true,
			},
			orderBy: { createdAt: "asc" },
			take: 100,
		});
	});
});

describe("GET /api/calendar/events pond scoping", () => {
	it("includes every owned pond for pondId=all", async () => {
		await callCalendar({ pondId: "all", types: "harvest" });

		const args = mocks.pondEvent.findMany.mock.calls[0]?.[0] as {
			where: {
				pondId: { in: string[] };
				startsAt: { gte: Date; lt: Date };
			};
		};
		expect(args.where.pondId.in).toEqual(["pond-a", "pond-b"]);
		expect(args.where.startsAt.gte.toISOString()).toBe(`${FROM}T00:00:00.000Z`);
		expect(args.where.startsAt.lt.toISOString()).toBe(`${addDays(TO, 1)}T00:00:00.000Z`);
	});

	it("defaults to the first active pond", async () => {
		await callCalendar();

		const args = mocks.pondEvent.findMany.mock.calls[0]?.[0] as {
			where: { pondId: { in: string[] } };
		};
		expect(args.where.pondId.in).toEqual(["pond-a"]);
	});

	it("treats pondId=active as the first active pond", async () => {
		await callCalendar({ pondId: "active" });

		const args = mocks.pondEvent.findMany.mock.calls[0]?.[0] as {
			where: { pondId: { in: string[] } };
		};
		expect(args.where.pondId.in).toEqual(["pond-a"]);
	});

	it("queries only the selected pond and never another pond's rows", async () => {
		await callCalendar({ pondId: "pond-b", types: "harvest,sampling" });

		const eventArgs = mocks.pondEvent.findMany.mock.calls[0]?.[0] as {
			where: { pondId: { in: string[] } };
		};
		expect(eventArgs.where.pondId.in).toEqual(["pond-b"]);

		const groupByArgs = mocks.biomassLog.groupBy.mock.calls[0]?.[0] as {
			where: { pondId: { in: string[] } };
		};
		expect(groupByArgs.where.pondId.in).toEqual(["pond-b"]);

		const cycleArgs = mocks.cropCycle.findMany.mock.calls[0]?.[0] as {
			where: { pondId: { in: string[] } };
		};
		expect(cycleArgs.where.pondId.in).toEqual(["pond-b"]);
	});

	it("drops device events that belong to a pond outside the selection", async () => {
		mocks.deviceStateEvent.findMany.mockResolvedValue([
			{
				id: "device-event-a",
				eventType: "disconnected",
				createdAt: new Date(`${FROM}T08:00:00.000Z`),
				device: { id: "dev-a", label: "Feeder A", pondId: "pond-a" },
			},
			{
				id: "device-event-b",
				eventType: "connected",
				createdAt: new Date(`${FROM}T09:00:00.000Z`),
				device: { id: "dev-b", label: "Feeder B", pondId: "pond-b" },
			},
		]);

		const { events } = await callCalendar({ pondId: "pond-a", types: "device" });

		expect(events).toHaveLength(1);
		expect(events[0]?.id).toBe("device:device-event-a");
		expect(events.some((event) => event.pondId === "pond-b")).toBe(false);
		expect(mocks.deviceStateEvent.findMany).toHaveBeenCalledWith(
			expect.objectContaining({
				where: expect.objectContaining({
					device: { pondId: { in: ["pond-a"] } },
				}),
			}),
		);
	});
});

describe("GET /api/calendar/events persisted events", () => {
	it("maps persisted rows to the calendar DTO", async () => {
		mocks.pondEvent.findMany.mockResolvedValue([
			persistedEvent(),
			persistedEvent({
				id: "event-2",
				title: "Clean the aerator",
				type: "MAINTENANCE",
				source: "manual",
				status: "DONE",
				notes: "Bring tools",
				cropCycle: null,
			}),
			persistedEvent({
				id: "event-3",
				title: "Harvest completed",
				type: "HARVEST_ACTUAL",
				source: "cycle",
				status: "DONE",
			}),
			persistedEvent({
				id: "event-4",
				title: "Stocking",
				type: "STOCKING",
				source: "cycle",
				status: "DONE",
			}),
		]);

		const { events } = await callCalendar({ pondId: "pond-a", types: "harvest,manual" });

		expect(events).toHaveLength(4);
		expect(events[0]).toEqual({
			id: "pond:event-1",
			title: "Harvest planned",
			start: FROM,
			allDay: true,
			type: "harvest",
			status: "planned",
			kind: "HARVEST_PLANNED",
			editable: true,
			pondId: "pond-a",
			pondName: "Pond A",
			cycleLabel: "Batch A",
			notes: null,
			href: "/dashboard/harvest",
		});
		expect(events[1]).toMatchObject({
			type: "manual",
			status: "done",
			editable: true,
			kind: "MAINTENANCE",
			cycleLabel: null,
			notes: "Bring tools",
		});
		// Actual harvest and stocking are cycle milestones, never editable.
		expect(events[2]).toMatchObject({ type: "harvest", editable: false });
		expect(events[3]).toMatchObject({ type: "manual", editable: false });
	});

	it("filters persisted rows by the requested calendar types", async () => {
		mocks.pondEvent.findMany.mockResolvedValue([
			persistedEvent(),
			persistedEvent({
				id: "event-2",
				title: "Clean the aerator",
				type: "MAINTENANCE",
				source: "manual",
				status: "DONE",
			}),
		]);

		const { events } = await callCalendar({ pondId: "pond-a", types: "harvest,unknown" });

		expect(events).toHaveLength(1);
		expect(events[0]?.type).toBe("harvest");
	});

	it("ignores an all-unknown types list and falls back to the default set", async () => {
		await callCalendar({ pondId: "pond-a", types: "nonsense" });

		expect(mocks.pondEvent.findMany).toHaveBeenCalledTimes(1);
		expect(mocks.biomassLog.groupBy).toHaveBeenCalledTimes(1);
		expect(mocks.deviceStateEvent.findMany).toHaveBeenCalledTimes(1);
		// Feeding is excluded from the default set.
		expect(mocks.energyDevice.findMany).not.toHaveBeenCalled();
		expect(mocks.resolveCurrentSchedule).not.toHaveBeenCalled();
	});
});

describe("GET /api/calendar/events derived sampling", () => {
	it("generates future sampling due dates from the latest sample", async () => {
		mocks.biomassLog.groupBy.mockResolvedValue([
			{
				pondId: "pond-a",
				_max: { recordedAt: new Date(`${addDays(TODAY, -20)}T00:00:00.000Z`) },
			},
		]);
		const from = addDays(TODAY, 1);
		const to = addDays(TODAY, 30);

		const { events } = await callCalendar({ from, to, types: "sampling" });

		expect(events).toHaveLength(5);
		expect(events.map((event) => event.start)).toEqual([
			addDays(TODAY, 1),
			addDays(TODAY, 8),
			addDays(TODAY, 15),
			addDays(TODAY, 22),
			addDays(TODAY, 29),
		]);
		expect(events[0]).toMatchObject({
			id: `sampling:pond-a:${addDays(TODAY, 1)}`,
			title: "Sampling due",
			allDay: true,
			type: "sampling",
			status: "planned",
			editable: false,
			pondId: "pond-a",
			pondName: "Pond A",
			href: "/dashboard/log-sample",
		});
	});

	it("marks samples whose due date already passed as missed", async () => {
		mocks.biomassLog.groupBy.mockResolvedValue([
			{
				pondId: "pond-a",
				_max: { recordedAt: new Date(`${addDays(TODAY, -20)}T00:00:00.000Z`) },
			},
		]);

		const { events } = await callCalendar({
			from: addDays(TODAY, -30),
			to: addDays(TODAY, -1),
			types: "sampling",
		});

		expect(events.length).toBeGreaterThan(0);
		expect(events.every((event) => event.status === "missed")).toBe(true);
	});

	it("falls back to the active cycle stocking date when no sample exists", async () => {
		mocks.cropCycle.findMany.mockResolvedValue([
			{
				pondId: "pond-a",
				stockingDate: new Date(`${addDays(TODAY, -20)}T00:00:00.000Z`),
			},
		]);

		const { events } = await callCalendar({
			from: addDays(TODAY, 1),
			to: addDays(TODAY, 15),
			types: "sampling",
		});

		expect(events.map((event) => event.start)).toEqual([
			addDays(TODAY, 1),
			addDays(TODAY, 8),
			addDays(TODAY, 15),
		]);
	});

	it("caps derived sampling events at 12 per pond", async () => {
		mocks.biomassLog.groupBy.mockResolvedValue([
			{
				pondId: "pond-a",
				_max: { recordedAt: new Date(`${addDays(TODAY, -1)}T00:00:00.000Z`) },
			},
		]);
		mocks.pond.findMany.mockResolvedValue([{ ...pondA, sampleIntervalDays: 1 }]);

		const { events } = await callCalendar({
			from: TODAY,
			to: addDays(TODAY, 30),
			types: "sampling",
		});

		expect(events).toHaveLength(12);
		expect(events[0]?.start).toBe(TODAY);
		expect(events[11]?.start).toBe(addDays(TODAY, 11));
	});
});

describe("GET /api/calendar/events derived feeding", () => {
	it("generates background feeding bands from the current schedule", async () => {
		mocks.energyDevice.findMany.mockResolvedValue([
			{ id: "dev-a", pondId: "pond-a", isPaused: false },
		]);
		mocks.resolveCurrentSchedule.mockResolvedValue(feedingSchedule());

		const { events } = await callCalendar({
			from: TODAY,
			to: addDays(TODAY, 1),
			types: "feeding",
		});

		expect(events).toHaveLength(6);
		expect(events.slice(0, 3).map((event) => event.start)).toEqual([
			`${TODAY}T06:00:00`,
			`${TODAY}T12:00:00`,
			`${TODAY}T18:00:00`,
		]);
		expect(events[0]).toMatchObject({
			type: "feeding",
			status: "planned",
			allDay: false,
			display: "background",
			editable: false,
			pondId: "pond-a",
			pondName: "Pond A",
		});
		// Feeding-only requests must not query persisted cycle events.
		expect(mocks.pondEvent.findMany).not.toHaveBeenCalled();
	});

	it("skips feeding for a fallow pond", async () => {
		mocks.pond.findMany.mockResolvedValue([{ ...pondA, isFallow: true }]);
		mocks.energyDevice.findMany.mockResolvedValue([
			{ id: "dev-a", pondId: "pond-a", isPaused: false },
		]);
		mocks.resolveCurrentSchedule.mockResolvedValue(feedingSchedule());

		const { events } = await callCalendar({
			from: TODAY,
			to: addDays(TODAY, 1),
			types: "feeding",
		});

		expect(events).toEqual([]);
	});

	it("skips feeding for a paused device", async () => {
		mocks.energyDevice.findMany.mockResolvedValue([
			{ id: "dev-a", pondId: "pond-a", isPaused: true },
		]);
		mocks.resolveCurrentSchedule.mockResolvedValue(feedingSchedule());

		const { events } = await callCalendar({
			from: TODAY,
			to: addDays(TODAY, 1),
			types: "feeding",
		});

		expect(events).toEqual([]);
	});

	it("skips feeding when no schedule resolves", async () => {
		mocks.energyDevice.findMany.mockResolvedValue([
			{ id: "dev-a", pondId: "pond-a", isPaused: false },
		]);
		mocks.resolveCurrentSchedule.mockResolvedValue(null);

		const { events } = await callCalendar({
			from: TODAY,
			to: addDays(TODAY, 1),
			types: "feeding",
		});

		expect(events).toEqual([]);
	});

	it("does not query feeding for a range longer than 62 days", async () => {
		const { events } = await callCalendar({
			from: TODAY,
			to: addDays(TODAY, 63),
			types: "feeding",
		});

		expect(events).toEqual([]);
		expect(mocks.energyDevice.findMany).not.toHaveBeenCalled();
		expect(mocks.resolveCurrentSchedule).not.toHaveBeenCalled();
	});

	it("caps merged events at 1000 and reports truncation", async () => {
		mocks.energyDevice.findMany.mockResolvedValue([
			{ id: "dev-a", pondId: "pond-a", isPaused: false },
		]);
		mocks.resolveCurrentSchedule.mockResolvedValue(feedingSchedule({ feedsPerDay: 24 }));

		const { body, events } = await callCalendar({
			from: TODAY,
			to: addDays(TODAY, 62),
			types: "feeding",
		});

		// 63 days × 24 feeds = 1512 → feeding cap 1500 → merged cap 1000.
		expect(events).toHaveLength(1000);
		expect(body.data?.truncated).toBe(true);
	});
});

describe("GET /api/calendar/events device events and response", () => {
	it("maps whitelisted device events and their titles", async () => {
		mocks.deviceStateEvent.findMany.mockResolvedValue([
			{
				id: "device-event-a",
				eventType: "disconnected",
				createdAt: new Date(`${FROM}T08:00:00.000Z`),
				device: { id: "dev-a", label: "Feeder A", pondId: "pond-a" },
			},
			{
				id: "device-event-b",
				eventType: "pellet_low",
				createdAt: new Date(`${FROM}T09:00:00.000Z`),
				device: { id: "dev-a", label: "Feeder A", pondId: "pond-a" },
			},
		]);

		const { events } = await callCalendar({ pondId: "pond-a", types: "device" });

		expect(events).toHaveLength(2);
		expect(events[0]).toMatchObject({
			id: "device:device-event-a",
			title: "Device offline",
			allDay: false,
			type: "device",
			status: "done",
			editable: false,
			pondId: "pond-a",
			pondName: "Pond A",
			notes: "Feeder A",
		});
		expect(events[0]?.start).toBe(`${FROM}T08:00:00.000Z`);
		expect(events[1]?.title).toBe("Feed level low");
	});

	it("returns the range, truncation flag and a no-store cache header", async () => {
		const { response, body } = await callCalendar({
			from: FROM,
			to: TO,
			types: "harvest",
		});

		expect(response.status).toBe(200);
		expect(response.headers.get("cache-control")).toBe("no-store");
		expect(body.data).toEqual({
			events: [],
			truncated: false,
			from: FROM,
			to: TO,
		});
	});

	it("sorts merged events by start time", async () => {
		mocks.pondEvent.findMany.mockResolvedValue([
			persistedEvent({
				id: "late",
				startsAt: new Date(`${addDays(TODAY, 5)}T00:00:00.000Z`),
			}),
			persistedEvent({
				id: "early",
				startsAt: new Date(`${addDays(TODAY, 2)}T00:00:00.000Z`),
			}),
		]);

		const { events } = await callCalendar({ pondId: "pond-a", types: "harvest" });

		expect(events.map((event) => event.id)).toEqual(["pond:early", "pond:late"]);
	});
});
