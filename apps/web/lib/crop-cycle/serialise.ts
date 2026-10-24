import { utcDateToDateOnly } from "@/lib/crop-cycle/dates";
import type { CropCycleDto } from "@/lib/crop-cycle/types";

/**
 * Convert a Prisma crop-cycle row into the DTO the calendar client uses.
 * Shared by the operator Harvest page and the admin calendar overview.
 */
export function serialiseCycle(cycle: {
	id: string;
	pondId: string;
	label: string | null;
	status: "ACTIVE" | "HARVESTED" | "CANCELLED";
	stockingDate: Date;
	stockingCount: number;
	stockingAvgWeightG: number | null;
	growOutDays: number;
	targetHarvestDate: Date;
	targetHarvestWeightG: number | null;
	expectedSurvivalPct: number | null;
	actualHarvestDate: Date | null;
	actualHarvestWeightKg: number | null;
	actualHarvestCount: number | null;
	actualFcr: number | null;
	notes: string | null;
}): CropCycleDto {
	return {
		id: cycle.id,
		pondId: cycle.pondId,
		label: cycle.label,
		status: cycle.status,
		stockingDate: utcDateToDateOnly(cycle.stockingDate),
		stockingCount: cycle.stockingCount,
		stockingAvgWeightG: cycle.stockingAvgWeightG,
		growOutDays: cycle.growOutDays,
		targetHarvestDate: utcDateToDateOnly(cycle.targetHarvestDate),
		targetHarvestWeightG: cycle.targetHarvestWeightG,
		expectedSurvivalPct: cycle.expectedSurvivalPct,
		actualHarvestDate: cycle.actualHarvestDate ? utcDateToDateOnly(cycle.actualHarvestDate) : null,
		actualHarvestWeightKg: cycle.actualHarvestWeightKg,
		actualHarvestCount: cycle.actualHarvestCount,
		actualFcr: cycle.actualFcr,
		notes: cycle.notes,
	};
}
