"use server";

import { getCurrentPondOwnerId, requireWriteAccess } from "@/lib/auth/session";
import { feedGramsSchema, formatZodError } from "@/lib/limits";
import { getActivePond } from "@/lib/pond-selection";
import {
	PREDICTION_DEVIATION_THRESHOLD,
	type PredictionConfidence,
	predictionUpperBound,
} from "@/lib/prediction";
import prisma from "@/lib/prisma";
import { resolveCurrentSchedule } from "@/lib/schedule/resolve-current";
import { revalidatePath } from "next/cache";

export interface ApplyPredictionContext {
	source?: "ai" | "deterministic";
	confidence?: PredictionConfidence;
	baselineGrams?: number | null;
}

export interface ApplyPredictionResult {
	success: boolean;
	error?: string;
	previousGrams?: number;
	newGrams?: number;
	appliedAt?: string;
}

const CONFIDENCES: PredictionConfidence[] = ["low", "medium", "high"];

function sanitiseContext(context?: ApplyPredictionContext) {
	const source =
		context?.source === "ai" || context?.source === "deterministic" ? context.source : undefined;
	const confidence =
		context?.confidence && CONFIDENCES.includes(context.confidence)
			? context.confidence
			: undefined;
	const baselineGrams =
		typeof context?.baselineGrams === "number" &&
		Number.isFinite(context.baselineGrams) &&
		context.baselineGrams > 0
			? Math.round(Math.min(context.baselineGrams, 1_000) * 10) / 10
			: undefined;

	return { source, confidence, baselineGrams };
}

/**
 * Applies an AI/deterministic feeding prediction to the device's scheduled
 * grams per feeding. The value flows to the firmware via the existing
 * /api/schedule-sync poll — no command queue needed (grams is a config field).
 *
 * Safety layers (defence in depth — the client is never trusted):
 *  1. ADMIN/OPERATOR write access.
 *  2. The device must belong to the currently selected pond and the caller.
 *  3. feedGramsSchema range (1–1000 g).
 *  4. Device daily cap: per-meal grams cannot exceed dailyCap ÷ feedsPerDay.
 *  5. ±50% deviation veto against the value on the device.
 *  6. Compare-and-swap update so a concurrent schedule change cannot be
 *     overwritten by a stale prediction.
 */
export async function applyPredictedGrams(
	deviceId: string,
	grams: number,
	context?: ApplyPredictionContext,
): Promise<ApplyPredictionResult> {
	try {
		await requireWriteAccess();
		const ownerId = await getCurrentPondOwnerId();
		const activePond = await getActivePond();

		if (!activePond) {
			return { success: false, error: "No active pond." };
		}

		const device = await prisma.energyDevice.findFirst({
			where: {
				id: deviceId,
				pondId: activePond.id,
				pond: { ownerId },
			},
			select: {
				id: true,
				pondId: true,
				gramsPerFeeding: true,
				hopperCapacityG: true,
				dailyCapG: true,
			},
		});

		if (!device || !device.pondId) {
			return { success: false, error: "Device not found for the active pond." };
		}

		// Round before validating so a client cannot smuggle sub-gram precision
		// past the deviation check.
		const safeGrams = Math.round(grams * 10) / 10;
		const gramsCheck = feedGramsSchema.safeParse(safeGrams);
		if (!gramsCheck.success) {
			return { success: false, error: formatZodError(gramsCheck.error) };
		}

		const currentConfig = await resolveCurrentSchedule(device.pondId, device.id);
		const upperBound = predictionUpperBound(
			currentConfig?.feedsPerDay ?? 0,
			device.hopperCapacityG,
			device.dailyCapG,
		);
		if (safeGrams > upperBound + 0.05) {
			return {
				success: false,
				error: `That amount exceeds this device's safe per-meal limit of ${upperBound.toFixed(1)} g.`,
			};
		}

		const previousGrams = device.gramsPerFeeding;
		const currentValid = Number.isFinite(previousGrams) && previousGrams > 0;
		const deviation = currentValid ? Math.abs(safeGrams - previousGrams) / previousGrams : 0;

		if (currentValid && deviation > PREDICTION_DEVIATION_THRESHOLD + 1e-9) {
			return {
				success: false,
				error: `Prediction deviates ${(deviation * 100).toFixed(0)}% from the current ${previousGrams}g — above the ${PREDICTION_DEVIATION_THRESHOLD * 100}% safety threshold. Adjust the schedule manually if you're sure.`,
				previousGrams,
			};
		}

		const audit = sanitiseContext(context);

		const updated = await prisma.$transaction(async (tx) => {
			const result = await tx.energyDevice.updateMany({
				where: { id: device.id, gramsPerFeeding: previousGrams },
				data: { gramsPerFeeding: safeGrams },
			});
			if (result.count !== 1) return false;

			await tx.deviceStateEvent.create({
				data: {
					deviceId: device.id,
					eventType: "prediction_applied",
					source: "user",
					actorId: ownerId,
					metadata: {
						gramsApplied: safeGrams,
						gramsPrevious: previousGrams,
						deviationPct: deviation,
						predictionSource: audit.source ?? null,
						predictionConfidence: audit.confidence ?? null,
						predictionBaselineGrams: audit.baselineGrams ?? null,
					},
				},
			});

			return true;
		});

		if (!updated) {
			return {
				success: false,
				error: "The schedule changed while you were reviewing. Refresh and try again.",
			};
		}

		console.log(
			`[prediction] gramsPerFeeding: ${previousGrams}g → ${safeGrams}g (applied by ${ownerId}, source ${audit.source ?? "unknown"})`,
		);

		revalidatePath("/[locale]/(dashboard)/dashboard/growth", "page");
		revalidatePath("/[locale]/(dashboard)/dashboard", "page");
		return {
			success: true,
			previousGrams,
			newGrams: safeGrams,
			appliedAt: new Date().toISOString(),
		};
	} catch (error) {
		console.error("[prediction] applyPredictedGrams failed:", error);
		return { success: false, error: "Failed to apply prediction. Try again." };
	}
}
