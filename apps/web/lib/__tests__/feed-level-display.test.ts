import { describe, expect, it } from "vitest";
import { OFFLINE_THRESHOLD_MS } from "../constants";
import { isDeviceOffline, resolveFeedLevelDisplay } from "../feed-level-display";

const readingAt = new Date("2026-08-28T09:32:00+08:00");

describe("isDeviceOffline", () => {
	it("treats the exact threshold as online and one millisecond later as offline", () => {
		const now = new Date("2026-10-27T12:00:00Z");

		expect(isDeviceOffline(new Date(now.getTime() - OFFLINE_THRESHOLD_MS), now)).toBe(false);
		expect(isDeviceOffline(new Date(now.getTime() - OFFLINE_THRESHOLD_MS - 1), now)).toBe(true);
	});

	it("treats a device that never checked in as offline", () => {
		expect(isDeviceOffline(null)).toBe(true);
		expect(isDeviceOffline(undefined)).toBe(true);
	});
});

describe("resolveFeedLevelDisplay", () => {
	it("returns a live reading while the device is online", () => {
		expect(
			resolveFeedLevelDisplay({ levelPercent: 82, updatedAt: readingAt, isOffline: false }),
		).toEqual({
			state: "live",
			percent: 82,
			readingAt,
			isOffline: false,
		});
	});

	it("keeps the last known reading when the device is offline", () => {
		expect(
			resolveFeedLevelDisplay({ levelPercent: 82, updatedAt: readingAt, isOffline: true }),
		).toEqual({
			state: "stale",
			percent: 82,
			readingAt,
			isOffline: true,
		});
	});

	it("reports no reading when the device has never measured a level", () => {
		expect(
			resolveFeedLevelDisplay({ levelPercent: null, updatedAt: null, isOffline: true }),
		).toEqual({
			state: "none",
			percent: null,
			readingAt: null,
			isOffline: true,
		});
	});

	it("rounds and clamps a reading to a whole percentage", () => {
		expect(
			resolveFeedLevelDisplay({ levelPercent: 81.6, updatedAt: readingAt, isOffline: false }),
		).toMatchObject({ state: "live", percent: 82 });
		expect(
			resolveFeedLevelDisplay({ levelPercent: 140, updatedAt: readingAt, isOffline: false }),
		).toMatchObject({ state: "live", percent: 100 });
		expect(
			resolveFeedLevelDisplay({ levelPercent: -4, updatedAt: readingAt, isOffline: false }),
		).toMatchObject({ state: "live", percent: 0 });
	});
});
