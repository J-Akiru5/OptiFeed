import {
	growthTargetInputSchema,
	isCycleTargetWeightInRange,
	targetWeightGrams,
} from "@/lib/growth-target";
import { formatZodError } from "@/lib/limits";
import {
	type PondGrowthTarget,
	mergePondGrowthTarget,
	parsePondGrowthTarget,
} from "@/lib/pond-profile";
import prisma from "@/lib/prisma";
import type { InputJsonValue } from "@prisma/client/runtime/library";
import { revalidatePath } from "next/cache";

/**
 * Deliberately NOT a "use server" module: every export of a "use server" file
 * is a callable server action, and these functions trust their `ownerId`
 * parameter without an auth check. Only the guarded actions in
 * `lib/actions/growth-target.ts` may call them.
 */

export interface SaveGrowthTargetResult {
	success: boolean;
	error?: string;
	target?: PondGrowthTarget;
}

const POND_NOT_FOUND = "Pond not found.";
const NO_CYCLE = "Start a grow-out cycle before setting a growth target.";
const TARGET_OUT_OF_RANGE = "The target weight is outside the range the cycle target can store.";
const SAVE_FAILED = "Could not save the growth target. Try again.";
const CLEAR_FAILED = "Could not remove the growth target. Try again.";

function revalidateGrowthPaths(): void {
	revalidatePath("/[locale]/(dashboard)/dashboard/growth", "page");
	revalidatePath("/[locale]/(dashboard)/dashboard", "page");
	revalidatePath("/[locale]/(dashboard)/dashboard/calendar", "page");
}

function knownError(error: unknown): string | null {
	if (!(error instanceof Error)) return null;
	if (error.message === "POND_NOT_FOUND") return POND_NOT_FOUND;
	if (error.message === "NO_CYCLE") return NO_CYCLE;
	if (error.message === "TARGET_OUT_OF_RANGE") return TARGET_OUT_OF_RANGE;
	return null;
}

function prefsWithTarget(prefs: unknown, target: PondGrowthTarget | null): InputJsonValue {
	return mergePondGrowthTarget(prefs, target) as unknown as InputJsonValue;
}

/**
 * Persist the calculator result as the pond's growth target and mirror the same
 * weight into the active cycle (D-1), so the calendar, harvest, admin and
 * Growth pages show one number.
 *
 * The target is written to `Pond.notificationPrefs.profile.growthTarget`
 * (the pre-migration JSON bridge) and read back by `loadGrowthPlanForPond`.
 * Reads and writes are scoped by `ownerId`; a pond owned by another tenant
 * behaves exactly like a missing pond.
 *
 * Edge cases:
 * - No active cycle: refused, nothing is written. A target always names the
 *   cycle it belongs to, so there is nothing to mirror onto.
 * - Out-of-range mirror: refused before any write. The calculator range is
 *   already within the cycle field's range, so this only guards corrupted or
 *   future input.
 */
export async function saveGrowthTargetForPond(params: {
	pondId: string;
	ownerId: string;
	input: unknown;
	now?: Date;
}): Promise<SaveGrowthTargetResult> {
	const parsed = growthTargetInputSchema.safeParse(params.input);
	if (!parsed.success) {
		return { success: false, error: formatZodError(parsed.error) };
	}

	const weightG = targetWeightGrams(parsed.data.targetWeightKg);
	if (!isCycleTargetWeightInRange(weightG)) {
		return { success: false, error: TARGET_OUT_OF_RANGE };
	}

	try {
		const saved = await prisma.$transaction(async (tx) => {
			const pond = await tx.pond.findFirst({
				where: { id: params.pondId, ownerId: params.ownerId },
				select: { id: true, notificationPrefs: true },
			});
			if (!pond) throw new Error("POND_NOT_FOUND");

			const cycle = await tx.cropCycle.findFirst({
				where: { pondId: pond.id, status: "ACTIVE" },
				select: { id: true },
			});
			if (!cycle) throw new Error("NO_CYCLE");

			const target: PondGrowthTarget = {
				targetWeightG: weightG,
				population: parsed.data.population ?? null,
				cycleId: cycle.id,
				setAt: (params.now ?? new Date()).toISOString(),
			};

			const updated = await tx.pond.updateMany({
				where: { id: pond.id, ownerId: params.ownerId },
				data: { notificationPrefs: prefsWithTarget(pond.notificationPrefs, target) },
			});
			if (updated.count !== 1) throw new Error("POND_NOT_FOUND");

			const mirrored = await tx.cropCycle.updateMany({
				where: { id: cycle.id, pondId: pond.id, status: "ACTIVE" },
				data: { targetHarvestWeightG: target.targetWeightG },
			});
			if (mirrored.count !== 1) throw new Error("NO_CYCLE");

			return target;
		});

		revalidateGrowthPaths();
		return { success: true, target: saved };
	} catch (error) {
		const message = knownError(error);
		if (message) return { success: false, error: message };
		console.error("[growth-target] save failed:", error);
		return { success: false, error: SAVE_FAILED };
	}
}

/**
 * Remove the saved target and clear the mirrored cycle value (D-1).
 *
 * Only the cycle the target was set against is touched, and only while it is
 * still ACTIVE. A harvested cycle keeps its historical target weight, and a
 * missing cycle still lets the pond target be removed.
 */
export async function clearGrowthTargetForPond(params: {
	pondId: string;
	ownerId: string;
}): Promise<{ success: boolean; error?: string }> {
	try {
		await prisma.$transaction(async (tx) => {
			const pond = await tx.pond.findFirst({
				where: { id: params.pondId, ownerId: params.ownerId },
				select: { id: true, notificationPrefs: true },
			});
			if (!pond) throw new Error("POND_NOT_FOUND");

			const saved = parsePondGrowthTarget(pond.notificationPrefs);

			const updated = await tx.pond.updateMany({
				where: { id: pond.id, ownerId: params.ownerId },
				data: { notificationPrefs: prefsWithTarget(pond.notificationPrefs, null) },
			});
			if (updated.count !== 1) throw new Error("POND_NOT_FOUND");

			if (saved) {
				// A missing or harvested cycle is not an error: there is no
				// active mirror left to clear and history is left intact.
				await tx.cropCycle.updateMany({
					where: { id: saved.cycleId, pondId: pond.id, status: "ACTIVE" },
					data: { targetHarvestWeightG: null },
				});
			}
		});

		revalidateGrowthPaths();
		return { success: true };
	} catch (error) {
		const message = knownError(error);
		if (message) return { success: false, error: message };
		console.error("[growth-target] clear failed:", error);
		return { success: false, error: CLEAR_FAILED };
	}
}
