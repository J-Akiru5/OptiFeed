import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({
	default: {
		feedEvent: { findMany: vi.fn() },
		feedLevelLog: { findMany: vi.fn() },
	},
}));

import { DRIFT_WINDOW_MS, loadCalibrationDriftWindow } from "@/lib/calibration/drift-data";
import { MACHINE_FEED_SOURCES } from "@/lib/feed-figures";
import prisma from "@/lib/prisma";

const mockFeedEvent = vi.mocked(prisma.feedEvent);
const mockFeedLevelLog = vi.mocked(prisma.feedLevelLog);

describe("loadCalibrationDriftWindow", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockFeedEvent.findMany.mockResolvedValue([] as never);
		mockFeedLevelLog.findMany.mockResolvedValue([] as never);
	});

	it("excludes imported hand-fed daily totals from the device output", async () => {
		await loadCalibrationDriftWindow("dev-1");

		expect(mockFeedEvent.findMany).toHaveBeenCalledWith(
			expect.objectContaining({
				where: expect.objectContaining({
					deviceId: "dev-1",
					eventType: "feed_dispensed",
					source: { in: [...MACHINE_FEED_SOURCES] },
				}),
			}),
		);
		expect(MACHINE_FEED_SOURCES).not.toContain("hand_fed");
	});

	it("reads exactly the last seven days", async () => {
		const now = new Date("2026-10-28T00:00:00.000Z");
		const result = await loadCalibrationDriftWindow("dev-1", now);

		const expectedStart = new Date(now.getTime() - DRIFT_WINDOW_MS);
		expect(result.start.toISOString()).toBe(expectedStart.toISOString());
		expect(mockFeedEvent.findMany).toHaveBeenCalledWith(
			expect.objectContaining({
				where: expect.objectContaining({ receivedAt: { gte: expectedStart } }),
			}),
		);
		expect(mockFeedLevelLog.findMany).toHaveBeenCalledWith(
			expect.objectContaining({
				where: { deviceId: "dev-1", recordedAt: { gte: expectedStart } },
				orderBy: { recordedAt: "asc" },
			}),
		);
	});

	it("returns the rows it read", async () => {
		const feeds = [{ grams: 150, receivedAt: new Date("2026-10-27T00:00:00.000Z") }];
		const levels = [{ levelPercent: 80, recordedAt: new Date("2026-10-27T00:00:00.000Z") }];
		mockFeedEvent.findMany.mockResolvedValue(feeds as never);
		mockFeedLevelLog.findMany.mockResolvedValue(levels as never);

		await expect(loadCalibrationDriftWindow("dev-1")).resolves.toMatchObject({
			feeds,
			levels,
		});
	});
});
