import type { ResolvedGrowthDefaults } from "@/lib/growth/defaults";
import type { GrowthHistorySuggestion } from "@/lib/growth/history";

export interface CropCycleDto {
	id: string;
	pondId: string;
	label: string | null;
	status: "ACTIVE" | "HARVESTED" | "CANCELLED";
	stockingDate: string;
	stockingCount: number;
	/** Fish lost against this cycle so far (#764); absent on older payloads. */
	deadCount?: number;
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
	areaM2: number | null;
	averageDepthM: number | null;
	/**
	 * The saved calculator target (D-1/D-2) when it belongs to this pond's
	 * ACTIVE cycle. `null` means the cycle form must save without asking.
	 */
	savedTargetWeightG: number | null;
	/**
	 * Pond override → farm default → documented constant (#828), resolved on
	 * the server. Absent on older payloads and in tests; the form then falls
	 * back to the constants, exactly like a fresh install.
	 */
	growthDefaults?: ResolvedGrowthDefaults;
	/**
	 * Evidence from this farm's completed cycles (#828). Empty or absent means
	 * "no suggestion" — the dialog must not invent a number.
	 */
	growthSuggestions?: GrowthHistorySuggestion[];
}
