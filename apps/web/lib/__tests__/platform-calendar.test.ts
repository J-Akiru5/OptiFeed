import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	organization: { findMany: vi.fn() },
	pond: { findMany: vi.fn() },
	membership: { findMany: vi.fn() },
	user: { findMany: vi.fn() },
	pondEvent: { findMany: vi.fn() },
	biomassLog: { groupBy: vi.fn() },
	cropCycle: { findMany: vi.fn() },
	deviceStateEvent: { findMany: vi.fn() },
	energyDevice: { findMany: vi.fn() },
	requirePlatformAdmin: vi.fn(),
	resolveCurrentSchedule: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
	default: {
		organization: mocks.organization,
		pond: mocks.pond,
		membership: mocks.membership,
		user: mocks.user,
		pondEvent: mocks.pondEvent,
		biomassLog: mocks.biomassLog,
		cropCycle: mocks.cropCycle,
		deviceStateEvent: mocks.deviceStateEvent,
		energyDevice: mocks.energyDevice,
	},
}));

vi.mock("@/lib/auth/require-platform-admin", () => ({
	requirePlatformAdmin: mocks.requirePlatformAdmin,
}));

vi.mock("@/lib/schedule/resolve-current", () => ({
	resolveCurrentSchedule: mocks.resolveCurrentSchedule,
}));

import {
	listPlatformCalendarEvents,
	loadPlatformCalendarData,
	parsePlatformCalendarQuery,
} from "../calendar/platform-events";

const FROM = "2026-02-01";
const TO = "2026-02-10";

const pondA = {
	id: "pond-a",
	name: "Pond A",
	sampleIntervalDays: 7,
	createdAt: new Date("2026-01-01T00:00:00.000Z"),
	isFallow: false,
	ownerId: "farm-a",
	owner: { id: "user-a", displayName: "Ana" },
};

const pondB = {
	id: "pond-b",
	name: "Pond B",
	sampleIntervalDays: 14,
	createdAt: new Date("2026-01-01T00:00:00.000Z"),
	isFallow: false,
	ownerId: "farm-b",
	owner: { id: "user-b", displayName: "Ben" },
};

function persistedEvent(overrides: Record<string, unknown> = {}) {
	return {
		id: "event-1",
		pondId: "pond-a",
		title: "Harvest planned",
		startsAt: new Date(`${FROM}T00:00:00.000Z`),
		endsAt: null,
		allDay: true,
		status: "PLANNED",
		type: "HARVEST_PLANNED",
		kind: "EVENT",
		source: "cycle",
		color: null,
		notes: null,
		createdBy: "creator-1",
		recurrenceFreq: null,
		recurrenceInterval: 1,
		recurrenceUntil: null,
		reminderMinutes: [],
		completedOccurrences: [],
		pond: { id: "pond-a", name: "Pond A" },
		cropCycle: { label: "Batch A" },
		...overrides,
	};
}

function filters(overrides: Partial<ReturnType<typeof parsePlatformCalendarQuery>> = {}) {
	return {
		...parsePlatformCalendarQuery({ from: FROM, to: TO }),
		...overrides,
	};
}

beforeEach(() => {
	vi.clearAllMocks();
	mocks.requirePlatformAdmin.mockResolvedValue(undefined);
	mocks.organization.findMany.mockResolvedValue([
		{ id: "org-a", name: "Org A" },
		{ id: "org-b", name: "Org B" },
	]);
	mocks.pond.findMany.mockResolvedValue([pondA, pondB]);
	mocks.membership.findMany.mockResolvedValue([
		{ userId: "user-a", orgId: "org-a" },
		{ userId: "user-b", orgId: "org-b" },
	]);
	mocks.user.findMany.mockResolvedValue([{ id: "creator-1", displayName: "Ana" }]);
	mocks.pondEvent.findMany.mockResolvedValue([]);
	mocks.biomassLog.groupBy.mockResolvedValue([]);
	mocks.cropCycle.findMany.mockResolvedValue([]);
	mocks.deviceStateEvent.findMany.mockResolvedValue([]);
	mocks.energyDevice.findMany.mockResolvedValue([]);
	mocks.resolveCurrentSchedule.mockResolvedValue(null);
});

describe("parsePlatformCalendarQuery", () => {
	it("defaults to the farmer calendar window and all tenants", () => {
		const parsed = parsePlatformCalendarQuery({}, "2026-10-27");

		expect(parsed).toEqual({
			from: "2026-10-13",
			to: "2026-12-11",
			orgIds: [],
			pondId: "all",
			types: ["harvest", "sampling", "manual", "device"],
		});
	});

	it("reads org, pond and type filters and de-duplicates orgs", () => {
		const parsed = parsePlatformCalendarQuery({
			orgs: "org-a,org-b,org-a",
			pond: "pond-b",
			types: "device,harvest",
		});

		expect(parsed.orgIds).toEqual(["org-a", "org-b"]);
		expect(parsed.pondId).toBe("pond-b");
		expect(parsed.types.sort()).toEqual(["device", "harvest"]);
	});

	it("falls back to the default window for invalid dates", () => {
		const parsed = parsePlatformCalendarQuery(
			{ from: "not-a-date", to: "2026-02-30" },
			"2026-10-27",
		);

		expect(parsed.from).toBe("2026-10-13");
		expect(parsed.to).toBe("2026-12-11");
	});

	it("keeps a one-day range instead of replacing it with the default window (#276)", () => {
		const parsed = parsePlatformCalendarQuery(
			{ from: "2026-10-27", to: "2026-10-27" },
			"2026-10-27",
		);

		expect(parsed.from).toBe("2026-10-27");
		expect(parsed.to).toBe("2026-10-27");
	});

	it("keeps 400 inclusive days and clamps a longer range to 400", () => {
		const max = parsePlatformCalendarQuery({ from: "2026-01-01", to: "2027-02-04" }, "2026-01-01");
		expect(max.from).toBe("2026-01-01");
		expect(max.to).toBe("2027-02-04");

		const over = parsePlatformCalendarQuery({ from: "2026-01-01", to: "2027-02-05" }, "2026-01-01");
		expect(over.from).toBe("2026-01-01");
		expect(over.to).toBe("2027-02-04");
	});
});

