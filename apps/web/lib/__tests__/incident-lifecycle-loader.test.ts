import { beforeEach, describe, expect, it, vi } from "vitest";

const { db, gate } = vi.hoisted(() => ({
	db: {
		platformIncident: { findMany: vi.fn(), findUnique: vi.fn(), count: vi.fn() },
		platformIncidentEvent: { findMany: vi.fn() },
		organization: { findMany: vi.fn() },
		pond: { findMany: vi.fn() },
		energyDevice: { findMany: vi.fn() },
		user: { findMany: vi.fn() },
		platformAdmin: { findMany: vi.fn() },
	},
	gate: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({ default: db }));
vi.mock("@/lib/auth/require-platform-admin", () => ({ requirePlatformAdmin: gate }));

import {
	getPlatformIncidentDetail,
	listPlatformIncidentOwners,
	loadTrackedIncidents,
} from "@/lib/platform/incident-lifecycle";

/**
 * The stored incident loader (issue #479, M3C.6).
 *
 * These cover what the pages are given: open rows first, an overdue escalation
 * flagged, names resolved without hiding the incident when a join fails, and a
 * failed read that is unavailable rather than an empty "all clear".
 */

const NOW = new Date("2026-11-02T12:00:00.000Z");
const MINUTE = 60 * 1000;

function row(overrides: Record<string, unknown> = {}) {
	return {
		id: "inc-1",
		dedupeKey: "device_offline:dev-1",
		source: "DEVICE_OFFLINE",
		severity: "CRITICAL",
		status: "ESCALATED",
		title: "Feeder A is offline",
		summary: null,
		orgId: "org-1",
		pondId: "pond-1",
		deviceId: "dev-1",
		ownerId: "admin-2",
		openedAt: new Date(NOW.getTime() - 90 * MINUTE),
		acknowledgedAt: null,
		resolvedAt: null,
		escalatedAt: new Date(NOW.getTime() - 40 * MINUTE),
		ackDueAt: new Date(NOW.getTime() - 10 * MINUTE),
		lastSeenAt: new Date(NOW.getTime() - 2 * MINUTE),
		metadata: { deviceId: "dev-1" },
		...overrides,
	};
}

beforeEach(() => {
	vi.clearAllMocks();
	gate.mockResolvedValue(undefined);
	db.platformIncident.findMany.mockReset().mockResolvedValue([]);
	db.platformIncident.findUnique.mockReset().mockResolvedValue(null);
	db.platformIncident.count.mockReset().mockResolvedValue(0);
	db.platformIncidentEvent.findMany.mockReset().mockResolvedValue([]);
	db.organization.findMany.mockReset().mockResolvedValue([{ id: "org-1", name: "Alpha" }]);
	db.pond.findMany.mockReset().mockResolvedValue([{ id: "pond-1", name: "Pond 1" }]);
	db.energyDevice.findMany.mockReset().mockResolvedValue([{ id: "dev-1", label: "Feeder A" }]);
	db.user.findMany.mockReset().mockResolvedValue([
		{ id: "admin-2", displayName: "Ana Admin", email: "ana@example.test" },
		{ id: "admin-1", displayName: null, email: "boss@example.test" },
	]);
	db.platformAdmin.findMany
		.mockReset()
		.mockResolvedValue([{ userId: "admin-2" }, { userId: "admin-1" }]);
});

describe("loadTrackedIncidents", () => {
	it("maps open rows, names, age and an overdue acknowledgement target", async () => {
		db.platformIncident.findMany
			.mockResolvedValueOnce([row()])
			.mockResolvedValueOnce([row({ id: "inc-2", status: "RESOLVED", resolvedAt: NOW })]);
		db.platformIncident.count.mockResolvedValue(1);

		const board = await loadTrackedIncidents(NOW);

		expect(board.available).toBe(true);
		expect(board.totalOpen).toBe(1);
		expect(board.rows).toHaveLength(2);
		const open = board.rows[0];
		expect(open).toMatchObject({
			id: "inc-1",
			status: "ESCALATED",
			severity: "CRITICAL",
			orgName: "Alpha",
			pondName: "Pond 1",
			deviceLabel: "Feeder A",
			ownerName: "Ana Admin",
			ackOverdue: true,
		});
		expect(open?.ageMs).toBe(90 * MINUTE);
		expect(board.summary).toMatchObject({ open: 1, escalated: 1, overdue: 1, resolved: 1 });
	});

	it("returns unavailable, not an empty board, when the read fails", async () => {
		db.platformIncident.findMany.mockRejectedValue(new Error("relation missing"));

		const board = await loadTrackedIncidents(NOW);

		expect(board.available).toBe(false);
		expect(board.rows).toEqual([]);
		expect(board.summary).toMatchObject({ open: 0, escalated: 0, overdue: 0 });
	});

	it("still shows an incident whose name joins failed", async () => {
		db.platformIncident.findMany.mockResolvedValueOnce([row()]).mockResolvedValueOnce([]);
		db.platformIncident.count.mockResolvedValue(1);
		db.organization.findMany.mockRejectedValue(new Error("join failed"));
		db.user.findMany.mockRejectedValue(new Error("join failed"));

		const board = await loadTrackedIncidents(NOW);

		expect(board.available).toBe(true);
		expect(board.rows[0]).toMatchObject({
			id: "inc-1",
			orgName: null,
			ownerName: null,
			status: "ESCALATED",
		});
	});

	it("says when the open read was cut at its cap", async () => {
		const many = Array.from({ length: 201 }, (_, index) =>
			row({ id: `inc-${index}`, status: "NEW", ackDueAt: null }),
		);
		db.platformIncident.findMany.mockResolvedValueOnce(many).mockResolvedValueOnce([]);
		db.platformIncident.count.mockResolvedValue(201);

		const board = await loadTrackedIncidents(NOW);

		expect(board.truncated).toBe(true);
		expect(board.totalOpen).toBe(201);
	});
});

describe("listPlatformIncidentOwners", () => {
	it("lists active platform admins by label and gates the read", async () => {
		const result = await listPlatformIncidentOwners(NOW);

		expect(gate).toHaveBeenCalled();
		expect(result.available).toBe(true);
		expect(result.owners).toEqual([
			{ id: "admin-2", label: "Ana Admin" },
			{ id: "admin-1", label: "boss@example.test" },
		]);
	});

	it("is unavailable when the owner read fails", async () => {
		db.platformAdmin.findMany.mockRejectedValue(new Error("db down"));
		expect(await listPlatformIncidentOwners(NOW)).toEqual({ available: false, owners: [] });
	});
});

describe("getPlatformIncidentDetail", () => {
	it("returns the incident, its timeline and the owner picker", async () => {
		db.platformIncident.findUnique.mockResolvedValue(row());
		db.platformIncidentEvent.findMany.mockResolvedValue([
			{
				id: "evt-1",
				type: "AUTO_OPENED",
				fromStatus: null,
				toStatus: "NEW",
				actorId: null,
				note: "Opened automatically by the device watch.",
				metadata: {},
				createdAt: new Date(NOW.getTime() - 90 * MINUTE),
			},
			{
				id: "evt-2",
				type: "ESCALATED",
				fromStatus: "NEW",
				toStatus: "ESCALATED",
				actorId: "admin-2",
				note: "Escalated to the on-call admin",
				metadata: {},
				createdAt: new Date(NOW.getTime() - 40 * MINUTE),
			},
		]);

		const detail = await getPlatformIncidentDetail("inc-1", NOW);

		expect(detail?.incident).toMatchObject({ id: "inc-1", ownerName: "Ana Admin" });
		expect(detail?.eventsAvailable).toBe(true);
		expect(detail?.events).toHaveLength(2);
		expect(detail?.events[0]).toMatchObject({ actorId: null, actorName: null });
		expect(detail?.events[1]).toMatchObject({ actorId: "admin-2", actorName: "Ana Admin" });
		expect(detail?.owners.map((owner) => owner.id)).toEqual(["admin-2", "admin-1"]);
	});

	it("returns null for an unknown id", async () => {
		expect(await getPlatformIncidentDetail("gone", NOW)).toBeNull();
	});

	it("flags a failed timeline read instead of rendering no history", async () => {
		db.platformIncident.findUnique.mockResolvedValue(row());
		db.platformIncidentEvent.findMany.mockRejectedValue(new Error("timeline down"));

		const detail = await getPlatformIncidentDetail("inc-1", NOW);

		expect(detail?.eventsAvailable).toBe(false);
		expect(detail?.events).toEqual([]);
		expect(detail?.incident.id).toBe("inc-1");
	});
});
