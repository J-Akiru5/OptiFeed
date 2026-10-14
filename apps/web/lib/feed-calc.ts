import { DEFAULT_FISH_COUNT } from "./constants";

function round2(n: number): number {
	// Epsilon guards float artifacts on exact half values (17.775 → 17.78).
	return Math.round((n + Math.abs(n) * 1e-9) * 100) / 100;
}

/**
 * Total biomass in grams: population × average body weight.
 * Null/invalid population falls back to DEFAULT_FISH_COUNT.
 */
export function totalBiomassG(population: number | null | undefined, avgWeightKg: number): number {
	const count = population && population > 0 ? population : DEFAULT_FISH_COUNT;
	return round2(avgWeightKg * 1000 * count);
}

/**
 * Daily Feed (g) = Total Biomass (g) × Feeding Rate (%)
 * e.g. 1,185g × 5% = 59.25g
 */
export function dailyFeedG(biomassG: number, feedingRatePct: number): number {
	return round2(biomassG * (feedingRatePct / 100));
}

/**
 * Feed per Meal (g) = Daily Feed (g) ÷ Feeds Per Day
 * e.g. 59.25g ÷ 2 = 29.63g
 */
export function feedPerMealG(
	biomassG: number,
	feedingRatePct: number,
	feedsPerDay: number,
): number {
	if (feedsPerDay <= 0) return 0;
	return round2(dailyFeedG(biomassG, feedingRatePct) / feedsPerDay);
}
