function round2(n: number): number {
	// Epsilon guards float artifacts on exact half values (17.775 → 17.78).
	return Math.round((n + Math.abs(n) * 1e-9) * 100) / 100;
}

function isPositiveFinite(value: unknown): value is number {
	return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function hasPopulation(population: number | null | undefined): population is number {
	return typeof population === "number" && Number.isFinite(population) && population > 0;
}

/**
 * Total biomass in grams: live fish × average body weight.
 *
 * Returns `null` when the population or the weight is unknown. It used to fall
 * back to `DEFAULT_FISH_COUNT` (5,000) — that invented a population for every
 * pond without one and silently produced a plausible-looking wrong feed
 * amount. Feed maths must show "—" instead (calculation audit 2026-10-28).
 */
export function totalBiomassG(
	population: number | null | undefined,
	avgWeightKg: number | null | undefined,
): number | null {
	if (!hasPopulation(population) || !isPositiveFinite(avgWeightKg)) return null;
	return round2(avgWeightKg * 1000 * population);
}

/**
 * Daily Feed (g) = Total Biomass (g) × Feeding Rate (%)
 * e.g. 1,185 g × 5% = 59.25 g
 *
 * `null` propagates from an unknown biomass or an invalid rate.
 */
export function dailyFeedG(
	biomassG: number | null | undefined,
	feedingRatePct: number | null | undefined,
): number | null {
	if (biomassG === null || biomassG === undefined || !Number.isFinite(biomassG)) return null;
	if (!isPositiveFinite(feedingRatePct)) return null;
	return round2(biomassG * (feedingRatePct / 100));
}

/**
 * Feed per Meal (g) = Daily Feed (g) ÷ Feeds Per Day
 * e.g. 59.25 g ÷ 2 = 29.63 g
 */
export function feedPerMealG(
	biomassG: number | null | undefined,
	feedingRatePct: number | null | undefined,
	feedsPerDay: number | null | undefined,
): number | null {
	if (!isPositiveFinite(feedsPerDay)) return null;
	const daily = dailyFeedG(biomassG, feedingRatePct);
	if (daily === null) return null;
	return round2(daily / feedsPerDay);
}
