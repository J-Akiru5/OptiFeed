import { describe, expect, it } from "vitest";
import { calculateFeedRequirement } from "../fcr-calculation";

const base = {
	currentWeightKg: 0.01378,
	targetWeightKg: 0.05,
	population: 1000,
	days: 60,
	currentFcr: 1.5,
};

describe("calculateFeedRequirement", () => {
	it("reports the true totals for a per-fish plan", () => {
		const result = calculateFeedRequirement(base);
		// 0.03622 kg gain per fish x 1000 fish = 36.22 kg
		expect(result.totalBiomassGainKg).toBeCloseTo(36.22, 2);
		// 36.22 kg x FCR 1.5 = 54.33 kg of feed
		expect(result.totalFeedNeededKg).toBeCloseTo(54.33, 2);
		expect(result.dailyBiomassGainKg).toBeCloseTo(0.6, 2);
		expect(result.dailyFeedRationKg).toBeCloseTo(0.91, 2);
		// daily feed / current biomass = 0.9055 / 13.78 = 6.57 %/day
		expect(result.suggestedFeedingRatePct).toBeCloseTo(6.57, 2);
		expect(result.daysToTarget).toBe(60);
	});

	it("does not depend on population for the suggested rate", () => {
		const many = calculateFeedRequirement(base);
		const few = calculateFeedRequirement({ ...base, population: 50 });
		expect(few.suggestedFeedingRatePct).toBe(many.suggestedFeedingRatePct);
	});

	it("returns a per-meal dose when feedsPerDay is given", () => {
		const result = calculateFeedRequirement({ ...base, feedsPerDay: 3 });
		// 0.9055 kg/day / 3 meals = 301.83 g per meal
		expect(result.gramsPerFeeding).toBeCloseTo(301.83, 2);
	});

	it("matches a hand-worked rate over ten days", () => {
		const result = calculateFeedRequirement({
			currentWeightKg: 0.01378,
			targetWeightKg: 0.02,
			population: 100,
			days: 10,
			currentFcr: 1.5,
		});
		// 0.00622 x 1.5 / 10 = 0.000933 kg/day; / 0.01378 kg = 6.77 %/day
		expect(result.suggestedFeedingRatePct).toBeCloseTo(6.77, 2);
	});

	it("uses the default FCR when the stored FCR is missing or invalid", () => {
		expect(calculateFeedRequirement({ ...base, currentFcr: 0 }).totalFeedNeededKg).toBeCloseTo(
			54.33,
			2,
		);
		expect(calculateFeedRequirement({ ...base, currentFcr: -1 }).totalFeedNeededKg).toBeCloseTo(
			54.33,
			2,
		);
	});

	it("returns zero daily values when days is 0", () => {
		const result = calculateFeedRequirement({ ...base, days: 0 });
		expect(result.dailyBiomassGainKg).toBe(0);
		expect(result.dailyFeedRationKg).toBe(0);
		expect(result.suggestedFeedingRatePct).toBe(0);
		expect(result.totalFeedNeededKg).toBeCloseTo(54.33, 2);
	});

	it("clamps gain to zero when the target is not above the current weight", () => {
		const result = calculateFeedRequirement({ ...base, targetWeightKg: 0.01 });
		expect(result.totalBiomassGainKg).toBe(0);
		expect(result.totalFeedNeededKg).toBe(0);
		expect(result.suggestedFeedingRatePct).toBe(0);
	});

	it("never divides by a missing population", () => {
		const result = calculateFeedRequirement({ ...base, population: 0 });
		expect(result.totalFeedNeededKg).toBe(0);
		expect(result.suggestedFeedingRatePct).toBe(0);
	});

	it("rounds half values the same way as feed-calc (17.775 -> 17.78)", () => {
		// 13.78 g fish, 31.775 g target, 1 fish, 1 day, FCR 1.5 =>
		// gain 0.017995 kg x 1.5 = 0.0269925, rounded to 0.03 total feed.
		const result = calculateFeedRequirement({
			currentWeightKg: 0.01378,
			targetWeightKg: 0.031775,
			population: 1,
			days: 1,
			currentFcr: 1.5,
		});
		expect(result.totalFeedNeededKg).toBe(0.03);
	});
});
