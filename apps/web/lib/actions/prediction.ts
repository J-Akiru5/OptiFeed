"use server";

import { getCurrentPondOwnerId, requireWriteAccess } from "@/lib/auth/session";
import { feedGramsSchema, formatZodError } from "@/lib/limits";
import { PREDICTION_DEVIATION_THRESHOLD } from "@/lib/prediction";
import prisma from "@/lib/prisma";
import { revalidatePath } from "next/cache";

export interface ApplyPredictionResult {
	success: boolean;
	error?: string;
	previousGrams?: number;
	newGrams?: number;
}

/**
 * Applies an AI/deterministic feeding prediction to the device's scheduled
 * grams per feeding. The value flows to the firmware via the existing
 * /api/schedule-sync poll — no command queue needed (grams is a config field).
 *
 * Safety: same feedGramsSchema range check and ±50% deviation veto as the
 * biomass auto-adjust path (lib/actions/biomass.ts).
 */
export async function applyPredictedGrams(
	deviceId: string,
	grams: number,
): Promise<ApplyPredictionResult> {
	try {
		await requireWriteAccess();
		const ownerId = await getCurrentPondOwnerId();
		const device = await prisma.energyDevice.findFirst({
			where: { id: deviceId, pond: { ownerId } },
			select: { id: true, gramsPerFeeding: true },
		});

		if (!device) {
			return { success: false, error: "Device not found" };
		}

		const gramsCheck = feedGramsSchema.safeParse(grams);
		if (!gramsCheck.success) {
			return { success: false, error: formatZodError(gramsCheck.error) };
		}

		const previousGrams = device.gramsPerFeeding;
		const currentValid = Number.isFinite(previousGrams) && previousGrams > 0;
		const deviation = currentValid ? Math.abs(grams - previousGrams) / previousGrams : 0;

		if (currentValid && deviation > PREDICTION_DEVIATION_THRESHOLD) {
			return {
				success: false,
				error: `Prediction deviates ${(deviation * 100).toFixed(0)}% from the current ${previousGrams}g — above the ${PREDICTION_DEVIATION_THRESHOLD * 100}% safety threshold. Adjust the schedule manually if you're sure.`,
				previousGrams,
			};
		}

		await prisma.$transaction([
			prisma.energyDevice.update({
				where: { id: device.id },
				data: { gramsPerFeeding: grams },
			}),
			prisma.deviceStateEvent.create({
				data: {
					deviceId: device.id,
					eventType: "prediction_applied",
					source: "user",
					actorId: ownerId,
					metadata: {
						gramsApplied: grams,
						gramsPrevious: previousGrams,
						deviationPct: deviation,
					},
				},
			}),
		]);

		console.log(
			`[prediction] gramsPerFeeding: ${previousGrams}g → ${grams}g (applied by ${ownerId})`,
		);

		revalidatePath("/dashboard/growth");
		return { success: true, previousGrams, newGrams: grams };
	} catch (error) {
		console.error("[prediction] applyPredictedGrams failed:", error);
		return { success: false, error: "Failed to apply prediction. Try again." };
	}
}
