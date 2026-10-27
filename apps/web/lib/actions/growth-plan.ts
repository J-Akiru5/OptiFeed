"use server";

import { requirePermission } from "@/lib/auth/permissions";
import { getCurrentPondOwnerId, requireWriteAccess } from "@/lib/auth/session";
import { type ApplyGrowthPlanResult, applyGrowthPlanForPond } from "@/lib/growth-plan-apply";

export async function applyGrowthPlan(
	pondId: string,
	options: { grams?: number; note?: string; initialize?: boolean } = {},
): Promise<ApplyGrowthPlanResult> {
	try {
		await requireWriteAccess();
		await requirePermission("manage_schedule");
		const ownerId = await getCurrentPondOwnerId();
		return applyGrowthPlanForPond({
			pondId,
			ownerId,
			actorId: ownerId,
			grams: options.grams,
			note: options.note,
			initialize: options.initialize,
		});
	} catch (error) {
		console.error("[growth-plan] apply failed:", error);
		return { success: false, error: "Could not apply the growth plan. Try again." };
	}
}
