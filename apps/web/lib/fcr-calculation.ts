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

import { DEFAULT_FISH_COUNT } from "./constants";

const DEFAULT_FCR = 1.5;

export function calculateFeedRequirement(input: FcrCalculationInput): FcrCalculationResult {
	const fcr = input.currentFcr > 0 ? input.currentFcr : DEFAULT_FCR;
	const totalBiomassGainKg = Math.max(0, input.targetWeightKg - input.currentBiomassKg);
	const totalFeedNeededKg = totalBiomassGainKg * fcr;
	const dailyBiomassGainKg = input.days > 0 ? totalBiomassGainKg / input.days : 0;
	const dailyFeedRationKg = input.days > 0 ? totalFeedNeededKg / input.days : 0;
	const dailyFeedPerFishG = (dailyFeedRationKg * 1000) / DEFAULT_FISH_COUNT;
	const totalBiomassG = input.currentBiomassKg * 1000 * DEFAULT_FISH_COUNT;
	const suggestedFeedingRatePct =
		totalBiomassG > 0 ? (dailyFeedPerFishG / (totalBiomassG / DEFAULT_FISH_COUNT)) * 100 : 0;

	return {
		totalFeedNeededKg: Math.round(totalFeedNeededKg * 100) / 100,
		dailyFeedRationKg: Math.round(dailyFeedRationKg * 100) / 100,
		totalBiomassGainKg: Math.round(totalBiomassGainKg * 100) / 100,
		dailyBiomassGainKg: Math.round(dailyBiomassGainKg * 100) / 100,
		suggestedFeedingRatePct: Math.round(suggestedFeedingRatePct * 100) / 100,
		daysToTarget: input.days,
	};
}
