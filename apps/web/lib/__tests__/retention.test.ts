import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({
	default: {
		feedEvent: {
			findMany: vi.fn(),
			deleteMany: vi.fn(),
		},
		pondSettingsDraft: {
			findMany: vi.fn(),
			deleteMany: vi.fn(),
		},
		deviceStateEvent: {
			findMany: vi.fn(),
			deleteMany: vi.fn(),
		},
		notification: {
			findMany: vi.fn(),
		},
		feedRequest: {
			findMany: vi.fn(),
		},
	},
}));

import prisma from "@/lib/prisma";
import {
	DEVICE_STATE_RETENTION_DAYS,
	HEARTBEAT_RETENTION_DAYS,
	POND_SETTINGS_DRAFT_RETENTION_DAYS,
	deleteExpiredPondSettingsDrafts,
	deleteOldDeviceStateEvents,
	deleteOldHeartbeatEvents,
} from "@/lib/retention";

const mockFeedEvent = vi.mocked(prisma.feedEvent);
const mockDraft = vi.mocked(prisma.pondSettingsDraft);
const mockDeviceStateEvent = vi.mocked(prisma.deviceStateEvent);
const mockNotification = vi.mocked(prisma.notification);
const mockFeedRequest = vi.mocked(prisma.feedRequest);

describe("deleteOldHeartbeatEvents", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("deletes heartbeat rows older than the retention window in one batch", async () => {
		mockFeedEvent.findMany.mockResolvedValue([{ id: "1" }, { id: "2" }, { id: "3" }] as never);
		mockFeedEvent.deleteMany.mockResolvedValue({ count: 3 } as never);

		const deleted = await deleteOldHeartbeatEvents();

		expect(deleted).toBe(3);
		expect(mockFeedEvent.findMany).toHaveBeenCalledWith({
			where: {
				eventType: "heartbeat",
				receivedAt: { lt: expect.any(Date) },
			},
			select: { id: true },
			take: 5000,
		});
		const cutoff = (
			mockFeedEvent.findMany.mock.calls[0][0] as { where: { receivedAt: { lt: Date } } }
		).where.receivedAt.lt;
		const expected = Date.now() - HEARTBEAT_RETENTION_DAYS * 24 * 60 * 60 * 1000;
		expect(Math.abs(cutoff.getTime() - expected)).toBeLessThan(5000);
		expect(mockFeedEvent.deleteMany).toHaveBeenCalledWith({
			where: { id: { in: ["1", "2", "3"] } },
		});
	});

	it("returns 0 and skips deleteMany when nothing is stale", async () => {
		mockFeedEvent.findMany.mockResolvedValue([] as never);

		const deleted = await deleteOldHeartbeatEvents();

		expect(deleted).toBe(0);
		expect(mockFeedEvent.deleteMany).not.toHaveBeenCalled();
	});

	it("respects a custom batch size", async () => {
		mockFeedEvent.findMany.mockResolvedValue([{ id: "1" }] as never);
		mockFeedEvent.deleteMany.mockResolvedValue({ count: 1 } as never);

		await deleteOldHeartbeatEvents(100);

		expect(mockFeedEvent.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 100 }));
	});
});

describe("deleteExpiredPondSettingsDrafts", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("deletes drafts untouched for 30 days, oldest first, in one batch", async () => {
		mockDraft.findMany.mockResolvedValue([{ id: "d1" }, { id: "d2" }] as never);
		mockDraft.deleteMany.mockResolvedValue({ count: 2 } as never);

		const deleted = await deleteExpiredPondSettingsDrafts();

		expect(deleted).toBe(2);
		expect(mockDraft.findMany).toHaveBeenCalledWith({
			where: { updatedAt: { lt: expect.any(Date) } },
			orderBy: { updatedAt: "asc" },
			select: { id: true },
			take: 5000,
		});
		const cutoff = (mockDraft.findMany.mock.calls[0][0] as { where: { updatedAt: { lt: Date } } })
			.where.updatedAt.lt;
		const expected = Date.now() - POND_SETTINGS_DRAFT_RETENTION_DAYS * 24 * 60 * 60 * 1000;
		expect(Math.abs(cutoff.getTime() - expected)).toBeLessThan(5000);
		expect(mockDraft.deleteMany).toHaveBeenCalledWith({ where: { id: { in: ["d1", "d2"] } } });
	});

	it("keeps a draft younger than the window", async () => {
		// The query filters by date; an empty result is the "all fresh" case.
		mockDraft.findMany.mockResolvedValue([] as never);

		expect(await deleteExpiredPondSettingsDrafts()).toBe(0);
		expect(mockDraft.deleteMany).not.toHaveBeenCalled();
	});

	it("respects a custom batch size", async () => {
		mockDraft.findMany.mockResolvedValue([{ id: "d1" }] as never);
		mockDraft.deleteMany.mockResolvedValue({ count: 1 } as never);

		await deleteExpiredPondSettingsDrafts(50);

		expect(mockDraft.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 50 }));
	});
});

