import { feedPerMealG, totalBiomassG } from "./feed-calc";

/**
 * Calculates the recommended next feeding volume (per meal) from the latest
 * average weight.
 *
 * Formula:
 * Daily Feed (g) = Total Biomass (g) × feedingRatePct / 100
 * Feed per Meal (g) = Daily Feed (g) / feedsPerDay
 * (see lib/feed-calc.ts — results rounded to 2 decimals)
 *
 * Returns null when the population is unknown: the caller must prompt for the
 * fish count rather than invent one (Amendment A-001, D8).
 *
 * @param avgWeightKg The average body weight of a single fish in kg
 * @param feedingRatePct The daily feeding rate percentage (e.g. 4.5 for 4.5%)
 * @param feedsPerDay Number of feeds per day
 * @param population Real fish count, or null when the pond has none
 * @returns The per-meal feeding volume in grams (2 decimals), or null
 */
export function calculateNextFeeding(
	avgWeightKg: number,
	feedingRatePct: number,
	feedsPerDay: number,
	population: number | null,
): number | null {
	if (feedsPerDay <= 0) return 0;
	return feedPerMealG(totalBiomassG(population, avgWeightKg), feedingRatePct, feedsPerDay);
}
