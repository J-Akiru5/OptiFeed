export interface FcrCalculationInput {
	currentBiomassKg: number;
	targetWeightKg: number;
	days: number;
	currentFcr: number;
}

export interface FcrCalculationResult {
	totalFeedNeededKg: number;
	dailyFeedRationKg: number;
	totalBiomassGainKg: number;
	dailyBiomassGainKg: number;
	suggestedFeedingRatePct: number;
	daysToTarget: number;
}

const DEFAULT_FCR = 1.5;

export function calculateFeedRequirement(input: FcrCalculationInput): FcrCalculationResult {
	const fcr =
		Number.isFinite(input.currentFcr) && input.currentFcr > 0 ? input.currentFcr : DEFAULT_FCR;
	const currentBiomassKg = Number.isFinite(input.currentBiomassKg)
		? Math.max(0, input.currentBiomassKg)
		: 0;
	const targetWeightKg = Number.isFinite(input.targetWeightKg) ? input.targetWeightKg : 0;
	const days = Number.isFinite(input.days) && input.days > 0 ? input.days : 0;
	const totalBiomassGainKg = Math.max(0, targetWeightKg - currentBiomassKg);
	const totalFeedNeededKg = totalBiomassGainKg * fcr;
	const dailyBiomassGainKg = days > 0 ? totalBiomassGainKg / days : 0;
	const dailyFeedRationKg = days > 0 ? totalFeedNeededKg / days : 0;
	// Feeding rate = daily ration ÷ total biomass × 100. Both inputs are total
	// kilograms, so no fish count is involved; dividing by a fish count here made
	// the answer DEFAULT_FISH_COUNT (5,000) times too small.
	const suggestedFeedingRatePct =
		currentBiomassKg > 0 ? (dailyFeedRationKg / currentBiomassKg) * 100 : 0;

	return {
		totalFeedNeededKg: Math.round(totalFeedNeededKg * 100) / 100,
		dailyFeedRationKg: Math.round(dailyFeedRationKg * 100) / 100,
		totalBiomassGainKg: Math.round(totalBiomassGainKg * 100) / 100,
		dailyBiomassGainKg: Math.round(dailyBiomassGainKg * 100) / 100,
		suggestedFeedingRatePct: Math.round(suggestedFeedingRatePct * 100) / 100,
		daysToTarget: days,
	};
}
