import { daysBetween, formatDateOnly, todayDateOnly } from "./dates";

export type CropCycleStage = "early" | "grow" | "finish" | "overdue";

export interface CropCycleMetricsInput {
	stockingDate: Date | string;
	growOutDays: number;
	targetHarvestDate: Date | string;
	stockingCount: number;
	targetHarvestWeightG?: number | null;
	expectedSurvivalPct?: number | null;
}

export interface CropCycleMetrics {
	growOutDay: number;
	daysToHarvest: number;
	progressPct: number;
	stage: CropCycleStage;
	projectedHarvestBiomassKg: number | null;
}

function round2(value: number): number {
	return Math.round(value * 100) / 100;
}

/**
 * Derives the display metrics for a cycle. Pure so the dashboard, Growth strip,
 * AI advisor, and tests all agree on "Day X of Y" and "harvest in Z days".
 */
export function computeCropCycleMetrics(
	input: CropCycleMetricsInput,
	today: string = todayDateOnly(),
): CropCycleMetrics {
	const stockingDate = formatDateOnly(input.stockingDate);
	const targetHarvestDate = formatDateOnly(input.targetHarvestDate);
	const growOutDays = Math.max(1, input.growOutDays);
	const elapsed = Math.max(0, daysBetween(stockingDate, today));
	const growOutDay = Math.min(Math.max(1, elapsed + 1), growOutDays);
	const daysToHarvest = daysBetween(today, targetHarvestDate);
	const progressPct = Math.min(100, Math.max(0, (elapsed / growOutDays) * 100));

	const stage: CropCycleStage =
		daysToHarvest < 0
			? "overdue"
			: daysToHarvest <= 14
				? "finish"
				: elapsed <= 30
					? "early"
					: "grow";

	const projectedHarvestBiomassKg =
		input.targetHarvestWeightG && input.targetHarvestWeightG > 0
			? round2(
					(input.stockingCount *
						((input.expectedSurvivalPct ?? 100) / 100) *
						input.targetHarvestWeightG) /
						1000,
				)
			: null;

	return {
		growOutDay,
		daysToHarvest,
		progressPct,
		stage,
		projectedHarvestBiomassKg,
	};
}

export interface FinalFcrInput {
	totalFeedKg: number;
	harvestWeightKg: number;
	stockingCount: number;
	stockingAvgWeightG?: number | null;
}

/**
 * Final FCR = feed consumed / harvested biomass gain. Returns null when the
 * stocking weight or the gain is unknown/non-positive, rather than inventing a
 * number.
 */
export function computeFinalFcr(input: FinalFcrInput): number | null {
	if (
		!Number.isFinite(input.totalFeedKg) ||
		!Number.isFinite(input.harvestWeightKg) ||
		input.totalFeedKg <= 0 ||
		input.harvestWeightKg <= 0 ||
		!input.stockingAvgWeightG ||
		input.stockingAvgWeightG <= 0
	) {
		return null;
	}

	const stockingBiomassKg = (input.stockingCount * input.stockingAvgWeightG) / 1000;
	const gainKg = input.harvestWeightKg - stockingBiomassKg;
	if (!Number.isFinite(gainKg) || gainKg <= 0) return null;

	return round2(input.totalFeedKg / gainKg);
}
