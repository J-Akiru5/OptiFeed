import { describe, expect, it } from "vitest";
import { DEFAULT_FISH_COUNT } from "../constants";
import { calculateNextFeeding } from "../volumeCalc";

describe("calculateNextFeeding", () => {
	it("calculates correct feeding volume for standard inputs", () => {
		// avgWeightKg=0.5, feedsPerDay=3, feedingRatePct=3, population=5000
		// totalBiomass = 0.5 * 5000 = 2500 kg
		// dailyFeed = 2500 * 0.03 = 75 kg
		// perFeed = 75 / 3 = 25 kg = 25000 g
		expect(calculateNextFeeding(0.5, 3, 3)).toBe(25000);
	});

	it("uses default fish count when population is null", () => {
		const result = calculateNextFeeding(0.5, 3, 3, null);
		const expected = Math.round(((0.5 * DEFAULT_FISH_COUNT * 0.03) / 3) * 1000 * 100) / 100;
		expect(result).toBe(expected);
	});

	it("accepts a real pond population", () => {
		// avgWeightKg=1, feedingRatePct=5, feedsPerDay=2, population=1000
		// totalBiomass = 1 * 1000 = 1000 kg
		// dailyFeed = 1000 * 0.05 = 50 kg
		// perFeed = 50 / 2 = 25 kg = 25000 g
		expect(calculateNextFeeding(1, 5, 2, 1000)).toBe(25000);
	});

	it("matches the reference daily-feed table (1,185g × 5% ÷ 2 = 29.63g)", () => {
		// 86 fish × 13.78g ≈ 1,185g total biomass
		const biomass = 86 * 13.78; // 1185.08g
		const perMeal = calculateNextFeeding(0.01378, 5, 2, 86);
		expect(biomass).toBeCloseTo(1185, 0);
		expect(perMeal).toBe(29.63); // 1185.08 × 5% = 59.254 → ÷2 = 29.63
	});

	it("returns 0 when feedsPerDay is 0", () => {
		expect(calculateNextFeeding(0.5, 3, 0)).toBe(0);
	});

	it("returns 0 when feedsPerDay is negative", () => {
		expect(calculateNextFeeding(0.5, 3, -1)).toBe(0);
	});

	it("rounds to 2 decimals", () => {
		// avgWeightKg=0.123, feedingRatePct=4.5, feedsPerDay=3, population=100
		// totalBiomass = 0.123 * 100 = 12.3 kg
		// dailyFeed = 12.3 * 0.045 = 0.5535 kg
		// perFeed = 0.5535 / 3 = 0.1845 kg = 184.5 g
		expect(calculateNextFeeding(0.123, 4.5, 3, 100)).toBe(184.5);
	});

	it("handles zero avgWeightKg", () => {
		expect(calculateNextFeeding(0, 3, 3)).toBe(0);
	});

	it("handles zero feedingRatePct", () => {
		expect(calculateNextFeeding(0.5, 0, 3)).toBe(0);
	});
});
