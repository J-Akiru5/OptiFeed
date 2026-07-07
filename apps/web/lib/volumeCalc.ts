/**
 * Calculates the recommended next feeding volume based on the latest biomass average weight.
 *
 * Formula:
 * Next Feed (g) = ((Average Weight (kg) * ASSUMED_FISH_COUNT * feedingRatePct / 100) / feedsPerDay) * 1000
 *
 * @param avgWeightKg The average body weight of a single fish in kg
 * @param feedingRatePct The daily feeding rate percentage (e.g. 4.5 for 4.5%)
 * @param feedsPerDay Number of feeds per day
 * @param assumedFishCount Assumed number of fish in the pond (default 5000 for demo)
 * @returns The next feeding volume in grams (rounded to the nearest whole gram)
 */
export function calculateNextFeeding(
	avgWeightKg: number,
	feedingRatePct: number,
	feedsPerDay: number,
	assumedFishCount = 5000,
): number {
	if (feedsPerDay <= 0) return 0;

	const totalBiomassKg = avgWeightKg * assumedFishCount;
	const dailyFeedAmountKg = totalBiomassKg * (feedingRatePct / 100);
	const nextFeedAmountKg = dailyFeedAmountKg / feedsPerDay;

	return Math.round(nextFeedAmountKg * 1000);
}
