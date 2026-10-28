import { feedPerMealG, totalBiomassG } from "./feed-calc";

/**
 * Calculates the recommended next feeding volume (per meal) from the latest
 * average weight and the pond's **live** fish count.
 *
 * Formula:
 * Daily Feed (g) = Total Biomass (g) × feedingRatePct / 100
 * Feed per Meal (g) = Daily Feed (g) / feedsPerDay
 * (see lib/feed-calc.ts — results rounded to 2 decimals)
 *
 * @param avgWeightKg The average body weight of a single fish in kg
 * @param feedingRatePct The daily feeding rate percentage (e.g. 4.5 for 4.5%)
 * @param feedsPerDay Number of feeds per day
 * @param population Live fish count from `lib/population.ts` (stocked − mortality)
 * @returns The per-meal feeding volume in grams, or `null` when the population
 * or weight is unknown. It never substitutes a default count.
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
