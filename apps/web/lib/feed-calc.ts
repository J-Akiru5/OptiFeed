import { DEFAULT_FISH_COUNT } from "./constants";

function round2(n: number): number {
	// Epsilon guards float artifacts on exact half values (17.775 → 17.78).
	return Math.round((n + Math.abs(n) * 1e-9) * 100) / 100;
}

/**
 * Fish alive today: the stocked (or entered) count less its mortality
 * allowance.
 *
 * The team's data sheet computes daily feed from **live fish** (stocked −
 * mortality), not from the number stocked: 300 stocked at 95 % survival is 285
 * live fish, and 0.1405 kg × 285 × 5 % = 2.002 kg — not 2.110 kg, which is what
 * the stocked count gives.
 *
 * `CropCycle.expectedSurvivalPct` is the only mortality figure the app stores,
 * so it is applied here once, in one place. A caller with an observed live
 * count passes 100 (or omits the percentage). Null/zero counts return null so a
 * feed figure can say "not enough data" instead of inventing a population.
 */
export function liveFishCount(
	population: number | null | undefined,
	expectedSurvivalPct: number | null | undefined,
): number | null {
	if (typeof population !== "number" || !Number.isFinite(population) || population <= 0) {
		return null;
	}
	const survival =
		typeof expectedSurvivalPct === "number" &&
		Number.isFinite(expectedSurvivalPct) &&
		expectedSurvivalPct > 0
			? Math.min(100, expectedSurvivalPct)
			: 100;
	const live = Math.round(population * (survival / 100));
	return live >= 1 ? live : null;
}

/**
 * Total biomass of the live fish in grams: live fish × average body weight.
 *
 * Prefer this over `totalBiomassG(population, …)` for feed maths: the plain
 * helper takes the count at face value, which is how the stocked count used to
 * reach the dashboard. Returns null when the count or the weight is unknown.
 */
export function liveBiomassG(
	population: number | null | undefined,
	avgWeightKg: number | null | undefined,
	expectedSurvivalPct: number | null | undefined,
): number | null {
	const count = liveFishCount(population, expectedSurvivalPct);
	if (count === null) return null;
	if (typeof avgWeightKg !== "number" || !Number.isFinite(avgWeightKg) || avgWeightKg <= 0) {
		return null;
	}
	return totalBiomassG(count, avgWeightKg);
}

/**
 * Total biomass in grams: population × average body weight.
 * Null/invalid population falls back to DEFAULT_FISH_COUNT.
 *
 * Kept for callers that already hold a live count (or a preview estimate). Feed
 * paths that start from `Pond.population` should resolve `liveFishCount` first.
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
