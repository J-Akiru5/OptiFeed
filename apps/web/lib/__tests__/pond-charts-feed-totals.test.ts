import { beforeEach, describe, expect, it, vi } from "vitest";

const { db } = vi.hoisted(() => ({
	db: { feedEvent: { findFirst: vi.fn(), aggregate: vi.fn() } },
}));

vi.mock("@/lib/prisma", () => ({ default: db }));

import { getFeedTotals } from "@/lib/pond-charts";

/**
 * The History summary figures (#236) must have explicit windows and must never
 * treat an imported hand-fed daily total as the last machine dispense.
 */

const NOW = new Date("2026-10-27T12:00:00.000Z"); // 20:00 in Manila

beforeEach(() => {
	vi.resetAllMocks();
	db.feedEvent.findFirst.mockResolvedValue({
		grams: 1045.53,
		source: "dashboard",
		receivedAt: new Date("2026-10-27T08:01:00.000Z"),
	});
	db.feedEvent.aggregate
		.mockResolvedValueOnce({ _sum: { grams: 1045.53 }, _count: { _all: 1 } })
		.mockResolvedValueOnce({ _sum: { grams: 4000 }, _count: { _all: 4 } });
});

describe("getFeedTotals", () => {
	it("returns zeros without querying when the pond has no device", async () => {
		const result = await getFeedTotals([], NOW);

		expect(result).toMatchObject({
			lastMachineFeed: null,
			todayGrams: 0,
			todayCount: 0,
			last7DaysGrams: 0,
			last7DaysDailyAverageG: 0,
		});
		expect(db.feedEvent.findFirst).not.toHaveBeenCalled();
		expect(db.feedEvent.aggregate).not.toHaveBeenCalled();
	});

	it("excludes hand-fed daily totals from the last feed", async () => {
		await getFeedTotals(["device-1"], NOW);

		const where = db.feedEvent.findFirst.mock.calls[0][0].where;
		expect(where.source).toEqual({ in: ["scheduled", "dashboard", "button"] });
		expect(where.source.in).not.toContain("hand_fed");
	});

	it("sums today from Asia/Manila midnight and the week over seven farm days", async () => {
		const result = await getFeedTotals(["device-1"], NOW);

		const todayWhere = db.feedEvent.aggregate.mock.calls[0][0].where;
		const weekWhere = db.feedEvent.aggregate.mock.calls[1][0].where;

		// 12:00 UTC is 20:00 the same day in Manila, so "today" started at
		// 2026-10-26 16:00 UTC and the seven-day window at 2026-10-20 16:00 UTC.
		expect(todayWhere.receivedAt.gte.toISOString()).toBe("2026-10-26T16:00:00.000Z");
		expect(weekWhere.receivedAt.gte.toISOString()).toBe("2026-10-20T16:00:00.000Z");
		expect(todayWhere.eventType).toBe("feed_dispensed");
		expect(todayWhere.source).toBeUndefined();

		expect(result).toMatchObject({
			lastMachineFeed: { grams: 1045.53, source: "dashboard" },
			todayGrams: 1045.53,
			todayCount: 1,
			last7DaysGrams: 4000,
			last7DaysCount: 4,
			last7DaysDailyAverageG: 4000 / 7,
		});
	});
});
