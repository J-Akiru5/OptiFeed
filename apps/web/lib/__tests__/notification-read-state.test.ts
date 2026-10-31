import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * #219: "Mark all as read" left the bell badge and every per-row "Acknowledge"
 * in place.
 *
 * The tests run against a small in-memory store that understands the Prisma
 * filters the actions use (`read`, `acknowledgedAt`, `pond.ownerId`), so the
 * assertions are about which rows actually change, not about which mock was
 * called. That is what catches the original bug: the old action filtered by one
 * pond id, so alerts from the owner's other ponds (and every row on another
 * farm) stayed pending.
 */

type NotificationRow = {
	id: string;
	pondId: string;
	read: boolean;
	acknowledgedAt: Date | null;
	acknowledgedBy: string | null;
	tier: string;
	category: string | null;
};

type Filter = {
	id?: string;
	pondId?: string;
	read?: boolean;
	acknowledgedAt?: Date | null;
	pond?: { ownerId?: string };
};

const PONDS = [
	{ id: "pond-a", ownerId: "farm-1" },
	{ id: "pond-b", ownerId: "farm-1" },
	{ id: "pond-x", ownerId: "farm-2" },
];

const state = {
	rows: [] as NotificationRow[],
	events: [] as Record<string, unknown>[],
};

function matches(row: NotificationRow, where: Filter = {}): boolean {
	if (where.id !== undefined && row.id !== where.id) return false;
	if (where.pondId !== undefined && row.pondId !== where.pondId) return false;
	if (where.read !== undefined && row.read !== where.read) return false;
	if (where.acknowledgedAt === null && row.acknowledgedAt !== null) return false;
	if (where.acknowledgedAt instanceof Date && row.acknowledgedAt === null) return false;
	if (where.pond?.ownerId) {
		const pond = PONDS.find((candidate) => candidate.id === row.pondId);
		if (!pond || pond.ownerId !== where.pond.ownerId) return false;
	}
	return true;
}

vi.mock("@/lib/prisma", () => ({
	default: {
		notification: {
			groupBy: vi.fn(),
			updateMany: vi.fn(),
			findFirst: vi.fn(),
			count: vi.fn(),
		},
		energyDevice: { findFirst: vi.fn(), findMany: vi.fn() },
		deviceStateEvent: { create: vi.fn(), createMany: vi.fn() },
	},
}));

