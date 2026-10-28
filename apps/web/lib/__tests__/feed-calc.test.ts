import { describe, expect, it } from "vitest";
import { DEFAULT_FISH_COUNT } from "../constants";
import { dailyFeedG, feedPerMealG, liveBiomassG, liveFishCount, totalBiomassG } from "../feed-calc";

describe("liveFishCount", () => {
	// The team's data sheet: 300 stocked, 285 live after mortality.
	it("deducts the mortality allowance", () => {
		expect(liveFishCount(300, 95)).toBe(285);
		expect(liveFishCount(300, 100)).toBe(300);
		expect(liveFishCount(300, null)).toBe(300);
	});

	it("treats an invalid survival percentage as no known mortality", () => {
		// 0/-10/140 are corrupt values, not "almost every fish died".
		expect(liveFishCount(300, 0)).toBe(300);
		expect(liveFishCount(300, -10)).toBe(300);
		expect(liveFishCount(300, 140)).toBe(300);
	});

	it("returns null instead of inventing a population", () => {
		expect(liveFishCount(null, 95)).toBeNull();
		expect(liveFishCount(0, 95)).toBeNull();
		expect(liveFishCount(Number.NaN, 95)).toBeNull();
		// One fish at 1 % survival rounds to none alive.
		expect(liveFishCount(1, 1)).toBeNull();
	});
});

describe("liveBiomassG", () => {
	it("matches the data sheet's daily feed for 285 live fish", () => {
		const biomass = liveBiomassG(300, 0.1405, 95);
		expect(biomass).toBe(40042.5);
		// 40,042.5 g × 5 % = 2,002.13 g (the sheet's "2.0 kg"), not the
		// 2,107.5 g the stocked count of 300 produces.
		expect(dailyFeedG(biomass ?? 0, 5)).toBe(2002.13);
		expect(dailyFeedG(totalBiomassG(300, 0.1405), 5)).toBe(2107.5);
	});

	it("returns null when the weight or the count is unknown", () => {
		expect(liveBiomassG(300, null, 95)).toBeNull();
		expect(liveBiomassG(null, 0.1405, 95)).toBeNull();
	});
});

describe("totalBiomassG", () => {
	it("computes population × average weight in grams", () => {
		// 86 fish × 13.78g ≈ 1,185g (reference example)
		expect(totalBiomassG(86, 0.01378)).toBe(1185.08);
	});

	it("falls back to DEFAULT_FISH_COUNT when population is null", () => {
		expect(totalBiomassG(null, 0.5)).toBe(0.5 * 1000 * DEFAULT_FISH_COUNT);
	});

	it("falls back to DEFAULT_FISH_COUNT when population is 0", () => {
		expect(totalBiomassG(0, 0.5)).toBe(0.5 * 1000 * DEFAULT_FISH_COUNT);
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
});
