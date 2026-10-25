import type { PredictionCycleContext } from "@/lib/prediction";
import { formatDateOnly, todayDateOnly } from "./dates";
import { computeCropCycleMetrics } from "./metrics";

export interface CycleForPrediction {
	id: string;
	label: string | null;
	stockingDate: Date | string;
	stockingCount: number;
	growOutDays: number;
	targetHarvestDate: Date | string;
	targetHarvestWeightG: number | null;
	expectedSurvivalPct: number | null;
}

/** Shared mapping so the API route, dashboard, and Growth page agree. */
export function toPredictionCycleContext(
	cycle: CycleForPrediction,
	today: string = todayDateOnly(),
): PredictionCycleContext {
	const metrics = computeCropCycleMetrics(cycle, today);
	return {
		cycleId: cycle.id,
		label: cycle.label,
		growOutDay: metrics.growOutDay,
		growOutDays: cycle.growOutDays,
		daysToHarvest: metrics.daysToHarvest,
		targetHarvestDate: formatDateOnly(cycle.targetHarvestDate),
		targetHarvestWeightG: cycle.targetHarvestWeightG,
		projectedHarvestBiomassKg: metrics.projectedHarvestBiomassKg,
		stage: metrics.stage,
	};
}
