import { populationSchema } from "@/lib/limits";
import { parsePondGrowthTarget } from "@/lib/pond-profile";
import { z } from "zod";

/**
 * The saved growth target (issue #304). Kept pure so the calculator, the
 * prediction context and the unit tests all agree on what a saved target is
 * and when it applies.
 */

export const MAX_TARGET_WEIGHT_KG = 10;

/**
 * The largest target the cycle field accepts. This mirrors
 * `cropCycleInputSchema.targetHarvestWeightG.max`; D-1 writes the calculator
 * target into that field, so both ranges must agree.
 */
export const MAX_CYCLE_TARGET_WEIGHT_G = 10_000;

export const growthTargetInputSchema = z.object({
	targetWeightKg: z
		.number("Target weight must be a number")
		.finite("Target weight must be a number")
		.min(0.01, "Target weight must be at least 0.01 kg")
		.max(MAX_TARGET_WEIGHT_KG, `Target weight cannot exceed ${MAX_TARGET_WEIGHT_KG} kg`),
	/** The population the calculator used; the pond count remains the source of truth. */
	population: populationSchema.nullish(),
});

export type GrowthTargetInput = z.infer<typeof growthTargetInputSchema>;

/** Store tenths of a gram, matching the planner's rounding. */
export function targetWeightGrams(targetWeightKg: number): number {
	return Math.round(targetWeightKg * 1000 * 10) / 10;
}

/**
 * The saved calculator target for one cycle, or null. Callers pass this into
 * the cycle context so the derived projected-biomass figures stay consistent;
 * the context keeps the cycle's harvest date on purpose (the issue asked for a
 * target weight, and the mission forbids silently moving harvest dates).
 */
export function savedTargetWeightForCycle(prefs: unknown, cycleId: string): number | null {
	const target = parsePondGrowthTarget(prefs);
	if (!target || target.cycleId !== cycleId) return null;
	return target.targetWeightG;
}

/** The two explicit choices offered when a cycle edit collides with a saved target. */
export type GrowthTargetResolution = "replace" | "keep";

/** Store tenths of a gram, matching `targetWeightGrams` and the cycle field. */
export function roundTargetWeightG(value: number): number {
	return Math.round(value * 10) / 10;
}

/**
 * Guard for the mirrored cycle field. The calculator schema already caps at
 * `MAX_TARGET_WEIGHT_KG`, which is the same 10,000 g ceiling; this check exists
 * so a hand-edited or future out-of-range value can never be written into
 * `CropCycle.targetHarvestWeightG`.
 */
export function isCycleTargetWeightInRange(value: number): boolean {
	return Number.isFinite(value) && value > 0 && value <= MAX_CYCLE_TARGET_WEIGHT_G;
}

function sameWeight(left: number | null | undefined, right: number | null | undefined): boolean {
	if (left === null || left === undefined || right === null || right === undefined) {
		return (left ?? null) === (right ?? null);
	}
	return roundTargetWeightG(left) === roundTargetWeightG(right);
}

export interface CycleTargetConflict {
	savedWeightG: number;
	nextWeightG: number | null;
}

/**
 * Decide whether editing the cycle form's target collides with a saved
 * calculator target (D-2).
 *
 * No collision is reported when the target field was not actually edited —
 * the calendar's drag/resize path sends the stored cycle value back — or when
 * the new value already equals the saved one, because the mirror is then
 * consistent and there is nothing to choose.
 */
export function cycleTargetConflict(params: {
	savedWeightG: number | null | undefined;
	cycleWeightG: number | null | undefined;
	nextWeightG: number | null | undefined;
}): CycleTargetConflict | null {
	const saved = params.savedWeightG;
	if (saved === null || saved === undefined || saved <= 0) return null;
	if (sameWeight(params.nextWeightG, params.cycleWeightG)) return null;
	if (sameWeight(params.nextWeightG, saved)) return null;
	return { savedWeightG: saved, nextWeightG: params.nextWeightG ?? null };
}