describe("loadPlatformCalendarData", () => {
	it("merges every source with org and creator metadata plus the OTA band", async () => {
		mocks.pondEvent.findMany.mockResolvedValue([
			persistedEvent(),
			persistedEvent({
				id: "task-1",
				title: "Check water",
				type: "SAMPLING",
				kind: "TASK",
				source: "manual",
				recurrenceFreq: "WEEKLY",
				recurrenceInterval: 1,
				cropCycle: null,
			}),
		]);
		mocks.deviceStateEvent.findMany.mockResolvedValue([
			{
				id: "device-event-1",
				eventType: "disconnected",
				actorId: "creator-1",
				createdAt: new Date(`${FROM}T08:00:00.000Z`),
				device: { id: "dev-a", label: "Feeder A", pondId: "pond-a" },
			},
		]);

		const data = await loadPlatformCalendarData(filters());

		const persisted = data.events.filter((event) => event.pondEventId === "event-1");
		expect(persisted).toHaveLength(1);
		expect(persisted[0]).toMatchObject({
			type: "harvest",
			orgIds: ["org-a"],
			orgNames: ["Org A"],
			createdByName: "Ana",
			editable: true,
		});

		// Recurrence expansion is the shared implementation, not a fork.
		const recurring = data.events.filter((event) => event.pondEventId === "task-1");
		expect(recurring.map((event) => event.start)).toEqual([FROM, "2026-02-08"]);

		const sampling = data.events.filter((event) => event.type === "sampling");
		expect(sampling.length).toBeGreaterThan(0);
		expect(sampling[0]).toMatchObject({ pondId: "pond-a", editable: false });

		const device = data.events.find((event) => event.id === "device:device-event-1");
		expect(device).toMatchObject({
			type: "device",
			deviceEventType: "disconnected",
			createdByName: "Ana",
			orgNames: ["Org A"],
		});

		const ota = data.events.filter((event) => event.kind === "OTA_WINDOW");
		expect(ota).toHaveLength(10);
		expect(ota[0]).toMatchObject({
			start: `${FROM}T10:00:00`,
			end: `${FROM}T15:00:00`,
			display: "background",
			editable: false,
		});

		// One range query per source, no per-pond loops.
		expect(mocks.pondEvent.findMany).toHaveBeenCalledTimes(1);
		expect(mocks.biomassLog.groupBy).toHaveBeenCalledTimes(1);
		expect(mocks.deviceStateEvent.findMany).toHaveBeenCalledTimes(1);
		expect(mocks.energyDevice.findMany).not.toHaveBeenCalled();
		expect(mocks.resolveCurrentSchedule).not.toHaveBeenCalled();
	});

	it("scopes the event queries to the selected organization's ponds", async () => {
		mocks.pondEvent.findMany.mockResolvedValue([
			persistedEvent({ pondId: "pond-b", pond: { id: "pond-b", name: "Pond B" } }),
		]);

		const data = await loadPlatformCalendarData(filters({ orgIds: ["org-b"] }));

		const args = mocks.pondEvent.findMany.mock.calls[0]?.[0] as {
			where: { pondId: { in: string[] } };
		};
		expect(args.where.pondId.in).toEqual(["pond-b"]);
		expect(data.events.some((event) => event.pondId === "pond-a")).toBe(false);
	});

	it("scopes to a single pond when the pond filter is set", async () => {
		mocks.pondEvent.findMany.mockResolvedValue([persistedEvent()]);

		await loadPlatformCalendarData(filters({ pondId: "pond-a" }));

		const args = mocks.pondEvent.findMany.mock.calls[0]?.[0] as {
			where: { pondId: { in: string[] } };
		};
		expect(args.where.pondId.in).toEqual(["pond-a"]);
	});

	it("only queries the sources selected by the event-type filter", async () => {
		await loadPlatformCalendarData(filters({ types: ["device"] }));

		expect(mocks.pondEvent.findMany).not.toHaveBeenCalled();
		expect(mocks.biomassLog.groupBy).not.toHaveBeenCalled();
		expect(mocks.cropCycle.findMany).not.toHaveBeenCalled();
		expect(mocks.deviceStateEvent.findMany).toHaveBeenCalledTimes(1);
	});
});

describe("listPlatformCalendarEvents gate", () => {
	it("does no work when the caller is not a platform admin", async () => {
		mocks.requirePlatformAdmin.mockRejectedValue(new Error("NEXT_REDIRECT"));

		await expect(listPlatformCalendarEvents({})).rejects.toThrow("NEXT_REDIRECT");
		expect(mocks.pond.findMany).not.toHaveBeenCalled();
	});

	it("loads the calendar after the platform-admin check passes", async () => {
		const data = await listPlatformCalendarEvents({ from: FROM, to: TO });

		expect(mocks.requirePlatformAdmin).toHaveBeenCalledTimes(1);
		expect(data.orgs.map((org) => org.name)).toEqual(["Org A", "Org B"]);
	});
});
