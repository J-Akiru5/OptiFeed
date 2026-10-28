import { describe, expect, it } from "vitest";
import { dailyFeedG, feedPerMealG, totalBiomassG } from "../feed-calc";

/**
 * The shared feed maths. Audit 2026-10-28: an unknown population must never
 * become the demo default (5,000 fish) — every figure propagates null instead.
 */
describe("totalBiomassG", () => {
	it("multiplies live fish by the average body weight", () => {
		// 285 live fish × 140.5 g = 40,042.5 g (the sheet's last sampling row).
		expect(totalBiomassG(285, 0.1405)).toBe(40042.5);
	});

	it("returns null when the population is unknown", () => {
		expect(totalBiomassG(null, 0.5)).toBeNull();
		expect(totalBiomassG(undefined, 0.5)).toBeNull();
		expect(totalBiomassG(0, 0.5)).toBeNull();
	});

	it("returns null instead of NaN when the weight is unusable", () => {
		expect(totalBiomassG(300, null)).toBeNull();
		expect(totalBiomassG(300, 0)).toBeNull();
		expect(totalBiomassG(300, Number.NaN)).toBeNull();
	});
});

describe("dailyFeedG", () => {
	it("applies the feeding rate as a percentage", () => {
		// 40,042.5 g × 5 % = 2,002.13 g/day
		expect(dailyFeedG(40042.5, 5)).toBe(2002.13);
	});

	it("propagates an unknown biomass", () => {
		expect(dailyFeedG(null, 5)).toBeNull();
	});

	it("returns null for a non-positive rate", () => {
		expect(dailyFeedG(1000, 0)).toBeNull();
		expect(dailyFeedG(1000, -5)).toBeNull();
	});
});

describe("feedPerMealG", () => {
	it("splits the daily feed across meals", () => {
		// 2,002.13 g ÷ 2 meals = 1,001.07 g
		expect(feedPerMealG(40042.5, 5, 2)).toBe(1001.07);
	});

	it("returns null when meals per day is invalid", () => {
		expect(feedPerMealG(1000, 5, 0)).toBeNull();
		expect(feedPerMealG(1000, 5, -1)).toBeNull();
	});

	it("propagates an unknown biomass", () => {
		expect(feedPerMealG(null, 5, 2)).toBeNull();
	});
});
