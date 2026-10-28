import { describe, expect, it } from "vitest";
import { estimateDaysOfFeedRemaining, getFeedLevelDisplay } from "../feed-level";

const base = {
	hopperCapacityG: 10_000,
	gramsPerFeeding: 100,
	feedsPerDay: 2,
};

describe("estimateDaysOfFeedRemaining", () => {
	it("divides the remaining grams by the daily consumption", () => {
		// 50 % of 10,000 g = 5,000 g; 100 g × 2 meals = 200 g/day → 25 days.
		expect(
			estimateDaysOfFeedRemaining({
				levelPercent: 50,
				hopperCapacityG: 10_000,
				gramsPerFeeding: 100,
				feedsPerDay: 2,
			}),
		).toBe(25);
	});

	it("keeps the fraction so the caller can round it", () => {
		// 10 % of 10,000 = 1,000 g over 300 g/day = 3.33 days.
		const days = estimateDaysOfFeedRemaining({
			levelPercent: 10,
			hopperCapacityG: 10_000,
			gramsPerFeeding: 100,
			feedsPerDay: 3,
		});
		expect(days).toBeCloseTo(3.333, 2);
	});

	it("returns null instead of 0, Infinity or NaN", () => {
		const common = { levelPercent: 50, hopperCapacityG: 10_000, gramsPerFeeding: 100 };
		expect(estimateDaysOfFeedRemaining({ ...common, feedsPerDay: 0 })).toBeNull();
		expect(estimateDaysOfFeedRemaining({ ...common, feedsPerDay: -1 })).toBeNull();
		expect(
			estimateDaysOfFeedRemaining({ ...common, hopperCapacityG: 0, feedsPerDay: 2 }),
		).toBeNull();
		expect(
			estimateDaysOfFeedRemaining({ ...common, gramsPerFeeding: 0, feedsPerDay: 2 }),
		).toBeNull();
		expect(
			estimateDaysOfFeedRemaining({ ...common, levelPercent: null, feedsPerDay: 2 }),
		).toBeNull();
	});

	it("clamps a corrupt level above 100 % and below 0 %", () => {
		const baseInput = { hopperCapacityG: 10_000, gramsPerFeeding: 100, feedsPerDay: 2 };
		expect(estimateDaysOfFeedRemaining({ ...baseInput, levelPercent: 150 })).toBe(50);
		expect(estimateDaysOfFeedRemaining({ ...baseInput, levelPercent: -20 })).toBe(0);
	});
});

describe("getFeedLevelDisplay", () => {
	it("keeps the last known reading and hides days remaining when the device is offline", () => {
		const display = getFeedLevelDisplay({
			...base,
			levelPercent: 82,
			isDeviceOffline: true,
		});

		expect(display).toMatchObject({
			state: "stale",
			percent: 82,
			hasReading: true,
			isOffline: true,
			isCritical: false,
			isLow: false,
			daysRemaining: null,
		});
	});

	it("reports no reading when an offline device has never reported a level", () => {
		const display = getFeedLevelDisplay({
			...base,
			levelPercent: null,
			isDeviceOffline: true,
		});

		expect(display.state).toBe("none");
		expect(display.percent).toBeNull();
		expect(display.hasReading).toBe(false);
		expect(display.daysRemaining).toBeNull();
	});

	it("keeps the live percentage and estimates days remaining when online", () => {
		const display = getFeedLevelDisplay({
			...base,
			levelPercent: 82,
			isDeviceOffline: false,
		});

		expect(display.state).toBe("live");
		expect(display.percent).toBe(82);
		expect(display.hasReading).toBe(true);
		expect(display.daysRemaining).toBe(41);
		expect(display.isCritical).toBe(false);
		expect(display.isLow).toBe(false);
	});

	it("shows no reading when an online device has not reported yet", () => {
		const display = getFeedLevelDisplay({
			...base,
			levelPercent: null,
			isDeviceOffline: false,
		});

		expect(display.state).toBe("none");
		expect(display.percent).toBeNull();
		expect(display.hasReading).toBe(false);
		expect(display.daysRemaining).toBeNull();
	});

	it("classifies low and critical levels only while online", () => {
		const critical = getFeedLevelDisplay({
			...base,
			levelPercent: 5,
			isDeviceOffline: false,
		});
		const low = getFeedLevelDisplay({
			...base,
			levelPercent: 20,
			isDeviceOffline: false,
		});
		const healthy = getFeedLevelDisplay({
			...base,
			levelPercent: 21,
			isDeviceOffline: false,
		});

		expect(critical.isCritical).toBe(true);
		expect(critical.isLow).toBe(true);
		expect(low.isCritical).toBe(false);
		expect(low.isLow).toBe(true);
		expect(healthy.isCritical).toBe(false);
		expect(healthy.isLow).toBe(false);
	});

	it("uses the org's low threshold instead of the legacy 20 %", () => {
		const low = getFeedLevelDisplay({
			...base,
			levelPercent: 25,
			isDeviceOffline: false,
			hopperLowPct: 30,
		});
		const healthy = getFeedLevelDisplay({
			...base,
			levelPercent: 25,
			isDeviceOffline: false,
			hopperLowPct: 20,
		});

		expect(low.isLow).toBe(true);
		expect(low.isCritical).toBe(false);
		expect(healthy.isLow).toBe(false);
	});
});
