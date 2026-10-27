import { describe, expect, it } from "vitest";
import { getFeedLevelDisplay } from "../feed-level";

const base = {
	hopperCapacityG: 10_000,
	gramsPerFeeding: 100,
	feedsPerDay: 2,
};

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
});
