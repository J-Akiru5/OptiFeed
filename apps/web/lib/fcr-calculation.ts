export interface FcrCalculationInput {
	/** Total pond biomass now, kg (all live fish). */
	currentBiomassKg: number;
	/** Total pond biomass wanted at the target date, kg. */
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

export const DEFAULT_FCR = 1.5;

function round2(value: number): number {
	return Math.round(value * 100) / 100;
}

function finiteOrZero(value: number): number {
	return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/**
 * Reverse FCR plan: biomass to add → feed needed at the current FCR.
 *
 *   total gain (kg)     = target biomass − current biomass   (≥ 0)
 *   total feed (kg)     = total gain × FCR
 *   daily feed (kg)     = total feed ÷ days
 *   suggested rate (%)  = daily feed ÷ current biomass × 100
 *
 * The rate is a ratio of two masses, so the fish count cancels out. The old
 * implementation divided by `DEFAULT_FISH_COUNT` (5,000) as if it were a
 * per-fish quantity, which made the result 5,000× too small — the FCR
 * calculator displayed "0%" for every pond (audit 2026-10-28).
 */
export function calculateFeedRequirement(input: FcrCalculationInput): FcrCalculationResult {
	const currentBiomassKg = finiteOrZero(input.currentBiomassKg);
	const targetWeightKg = finiteOrZero(input.targetWeightKg);
	const days = finiteOrZero(input.days);
	const currentFcr = finiteOrZero(input.currentFcr);

	const fcr = currentFcr > 0 ? currentFcr : DEFAULT_FCR;
	const totalBiomassGainKg = Math.max(0, targetWeightKg - currentBiomassKg);
	const totalFeedNeededKg = totalBiomassGainKg * fcr;
	const dailyBiomassGainKg = days > 0 ? totalBiomassGainKg / days : 0;
	const dailyFeedRationKg = days > 0 ? totalFeedNeededKg / days : 0;
	const suggestedFeedingRatePct =
		currentBiomassKg > 0 ? (dailyFeedRationKg / currentBiomassKg) * 100 : 0;

	return {
		totalFeedNeededKg: round2(totalFeedNeededKg),
		dailyFeedRationKg: round2(dailyFeedRationKg),
		totalBiomassGainKg: round2(totalBiomassGainKg),
		dailyBiomassGainKg: round2(dailyBiomassGainKg),
		suggestedFeedingRatePct: round2(suggestedFeedingRatePct),
		daysToTarget: days,
	};
}