describe("deleteOldDeviceStateEvents", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockNotification.findMany.mockResolvedValue([] as never);
		mockFeedRequest.findMany.mockResolvedValue([] as never);
	});

	it("deletes stale rows after 180 days, oldest first, in one batch", async () => {
		mockDeviceStateEvent.findMany.mockResolvedValue([
			{ id: "e1", metadata: null, device: { pondId: "pond-1" } },
			{ id: "e2", metadata: { note: "ok" }, device: { pondId: "pond-2" } },
		] as never);
		mockDeviceStateEvent.deleteMany.mockResolvedValue({ count: 2 } as never);

		const deleted = await deleteOldDeviceStateEvents();

		expect(deleted).toBe(2);
		expect(mockDeviceStateEvent.findMany).toHaveBeenCalledWith({
			where: { createdAt: { lt: expect.any(Date) } },
			orderBy: { createdAt: "asc" },
			select: {
				id: true,
				metadata: true,
				device: { select: { pondId: true } },
			},
			take: 5000,
		});
		const cutoff = (
			mockDeviceStateEvent.findMany.mock.calls[0][0] as {
				where: { createdAt: { lt: Date } };
			}
		).where.createdAt.lt;
		const expected = Date.now() - DEVICE_STATE_RETENTION_DAYS * 24 * 60 * 60 * 1000;
		expect(Math.abs(cutoff.getTime() - expected)).toBeLessThan(5000);
		expect(mockDeviceStateEvent.deleteMany).toHaveBeenCalledWith({
			where: { id: { in: ["e1", "e2"] } },
		});
	});

	it("keeps every row belonging to a pond with an open alert", async () => {
		mockDeviceStateEvent.findMany.mockResolvedValue([
			{ id: "open", metadata: null, device: { pondId: "pond-open" } },
			{ id: "quiet", metadata: null, device: { pondId: "pond-quiet" } },
		] as never);
		mockNotification.findMany.mockResolvedValue([{ pondId: "pond-open" }] as never);
		mockDeviceStateEvent.deleteMany.mockResolvedValue({ count: 1 } as never);

		const deleted = await deleteOldDeviceStateEvents();

		expect(deleted).toBe(1);
		expect(mockNotification.findMany).toHaveBeenCalledWith(
			expect.objectContaining({
				where: { resolvedAt: null, autoCleared: false, supersededById: null },
				distinct: ["pondId"],
			}),
		);
		expect(mockDeviceStateEvent.deleteMany).toHaveBeenCalledWith({
			where: { id: { in: ["quiet"] } },
		});
	});

	it("keeps rows tied to a FeedRequest that is still pending or dispatched", async () => {
		mockDeviceStateEvent.findMany.mockResolvedValue([
			{ id: "pending", metadata: { feedRequestId: "req-pending" }, device: { pondId: "p1" } },
			{ id: "expired", metadata: { expiredRequestId: "req-expired" }, device: { pondId: "p2" } },
			{ id: "done", metadata: { feedRequestId: "req-done" }, device: { pondId: "p3" } },
		] as never);
		mockFeedRequest.findMany.mockResolvedValue([
			{ id: "req-pending" },
			{ id: "req-expired" },
		] as never);
		mockDeviceStateEvent.deleteMany.mockResolvedValue({ count: 1 } as never);

		const deleted = await deleteOldDeviceStateEvents();

		expect(mockFeedRequest.findMany).toHaveBeenCalledWith(
			expect.objectContaining({ where: { status: { in: ["pending", "dispatched"] } } }),
		);
		expect(deleted).toBe(1);
		expect(mockDeviceStateEvent.deleteMany).toHaveBeenCalledWith({
			where: { id: { in: ["done"] } },
		});
	});

	it("returns 0 without running the guard queries when nothing is stale", async () => {
		mockDeviceStateEvent.findMany.mockResolvedValue([] as never);

		expect(await deleteOldDeviceStateEvents()).toBe(0);
		expect(mockNotification.findMany).not.toHaveBeenCalled();
		expect(mockFeedRequest.findMany).not.toHaveBeenCalled();
		expect(mockDeviceStateEvent.deleteMany).not.toHaveBeenCalled();
	});

	it("reports 0 rather than deleting protected rows to make progress", async () => {
		mockDeviceStateEvent.findMany.mockResolvedValue([
			{ id: "protected", metadata: null, device: { pondId: "pond-open" } },
		] as never);
		mockNotification.findMany.mockResolvedValue([{ pondId: "pond-open" }] as never);

		expect(await deleteOldDeviceStateEvents()).toBe(0);
		expect(mockDeviceStateEvent.deleteMany).not.toHaveBeenCalled();
	});

	it("treats a non-object metadata value as having no reconciliation reference", async () => {
		mockDeviceStateEvent.findMany.mockResolvedValue([
			{ id: "scalar", metadata: "note", device: { pondId: "p1" } },
		] as never);
		mockDeviceStateEvent.deleteMany.mockResolvedValue({ count: 1 } as never);

		expect(await deleteOldDeviceStateEvents()).toBe(1);
		expect(mockDeviceStateEvent.deleteMany).toHaveBeenCalledWith({
			where: { id: { in: ["scalar"] } },
		});
	});

	it("respects a custom batch size", async () => {
		mockDeviceStateEvent.findMany.mockResolvedValue([] as never);

		await deleteOldDeviceStateEvents(25);

		expect(mockDeviceStateEvent.findMany).toHaveBeenCalledWith(
			expect.objectContaining({ take: 25 }),
		);
	});
});
