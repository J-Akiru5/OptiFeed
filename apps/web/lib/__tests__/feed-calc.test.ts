import { describe, expect, it } from "vitest";
import { dailyFeedG, feedPerMealG, totalBiomassG } from "../feed-calc";

describe("totalBiomassG", () => {
	it("computes population × average weight in grams", () => {
		// 86 fish × 13.78g ≈ 1,185g (reference example)
		expect(totalBiomassG(86, 0.01378)).toBe(1185.08);
	});

	it("returns null when population is null (no phantom fish)", () => {
		expect(totalBiomassG(null, 0.5)).toBeNull();
	});

	it("returns null when population is zero or negative", () => {
		expect(totalBiomassG(0, 0.5)).toBeNull();
		expect(totalBiomassG(-10, 0.5)).toBeNull();
	});

	it("rounds to 2 decimals", () => {
		// 3 fish × 0.1378g... × 1000 = 413.399999... → 413.4
		expect(totalBiomassG(3, 0.1378)).toBe(413.4);
	});
});

describe("dailyFeedG", () => {
	it("Daily Feed = Total Biomass × Feeding Rate", () => {
		// 1,185g × 5% = 59.25g (reference example)
		expect(dailyFeedG(1185, 5)).toBe(59.25);
	});

	it("supports the 3% / 4% / 5% reference rows", () => {
		expect(dailyFeedG(1185, 3)).toBe(35.55);
		expect(dailyFeedG(1185, 4)).toBe(47.4);
		expect(dailyFeedG(1185, 5)).toBe(59.25);
	});

	it("returns 0 for a 0% rate", () => {
		expect(dailyFeedG(1185, 0)).toBe(0);
	});

	it("propagates an unknown biomass instead of inventing a number", () => {
		expect(dailyFeedG(null, 5)).toBeNull();
	});
});

describe("feedPerMealG", () => {
	it("Feed per Meal = Daily Feed ÷ Feeds Per Day", () => {
		// 59.25g ÷ 2 = 29.63g (reference example)
		expect(feedPerMealG(1185, 5, 2)).toBe(29.63);
		// 59.25g ÷ 3 = 19.75g
		expect(feedPerMealG(1185, 5, 3)).toBe(19.75);
	});

	it("matches the 2-split and 3-split reference table", () => {
		expect(feedPerMealG(1185, 3, 2)).toBe(17.78);
		expect(feedPerMealG(1185, 3, 3)).toBe(11.85);
		expect(feedPerMealG(1185, 4, 2)).toBe(23.7);
		expect(feedPerMealG(1185, 4, 3)).toBe(15.8);
	});

	it("returns 0 when feedsPerDay is 0 or negative", () => {
		expect(feedPerMealG(1185, 5, 0)).toBe(0);
		expect(feedPerMealG(1185, 5, -2)).toBe(0);
	});

	it("returns null when the biomass is unknown", () => {
		expect(feedPerMealG(null, 5, 2)).toBeNull();
	});
});
