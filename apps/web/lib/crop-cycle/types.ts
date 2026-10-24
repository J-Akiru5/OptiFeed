export interface CropCycleDto {
	id: string;
	pondId: string;
	label: string | null;
	status: "ACTIVE" | "HARVESTED" | "CANCELLED";
	stockingDate: string;
	stockingCount: number;
	stockingAvgWeightG: number | null;
	growOutDays: number;
	targetHarvestDate: string;
	targetHarvestWeightG: number | null;
	expectedSurvivalPct: number | null;
	actualHarvestDate: string | null;
	actualHarvestWeightKg: number | null;
	actualHarvestCount: number | null;
	actualFcr: number | null;
	notes: string | null;
}

export interface PondOption {
	id: string;
	name: string;
	isFallow: boolean;
	population: number | null;
}
