import { growthTargetInputSchema, targetWeightGrams } from "@/lib/growth-target";
import { formatZodError } from "@/lib/limits";
import { type PondGrowthTarget, mergePondGrowthTarget } from "@/lib/pond-profile";
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

function revalidateGrowthPaths(): void {
	revalidatePath("/[locale]/(dashboard)/dashboard/growth", "page");
	revalidatePath("/[locale]/(dashboard)/dashboard", "page");
}

/**
 * Persist the calculator result as the pond's growth target.
 *
 * The target is written to `Pond.notificationPrefs.profile.growthTarget`
 * (the pre-migration JSON bridge) and read back by `loadGrowthPlanForPond`.
 * Reads and writes are scoped by `ownerId`; a pond owned by another tenant
 * behaves exactly like a missing pond.
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

	const pond = await prisma.pond.findFirst({
		where: { id: params.pondId, ownerId: params.ownerId },
		select: { id: true, notificationPrefs: true },
	});
	if (!pond) return { success: false, error: POND_NOT_FOUND };

	const cycle = await prisma.cropCycle.findFirst({
		where: { pondId: pond.id, status: "ACTIVE" },
		select: { id: true },
	});
	if (!cycle) return { success: false, error: NO_CYCLE };

	const target: PondGrowthTarget = {
		targetWeightG: targetWeightGrams(parsed.data.targetWeightKg),
		population: parsed.data.population ?? null,
		cycleId: cycle.id,
		setAt: (params.now ?? new Date()).toISOString(),
	};

	const updated = await prisma.pond.updateMany({
		where: { id: pond.id, ownerId: params.ownerId },
		data: {
			notificationPrefs: mergePondGrowthTarget(
				pond.notificationPrefs,
				target,
			) as unknown as InputJsonValue,
		},
	});
	if (updated.count !== 1) return { success: false, error: POND_NOT_FOUND };

	revalidateGrowthPaths();
	return { success: true, target };
}

/** Remove the saved target so the cycle's own target weight applies again. */
export async function clearGrowthTargetForPond(params: {
	pondId: string;
	ownerId: string;
}): Promise<{ success: boolean; error?: string }> {
	const pond = await prisma.pond.findFirst({
		where: { id: params.pondId, ownerId: params.ownerId },
		select: { id: true, notificationPrefs: true },
	});
	if (!pond) return { success: false, error: POND_NOT_FOUND };

	const updated = await prisma.pond.updateMany({
		where: { id: pond.id, ownerId: params.ownerId },
		data: {
			notificationPrefs: mergePondGrowthTarget(
				pond.notificationPrefs,
				null,
			) as unknown as InputJsonValue,
		},
	});
	if (updated.count !== 1) return { success: false, error: POND_NOT_FOUND };

	revalidateGrowthPaths();
	return { success: true };
}
