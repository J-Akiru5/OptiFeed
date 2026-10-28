import { describe, expect, it } from "vitest";
import { calculateFeedRequirement } from "../fcr-calculation";

describe("calculateFeedRequirement", () => {
	it("calculates correct values for standard inputs", () => {
		const result = calculateFeedRequirement({
			currentBiomassKg: 1000,
			targetWeightKg: 1500,
			days: 30,
			currentFcr: 1.5,
		});

		expect(result.totalBiomassGainKg).toBe(500);
		expect(result.totalFeedNeededKg).toBe(750);
		expect(result.dailyBiomassGainKg).toBeCloseTo(16.67, 1);
		expect(result.dailyFeedRationKg).toBeCloseTo(25, 1);
		expect(result.daysToTarget).toBe(30);
	});

	it("uses default FCR when currentFcr is 0", () => {
		const result = calculateFeedRequirement({
			currentBiomassKg: 1000,
			targetWeightKg: 1500,
			days: 30,
			currentFcr: 0,
		});

		// DEFAULT_FCR = 1.5, so same as above
		expect(result.totalFeedNeededKg).toBe(750);
	});

	it("uses default FCR when currentFcr is negative", () => {
		const result = calculateFeedRequirement({
			currentBiomassKg: 1000,
			targetWeightKg: 1500,
			days: 30,
			currentFcr: -1,
		});

		expect(result.totalFeedNeededKg).toBe(750);
	});

	it("returns 0 daily values when days is 0", () => {
		const result = calculateFeedRequirement({
			currentBiomassKg: 1000,
			targetWeightKg: 1500,
			days: 0,
			currentFcr: 1.5,
		});

		expect(result.dailyBiomassGainKg).toBe(0);
		expect(result.dailyFeedRationKg).toBe(0);
		expect(result.totalBiomassGainKg).toBe(500);
		expect(result.totalFeedNeededKg).toBe(750);
	});

	it("clamps biomass gain to 0 when target <= current", () => {
		const result = calculateFeedRequirement({
			currentBiomassKg: 1500,
			targetWeightKg: 1000,
			days: 30,
			currentFcr: 1.5,
		});

		expect(result.totalBiomassGainKg).toBe(0);
		expect(result.totalFeedNeededKg).toBe(0);
	});

	it("calculates suggestedFeedingRatePct as daily ration ÷ current biomass", () => {
		const result = calculateFeedRequirement({
			currentBiomassKg: 1000,
			targetWeightKg: 1500,
			days: 30,
			currentFcr: 1.5,
		});

		// 25 kg/day ÷ 1,000 kg total biomass × 100 = 2.5%. This used to
		// divide by DEFAULT_FISH_COUNT (5,000) and report 0.00%.
		expect(result.suggestedFeedingRatePct).toBe(2.5);
	});

	it("treats a non-finite FCR or day count as missing rather than returning NaN", () => {
		const result = calculateFeedRequirement({
			currentBiomassKg: 100,
			targetWeightKg: 200,
			days: Number.NaN,
			currentFcr: Number.POSITIVE_INFINITY,
		});

		expect(result.totalFeedNeededKg).toBe(150);
		expect(result.dailyFeedRationKg).toBe(0);
		expect(result.suggestedFeedingRatePct).toBe(0);
		expect(result.daysToTarget).toBe(0);
	});

	it("returns 0 suggestedFeedingRatePct when currentBiomassKg is 0", () => {
		const result = calculateFeedRequirement({
			currentBiomassKg: 0,
			targetWeightKg: 500,
			days: 30,
			currentFcr: 1.5,
		});

		expect(result.suggestedFeedingRatePct).toBe(0);
	});

	it("rounds all values to 2 decimal places", () => {
		const result = calculateFeedRequirement({
			currentBiomassKg: 100,
			targetWeightKg: 200,
			days: 7,
			currentFcr: 1.2,
		});

		// Verify rounding
		expect(result.totalFeedNeededKg).toBe(Math.round(result.totalFeedNeededKg * 100) / 100);
		expect(result.dailyFeedRationKg).toBe(Math.round(result.dailyFeedRationKg * 100) / 100);
	});
});
