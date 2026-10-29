import { populationSchema } from "@/lib/limits";
import { parsePondGrowthTarget } from "@/lib/pond-profile";
import { z } from "zod";

/**
 * The saved growth target (issue #304). Kept pure so the calculator, the
 * prediction context and the unit tests all agree on what a saved target is
 * and when it applies.
 */

export const MAX_TARGET_WEIGHT_KG = 10;

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
