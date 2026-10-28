import { describe, expect, it } from "vitest";
import { calculateNextFeeding } from "../volumeCalc";

/**
 * The per-meal feed amount. Fixtures are the team's reference sheet
 * ("Catfish Feed Calculation Data Collection Sheet", 2026-10-28), which feeds
 * **live fish** (stocked − mortality): 300 → 285 after 15 losses.
 *
 *   daily feed = ABW × live fish × rate        per meal = daily ÷ meals
 */
describe("calculateNextFeeding", () => {
	it("matches the sheet's daily feed for each sampling row", () => {
		// Sampling 2: 0.0138 kg × 285 × 10 % = 0.3933 kg/day = 393.3 g/day.
		const perMeal = calculateNextFeeding(0.0138, 10, 1, 285);
		expect(perMeal).toBe(393.3);
	});

	it("uses live fish, not the stocked count", () => {
		// Sampling 5: 0.1405 kg × 285 × 5 % = 2.002 kg/day → 1,001.07 g per meal.
		expect(calculateNextFeeding(0.1405, 5, 2, 285)).toBe(1001.07);

		// The old (wrong) stocked count feeds 300 fish: 2,107.5 g/day → 1,053.75 g.
		expect(calculateNextFeeding(0.1405, 5, 2, 300)).toBe(1053.75);
	});

	it("returns null instead of inventing a population", () => {
		expect(calculateNextFeeding(0.5, 3, 3, null)).toBeNull();
	});

	it("accepts a real pond population", () => {
		// 1 kg × 1,000 fish × 5 % = 50 kg/day ÷ 2 meals = 25 kg = 25,000 g.
		expect(calculateNextFeeding(1, 5, 2, 1000)).toBe(25000);
	});

	it("rounds to 2 decimals", () => {
		// 0.123 kg × 100 fish × 4.5 % = 0.5535 kg/day ÷ 3 = 184.5 g.
		expect(calculateNextFeeding(0.123, 4.5, 3, 100)).toBe(184.5);
	});

	it("returns 0 when no meal is scheduled", () => {
		expect(calculateNextFeeding(0.5, 3, 0, 100)).toBe(0);
		expect(calculateNextFeeding(0.5, 3, -1, 100)).toBe(0);
	});

	it("handles a zero weight or rate", () => {
		expect(calculateNextFeeding(0, 3, 3, 100)).toBeNull();
		expect(calculateNextFeeding(0.5, 0, 3, 100)).toBeNull();
	});
});
