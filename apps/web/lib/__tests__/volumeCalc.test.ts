import { describe, expect, it } from "vitest";
import { DEFAULT_FISH_COUNT } from "../constants";
import { calculateNextFeeding } from "../volumeCalc";

describe("calculateNextFeeding", () => {
	it("calculates correct feeding volume for standard inputs", () => {
		// avgWeightKg=0.5, feedsPerDay=3, feedingRatePct=3
		// totalBiomass = 0.5 * 5000 = 2500 kg
		// dailyFeed = 2500 * 0.03 = 75 kg
		// perFeed = 75 / 3 = 25 kg = 25000 g
		expect(calculateNextFeeding(0.5, 3, 3)).toBe(25000);
	});

	it("uses default fish count when not provided", () => {
		const result = calculateNextFeeding(0.5, 3, 3);
		const expected = Math.round(((0.5 * DEFAULT_FISH_COUNT * 0.03) / 3) * 1000);
		expect(result).toBe(expected);
	});

	it("accepts custom fish count", () => {
		// avgWeightKg=1, feedingRatePct=5, feedsPerDay=2, fishCount=1000
		// totalBiomass = 1 * 1000 = 1000 kg
		// dailyFeed = 1000 * 0.05 = 50 kg
		// perFeed = 50 / 2 = 25 kg = 25000 g
		expect(calculateNextFeeding(1, 5, 2, 1000)).toBe(25000);
	});

	it("returns 0 when feedsPerDay is 0", () => {
		expect(calculateNextFeeding(0.5, 3, 0)).toBe(0);
	});

	it("returns 0 when feedsPerDay is negative", () => {
		expect(calculateNextFeeding(0.5, 3, -1)).toBe(0);
	});

	it("rounds to nearest whole gram", () => {
		// avgWeightKg=0.123, feedingRatePct=4.5, feedsPerDay=3, fishCount=100
		// totalBiomass = 0.123 * 100 = 12.3
		// dailyFeed = 12.3 * 0.045 = 0.5535
		// perFeed = 0.5535 / 3 = 0.1845 kg = 184.5 g -> rounds to 185
		expect(calculateNextFeeding(0.123, 4.5, 3, 100)).toBe(185);
	});

	it("handles zero avgWeightKg", () => {
		expect(calculateNextFeeding(0, 3, 3)).toBe(0);
	});

	it("handles zero feedingRatePct", () => {
		expect(calculateNextFeeding(0.5, 0, 3)).toBe(0);
	});
});
