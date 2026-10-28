function round2(n: number): number {
	// Epsilon guards float artifacts on exact half values (17.775 → 17.78).
	return Math.round((n + Math.abs(n) * 1e-9) * 100) / 100;
}

/**
 * Total biomass in grams: population × average body weight.
 *
 * A missing or invalid population returns null instead of assuming a fish
 * count. Amendment A-001 (D8): no automatic feed number may be produced from a
 * phantom population.
 */
export function totalBiomassG(
	population: number | null | undefined,
	avgWeightKg: number,
): number | null {
	if (typeof population !== "number" || !Number.isFinite(population) || population <= 0) {
		return null;
	}
	if (!Number.isFinite(avgWeightKg) || avgWeightKg <= 0) return null;
	return round2(avgWeightKg * 1000 * population);
}

/**
 * Daily Feed (g) = Total Biomass (g) × Feeding Rate (%)
 * e.g. 1,185g × 5% = 59.25g
 */
export function dailyFeedG(biomassG: number | null, feedingRatePct: number): number | null {
	if (biomassG === null) return null;
	return round2(biomassG * (feedingRatePct / 100));
}

/**
 * Feed per Meal (g) = Daily Feed (g) ÷ Feeds Per Day
 * e.g. 59.25g ÷ 2 = 29.63g
 */
export function feedPerMealG(
	biomassG: number | null,
	feedingRatePct: number,
	feedsPerDay: number,
): number | null {
	if (feedsPerDay <= 0) return 0;
	const daily = dailyFeedG(biomassG, feedingRatePct);
	if (daily === null) return null;
	return round2(daily / feedsPerDay);
}