vi.mock("@/lib/auth/session", () => ({
	getCurrentPondOwnerId: vi.fn().mockResolvedValue("farm-1"),
	requireWriteAccess: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { acknowledgeNotification, markAllNotificationsRead } from "@/lib/actions/notifications";
import { getCurrentPondOwnerId, requireWriteAccess } from "@/lib/auth/session";
import prisma from "@/lib/prisma";

const mockNotification = vi.mocked(prisma.notification);
const mockEnergyDevice = vi.mocked(prisma.energyDevice);
const mockDeviceStateEvent = vi.mocked(prisma.deviceStateEvent);
const mockRequireWriteAccess = vi.mocked(requireWriteAccess);
const mockGetCurrentPondOwnerId = vi.mocked(getCurrentPondOwnerId);

function row(overrides: Partial<NotificationRow> & Pick<NotificationRow, "id" | "pondId">) {
	return {
		read: false,
		acknowledgedAt: null,
		acknowledgedBy: null,
		tier: "INFO",
		category: "feeding",
		...overrides,
	} satisfies NotificationRow;
}

function byId(id: string): NotificationRow {
	const found = state.rows.find((candidate) => candidate.id === id);
	if (!found) throw new Error(`Missing fixture ${id}`);
	return found;
}

beforeEach(() => {
	vi.clearAllMocks();

	state.rows = [
		row({ id: "n1", pondId: "pond-a" }),
		row({ id: "n2", pondId: "pond-b" }),
		// Acknowledged earlier: already handled, must stay untouched.
		row({
			id: "n3",
			pondId: "pond-a",
			read: true,
			acknowledgedAt: new Date("2026-10-27T01:00:00Z"),
		}),
		// Auto-cleared on reconnect: read without a human acknowledgement.
		row({ id: "n4", pondId: "pond-a", read: true }),
		row({ id: "nx", pondId: "pond-x" }),
	];
	state.events = [];

	mockNotification.groupBy.mockImplementation((async ({ where }: { where: Filter }) => {
		const counts = new Map<string, number>();
		for (const candidate of state.rows.filter((value) => matches(value, where))) {
			counts.set(candidate.pondId, (counts.get(candidate.pondId) ?? 0) + 1);
		}
		return [...counts].map(([pondId, count]) => ({ pondId, _count: { _all: count } }));
	}) as never);

	mockNotification.updateMany.mockImplementation((async ({
		where,
		data,
	}: { where: Filter; data: Partial<NotificationRow> }) => {
		const targets = state.rows.filter((value) => matches(value, where));
		for (const target of targets) Object.assign(target, data);
		return { count: targets.length };
	}) as never);

	mockNotification.findFirst.mockImplementation((async ({ where }: { where: Filter }) => {
		const found = state.rows.find((value) => matches(value, where));
		return found ? { ...found } : null;
	}) as never);

	mockNotification.count.mockImplementation(
		(async ({ where }: { where: Filter }) =>
			state.rows.filter((value) => matches(value, where)).length) as never,
	);

	mockEnergyDevice.findFirst.mockImplementation((async ({
		where,
	}: { where: { pondId: string } }) =>
		where.pondId === "pond-x" ? null : { id: `dev-${where.pondId}` }) as never);
	mockEnergyDevice.findMany.mockImplementation((async ({
		where,
	}: { where: { pondId: { in: string[] } } }) =>
		where.pondId.in
			.filter((pondId) => pondId !== "pond-x")
			.sort()
			.map((pondId) => ({ id: `dev-${pondId}`, pondId }))) as never);
	mockDeviceStateEvent.create.mockImplementation((async ({
		data,
	}: { data: Record<string, unknown> }) => {
		state.events.push(data);
		return data;
	}) as never);
	mockDeviceStateEvent.createMany.mockImplementation((async ({
		data,
	}: {
		data: Record<string, unknown>[];
	}) => {
		state.events.push(...data);
		return { count: data.length };
	}) as never);

	mockRequireWriteAccess.mockResolvedValue(undefined);
	mockGetCurrentPondOwnerId.mockResolvedValue("farm-1");
});

describe("markAllNotificationsRead", () => {
	it("clears every pending notification of the owner across all of their ponds", async () => {
		const result = await markAllNotificationsRead();

		expect(result).toEqual({ success: true, count: 2 });

		for (const id of ["n1", "n2"]) {
			expect(byId(id).read).toBe(true);
			expect(byId(id).acknowledgedAt).toBeInstanceOf(Date);
			expect(byId(id).acknowledgedBy).toBe("farm-1");
		}

		// The bell counts unread rows for the active pond; it must read zero now.
		await expect(
			prisma.notification.count({ where: { pondId: "pond-a", read: false } }),
		).resolves.toBe(0);
	});

	it("never touches another farm's notifications", async () => {
		await markAllNotificationsRead();

		expect(byId("nx").read).toBe(false);
		expect(byId("nx").acknowledgedAt).toBeNull();
		expect(byId("nx").acknowledgedBy).toBeNull();
	});

	it("leaves the already handled and auto-cleared rows alone", async () => {
		await markAllNotificationsRead();

		expect(byId("n3").acknowledgedBy).toBeNull();
		expect(byId("n4").acknowledgedAt).toBeNull();
	});

	it("scopes the write by the owner relation, not by one pond id", async () => {
		await markAllNotificationsRead();

		// Regression for the root cause: the old filter was `{ pondId: pond.id }`.
		expect(mockNotification.updateMany).toHaveBeenCalledWith({
			where: { read: false, acknowledgedAt: null, pond: { ownerId: "farm-1" } },
			data: {
				read: true,
				acknowledgedAt: expect.any(Date),
				acknowledgedBy: "farm-1",
			},
		});
	});

	it("issues one update statement and one batched device lookup, never a per-pond query", async () => {
		await markAllNotificationsRead();

		// The N+1 being fixed: the update is one statement, and every pond is
		// resolved by one findMany + one createMany instead of a loop.
		expect(mockNotification.updateMany).toHaveBeenCalledTimes(1);
		expect(mockNotification.groupBy).toHaveBeenCalledTimes(1);
		expect(mockEnergyDevice.findMany).toHaveBeenCalledTimes(1);
		expect(mockEnergyDevice.findMany).toHaveBeenCalledWith({
			where: { pondId: { in: ["pond-a", "pond-b"] } },
			select: { id: true, pondId: true },
			orderBy: { createdAt: "asc" },
		});
		expect(mockEnergyDevice.findFirst).not.toHaveBeenCalled();
		expect(mockDeviceStateEvent.createMany).toHaveBeenCalledTimes(1);
		expect(mockDeviceStateEvent.create).not.toHaveBeenCalled();
	});

	it("still clears notifications when a pond has no device, without an empty audit write", async () => {
		// A pond can hold alerts before a feeder is paired. The batch update
		// must still succeed; there is simply no device to audit against.
		mockEnergyDevice.findMany.mockResolvedValueOnce([]);

		const result = await markAllNotificationsRead();

		expect(result).toEqual({ success: true, count: 2 });
		expect(mockDeviceStateEvent.createMany).not.toHaveBeenCalled();
	});

	it("writes one audit event per pond that had pending alerts", async () => {
		await markAllNotificationsRead();

		expect(state.events).toHaveLength(2);
		expect(state.events.map((event) => event.deviceId).sort()).toEqual([
			"dev-pond-a",
			"dev-pond-b",
		]);
		expect(state.events[0]).toMatchObject({
			eventType: "notification_acknowledged",
			source: "user",
			actorId: "farm-1",
			metadata: { scope: "all", count: 1 },
		});
	});

	it("is idempotent: a second press changes nothing and logs nothing new", async () => {
		await markAllNotificationsRead();
		const result = await markAllNotificationsRead();

		expect(result).toEqual({ success: true, count: 0 });
		expect(state.events).toHaveLength(2);
	});

	it("denies a read-only member without writing anything", async () => {
		mockRequireWriteAccess.mockRejectedValueOnce(new Error("Read-only session"));

		await expect(markAllNotificationsRead()).rejects.toThrow("Read-only session");
		expect(mockNotification.updateMany).not.toHaveBeenCalled();
		expect(byId("n1").read).toBe(false);
	});
});

describe("acknowledgeNotification", () => {
	it("marks one notification read and acknowledged, wherever its pond is", async () => {
		const result = await acknowledgeNotification("n2");

		expect(result).toEqual({ success: true, count: 1 });
		expect(byId("n2").read).toBe(true);
		expect(byId("n2").acknowledgedAt).toBeInstanceOf(Date);
		expect(byId("n2").acknowledgedBy).toBe("farm-1");
		// The other pending row is untouched.
		expect(byId("n1").read).toBe(false);
		expect(state.events).toHaveLength(1);
		expect(state.events[0]).toMatchObject({
			deviceId: "dev-pond-b",
			eventType: "notification_acknowledged",
			metadata: { notificationId: "n2", tier: "INFO", category: "feeding" },
		});
	});

	it("refuses a notification that belongs to another farm", async () => {
		const result = await acknowledgeNotification("nx");

		expect(result).toEqual({ success: false, error: "Notification not found." });
		expect(mockNotification.updateMany).not.toHaveBeenCalled();
		expect(byId("nx").acknowledgedAt).toBeNull();
		expect(state.events).toHaveLength(0);
	});

	it("does not acknowledge twice or write a second audit row", async () => {
		await acknowledgeNotification("n1");
		const result = await acknowledgeNotification("n1");

		expect(result).toEqual({ success: true, count: 0 });
		expect(state.events).toHaveLength(1);
	});

	it("denies a read-only member without writing anything", async () => {
		mockRequireWriteAccess.mockRejectedValueOnce(new Error("Read-only session"));

		await expect(acknowledgeNotification("n1")).rejects.toThrow("Read-only session");
		expect(mockNotification.updateMany).not.toHaveBeenCalled();
	});
});
