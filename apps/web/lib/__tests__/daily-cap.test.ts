import {
	DAILY_CAP_MIN_G,
	DEFAULT_DAILY_CAP_G,
	MAX_FEED_GRAMS_PER_DAY_PER_DEVICE,
	dailyCapSchema,
	normalizeDailyCapG,
	resolveDailyCapG,
} from "@/lib/limits";
import { predictionUpperBound } from "@/lib/prediction";
import { describe, expect, it } from "vitest";

/**
 * Amendment A-001: the daily ceiling defaults to 2,000 g, the farmer/admin may
 * raise it to the 5,000 g guard, the platform factor may only lower it, and a
 * calibrated hopper is the final physical limit.
 */
describe("daily feed ceiling", () => {
	it("defaults to 2,000 g when no value is stored", () => {
		expect(DEFAULT_DAILY_CAP_G).toBe(2000);
		expect(normalizeDailyCapG(null)).toBe(2000);
		expect(normalizeDailyCapG(undefined)).toBe(2000);
		expect(resolveDailyCapG({})).toBe(2000);
	});

	it("clamps a stored value into the writable window", () => {
		expect(DAILY_CAP_MIN_G).toBe(500);
		expect(normalizeDailyCapG(100)).toBe(500);
		expect(normalizeDailyCapG(6000)).toBe(5000);
		expect(normalizeDailyCapG(2500)).toBe(2500);
	});

	it("lets the farmer raise the ceiling up to the guard", () => {
		expect(resolveDailyCapG({ configuredCapG: 3000 })).toBe(3000);
		expect(resolveDailyCapG({ configuredCapG: 5000 })).toBe(5000);
		expect(resolveDailyCapG({ configuredCapG: 9999 })).toBe(5000);
	});

	it("lets the platform factor lower the result but never raise it", () => {
		expect(resolveDailyCapG({ configuredCapG: 4000, dailyCapFactor: 0.5 })).toBe(2000);
		expect(resolveDailyCapG({ configuredCapG: 4000, dailyCapFactor: 5 })).toBe(4000);
		expect(resolveDailyCapG({ dailyCapFactor: 0.25 })).toBe(500);
	});

	it("never exceeds the hopper capacity", () => {
		expect(resolveDailyCapG({ configuredCapG: 5000, hopperCapacityG: 1200 })).toBe(1200);
		expect(resolveDailyCapG({ configuredCapG: 5000, hopperCapacityG: 0 })).toBe(5000);
		expect(resolveDailyCapG({ configuredCapG: 5000, hopperCapacityG: null })).toBe(5000);
	});

	it("validates the setting schema at the boundaries", () => {
		expect(dailyCapSchema.safeParse(499).success).toBe(false);
		expect(dailyCapSchema.safeParse(500).success).toBe(true);
		expect(dailyCapSchema.safeParse(2000).success).toBe(true);
		expect(dailyCapSchema.safeParse(5000).success).toBe(true);
		expect(dailyCapSchema.safeParse(5001).success).toBe(false);
		expect(dailyCapSchema.safeParse(2000.5).success).toBe(false);
	});

	it("feeds the same ceiling into the advisor's per-meal bound", () => {
		// 2,000 g default over 2 meals = 1,000 g per meal.
		expect(predictionUpperBound(2, null)).toBe(1000);
		// Over 3 meals the daily ceiling is shared three ways.
		expect(predictionUpperBound(3, null)).toBeCloseTo(666.67, 1);
		// A raised ceiling is not capped at 1,000 g per meal any more.
		expect(predictionUpperBound(2, null, 5000)).toBe(2500);
		expect(predictionUpperBound(10, null, 5000)).toBe(500);
		// A tightened platform factor flows through.
		expect(predictionUpperBound(2, null, 2000, 0.5)).toBe(500);
	});
});

describe("the hard guard matches the firmware", () => {
	it("is 5,000 g", () => {
		expect(MAX_FEED_GRAMS_PER_DAY_PER_DEVICE).toBe(5000);
	});
});
