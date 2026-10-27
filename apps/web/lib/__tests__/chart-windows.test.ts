import {
	FEED_CHART_DAYS,
	parseHopperRange,
	parseWaterTempRange,
	resolveDayWindow,
	resolveWaterTempWindow,
	startOfDayInTimeZone,
	startOfHourInTimeZone,
} from "@/lib/chart-windows";
import { describe, expect, it } from "vitest";

/**
 * The pond charts bucket in the farm's local day, not in UTC. These tests pin
 * the window edges so a "last 30 days" chart cannot silently drift by a day or
 * lose its first bucket.
 */

// 2026-10-27 12:30 in Asia/Manila (UTC+8).
const NOW = new Date("2026-10-27T04:30:00.000Z");

describe("parseHopperRange", () => {
	it("accepts the two supported windows", () => {
		expect(parseHopperRange("7")).toBe(7);
		expect(parseHopperRange("30")).toBe(30);
	});

	it("falls back to a week for anything else", () => {
		for (const value of [undefined, null, "", "8", "0", "abc", "-7"]) {
			expect(parseHopperRange(value)).toBe(7);
		}
	});
});

describe("parseWaterTempRange", () => {
	it("accepts the week view and defaults to 24 hours", () => {
		expect(parseWaterTempRange("7d")).toBe("7d");
		expect(parseWaterTempRange("24h")).toBe("24h");
		for (const value of [undefined, null, "", "7", "30", "abc"]) {
			expect(parseWaterTempRange(value)).toBe("24h");
		}
	});
});

describe("startOfDayInTimeZone", () => {
	it("returns local midnight as a UTC instant", () => {
		expect(startOfDayInTimeZone(NOW).toISOString()).toBe("2026-10-26T16:00:00.000Z");
	});

	it("keeps a reading that is already past midnight in the same day", () => {
		const justAfterMidnight = new Date("2026-10-26T16:05:00.000Z");
		expect(startOfDayInTimeZone(justAfterMidnight).toISOString()).toBe("2026-10-26T16:00:00.000Z");
	});
});

describe("startOfHourInTimeZone", () => {
	it("drops the minutes in the farm timezone, not in UTC", () => {
		expect(startOfHourInTimeZone(NOW).toISOString()).toBe("2026-10-27T04:00:00.000Z");
	});
});

describe("resolveDayWindow", () => {
	it("covers exactly the requested local days, oldest first", () => {
		const window = resolveDayWindow(FEED_CHART_DAYS, NOW);

		expect(window.end).toBe(NOW);
		expect(window.dayKeys).toHaveLength(FEED_CHART_DAYS);
		expect(window.dayKeys[0]).toBe("2026-09-28");
		expect(window.dayKeys.at(-1)).toBe("2026-10-27");
		expect(window.start.toISOString()).toBe("2026-09-27T16:00:00.000Z");
	});

	it("handles a seven-day window", () => {
		const window = resolveDayWindow(7, NOW);

		expect(window.dayKeys).toEqual([
			"2026-10-21",
			"2026-10-22",
			"2026-10-23",
			"2026-10-24",
			"2026-10-25",
			"2026-10-26",
			"2026-10-27",
		]);
	});
});

describe("resolveWaterTempWindow", () => {
	it("uses 24 hourly buckets for the day view", () => {
		const window = resolveWaterTempWindow("24h", NOW);

		expect(window.bucket).toBe("hour");
		expect(window.end).toBe(NOW);
		expect(window.start.toISOString()).toBe("2026-10-26T05:00:00.000Z");
	});

	it("uses seven daily buckets for the week view", () => {
		const window = resolveWaterTempWindow("7d", NOW);

		expect(window.bucket).toBe("day");
		expect(window.start.toISOString()).toBe("2026-10-20T16:00:00.000Z");
	});
});
