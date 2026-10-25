"use server";

import { requirePermission } from "@/lib/auth/permissions";
import { requireWriteAccess } from "@/lib/auth/session";
import { cropCycleInputSchema } from "@/lib/crop-cycle/schema";
import { formatZodError } from "@/lib/limits";
import { getActivePond } from "@/lib/pond-selection";
import { createCropCycle, updateCropCycle } from "./crop-cycle";
import { applyGrowthPlan } from "./growth-plan";

export interface ExecuteChatActionResult {
	success: boolean;
	message: string;
}

/**
 * Execute a previewed assistant action. The client sends back the same args it
 * displayed, but nothing is trusted: the active pond is resolved server-side,
 * the schema is revalidated and the underlying action rechecks permissions.
 */
export async function executeChatAction(input: {
	type: string;
	args: Record<string, unknown>;
}): Promise<ExecuteChatActionResult> {
	try {
		await requireWriteAccess();
		const pond = await getActivePond();
		if (!pond) return { success: false, message: "No active pond." };

		const previewPondId = typeof input.args.pondId === "string" ? input.args.pondId : null;
		if (previewPondId && previewPondId !== pond.id) {
			return {
				success: false,
				message:
					"The active pond changed since that preview. Ask me again so I can rebuild it for this pond.",
			};
		}

		if (input.type === "create_crop_cycle") {
			await requirePermission("manage_crop_cycle");
			const parsed = cropCycleInputSchema.safeParse({
				...input.args,
				pondId: pond.id,
			});
			if (!parsed.success) {
				return { success: false, message: formatZodError(parsed.error) };
			}
			const result = await createCropCycle(parsed.data);
			return result.success
				? {
						success: true,
						message: "Grow-out cycle created. The stocking and harvest events are on the calendar.",
					}
				: { success: false, message: result.error };
		}

		if (input.type === "update_crop_cycle") {
			await requirePermission("manage_crop_cycle");
			const cycleId = typeof input.args.cycleId === "string" ? input.args.cycleId : "";
			if (!cycleId) return { success: false, message: "Missing cycle id." };
			const parsed = cropCycleInputSchema.safeParse({
				...input.args,
				pondId: pond.id,
			});
			if (!parsed.success) {
				return { success: false, message: formatZodError(parsed.error) };
			}
			const result = await updateCropCycle(cycleId, parsed.data);
			return result.success
				? {
						success: true,
						message:
							"Grow-out cycle updated. The calendar stocking and harvest dates were updated too.",
					}
				: { success: false, message: result.error };
		}

		if (input.type === "apply_growth_plan") {
			await requirePermission("manage_schedule");
			const grams =
				typeof input.args.grams === "number" && Number.isFinite(input.args.grams)
					? input.args.grams
					: undefined;
			const result = await applyGrowthPlan(pond.id, { grams });
			return result.success
				? {
						success: true,
						message: `Feeding amount updated to ${result.newGrams?.toFixed(1) ?? "—"}g per meal. The next adjustment is available after 15 days.`,
					}
				: { success: false, message: result.error ?? "Could not apply the plan." };
		}

		return { success: false, message: "That action is not supported." };
	} catch (error) {
		console.error("[chat-agent] execute failed:", error);
		return { success: false, message: "Could not execute that action." };
	}
}
