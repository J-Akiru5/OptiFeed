import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({
	default: {
		feedEvent: {
			findMany: vi.fn(),
			deleteMany: vi.fn(),
		},
	},
}));

import prisma from "@/lib/prisma";
import { HEARTBEAT_RETENTION_DAYS, deleteOldHeartbeatEvents } from "@/lib/retention";

const mockFeedEvent = vi.mocked(prisma.feedEvent);

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
