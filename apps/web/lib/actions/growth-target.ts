"use server";

import { requirePermission } from "@/lib/auth/permissions";
import { getCurrentPondOwnerId, requireWriteAccess } from "@/lib/auth/session";
import type { GrowthTargetInput } from "@/lib/growth-target";
import {
	type SaveGrowthTargetResult,
	clearGrowthTargetForPond,
	saveGrowthTargetForPond,
} from "@/lib/growth-target-store";

export async function setGrowthTarget(
	pondId: string,
	input: GrowthTargetInput,
): Promise<SaveGrowthTargetResult> {
	try {
		await requireWriteAccess();
		await requirePermission("manage_crop_cycle");
		const ownerId = await getCurrentPondOwnerId();
		return await saveGrowthTargetForPond({ pondId, ownerId, input });
	} catch (error) {
		console.error("[growth-target] save failed:", error);
		return { success: false, error: "Could not save the growth target. Try again." };
	}
}

export async function clearGrowthTarget(
	pondId: string,
): Promise<{ success: boolean; error?: string }> {
	try {
		await requireWriteAccess();
		await requirePermission("manage_crop_cycle");
		const ownerId = await getCurrentPondOwnerId();
		return await clearGrowthTargetForPond({ pondId, ownerId });
	} catch (error) {
		console.error("[growth-target] clear failed:", error);
		return { success: false, error: "Could not remove the growth target. Try again." };
	}
}
