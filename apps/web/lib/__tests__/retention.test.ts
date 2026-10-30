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
	},
}));

import prisma from "@/lib/prisma";
import {
	HEARTBEAT_RETENTION_DAYS,
	POND_SETTINGS_DRAFT_RETENTION_DAYS,
	deleteExpiredPondSettingsDrafts,
	deleteOldHeartbeatEvents,
} from "@/lib/retention";

const mockFeedEvent = vi.mocked(prisma.feedEvent);
const mockDraft = vi.mocked(prisma.pondSettingsDraft);

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
