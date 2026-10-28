/**
 * Feed requirement from a target weight and an FCR.
 *
 * Inputs are per-fish body weights, which is what a farmer measures; the
 * population turns them into biomass. The previous version divided by the
 * hard-coded 5,000-fish constant and treated the labelled "biomass" as a
 * per-fish weight, which understated the suggested rate by exactly that
 * constant (5,000x). See Amendment A-001.
 */
export interface FcrCalculationInput {
	/** Current mean body weight of one fish, in kg. */
	currentWeightKg: number;
	/** Target mean body weight of one fish, in kg. */
	targetWeightKg: number;
	/** Real fish count. */
	population: number;
	days: number;
	currentFcr: number;
	/** Optional: meals per day, to also return a per-meal dose. */
	feedsPerDay?: number;
}

export interface FcrCalculationResult {
	totalFeedNeededKg: number;
	dailyFeedRationKg: number;
	totalBiomassGainKg: number;
	dailyBiomassGainKg: number;
	suggestedFeedingRatePct: number;
	gramsPerFeeding: number | null;
	daysToTarget: number;
}

const DEFAULT_FCR = 1.5;

function round2(value: number): number {
	return Math.round((value + Math.abs(value) * 1e-9) * 100) / 100;
}

export function calculateFeedRequirement(input: FcrCalculationInput): FcrCalculationResult {
	const fcr = input.currentFcr > 0 ? input.currentFcr : DEFAULT_FCR;
	const population =
		Number.isFinite(input.population) && input.population > 0 ? Math.round(input.population) : 0;
	const gainPerFishKg = Math.max(0, input.targetWeightKg - input.currentWeightKg);
	const totalBiomassGainKg = gainPerFishKg * population;
	const totalFeedNeededKg = totalBiomassGainKg * fcr;
	const dailyBiomassGainKg = input.days > 0 ? totalBiomassGainKg / input.days : 0;
	const dailyFeedRationKg = input.days > 0 ? totalFeedNeededKg / input.days : 0;
	const currentBiomassKg = input.currentWeightKg * population;
	const suggestedFeedingRatePct =
		currentBiomassKg > 0 ? (dailyFeedRationKg / currentBiomassKg) * 100 : 0;
	const gramsPerFeeding =
		input.feedsPerDay && input.feedsPerDay > 0
			? (dailyFeedRationKg * 1000) / input.feedsPerDay
			: null;

	return {
		totalFeedNeededKg: round2(totalFeedNeededKg),
		dailyFeedRationKg: round2(dailyFeedRationKg),
		totalBiomassGainKg: round2(totalBiomassGainKg),
		dailyBiomassGainKg: round2(dailyBiomassGainKg),
		suggestedFeedingRatePct: round2(suggestedFeedingRatePct),
		gramsPerFeeding: gramsPerFeeding === null ? null : round2(gramsPerFeeding),
		daysToTarget: input.days,
	};
}
