"use server";

import { getCurrentPondOwnerId, requireWriteAccess } from "@/lib/auth/session";
import { OFFLINE_THRESHOLD_MS } from "@/lib/constants";
import { biomassLogSchema, feedGramsSchema, fishSamplesSchema, formatZodError } from "@/lib/limits";
import prisma from "@/lib/prisma";
import { calculateNextFeeding } from "@/lib/volumeCalc";
import { revalidatePath } from "next/cache";

const DEVIATION_THRESHOLD = 0.5; // 50% — reject if new value differs this much from current

interface FishSampleInput {
	weightGrams: number;
	lengthCm: number;
}

export type FeedScheduleStatus =
	| "updated"
	| "unchanged"
	| "rejected_deviation"
	| "rejected_out_of_range"
	| "skipped_config"
	| "skipped_no_device"
	| "skipped_no_population";

export interface FeedCalculationResult {
	/** Recommendation computed from this sample (null when not computable). */
	calculatedGrams: number | null;
	/** What the device will actually dispense per feeding after this save. */
	effectiveGrams: number | null;
	/** Scheduled amount before this save (null when no device is linked). */
	previousGrams: number | null;
	/** calculatedGrams × feedsPerDay (null when not computable). */
	dailyFeedG: number | null;
	feedsPerDay: number;
	feedingRatePct: number;
	population: number;
	status: FeedScheduleStatus;
	deviceOffline: boolean;
	batchLabel: string | null;
}

export type SaveBiomassResult =
	| { success: true; feed: FeedCalculationResult }
	| { success: false; error: string };

export async function saveBiomassLog(formData: FormData): Promise<SaveBiomassResult> {
	await requireWriteAccess();
	const ownerId = await getCurrentPondOwnerId();
	const pondId = formData.get("pondId") as string;
	const sampleWeightKg = Number.parseFloat(formData.get("sampleWeightKg") as string);
	const sampleLengthCm = Number.parseFloat(formData.get("sampleLengthCm") as string);
	const sampleCount = Number.parseInt(formData.get("sampleCount") as string, 10);
	const batchLabelRaw = formData.get("batchLabel");
	const batchLabel =
		typeof batchLabelRaw === "string" && batchLabelRaw.trim() !== "" ? batchLabelRaw.trim() : null;

	const fishSamplesJson = formData.get("fishSamples") as string | null;
	let fishSamples: FishSampleInput[] = [];
	if (fishSamplesJson) {
		try {
			const parsedRows: unknown = JSON.parse(fishSamplesJson);
			if (!Array.isArray(parsedRows)) {
				return { success: false, error: "Individual measurements could not be read." };
			}
			const rows = fishSamplesSchema.safeParse(parsedRows);
			if (!rows.success) {
				const issue = rows.error.issues[0];
				const rowIndex = issue.path[0];
				return {
					success: false,
					error: `Fish #${Number(rowIndex) + 1}: ${issue.message}`,
				};
			}
			fishSamples = rows.data;
		} catch {
			return {
				success: false,
				error: "Individual measurements could not be read — please re-enter them.",
			};
		}
	}

	if (!pondId) {
		return { success: false, error: "Missing pond" };
	}

	const parsed = biomassLogSchema.safeParse({
		sampleCount,
		sampleWeightKg,
		sampleLengthCm,
		batchLabel,
	});
	if (!parsed.success) {
		return { success: false, error: formatZodError(parsed.error) };
	}

	const avgWeightKg = sampleWeightKg / sampleCount;

	const txResult = await prisma.$transaction(async (tx) => {
		const pond = await tx.pond.findUnique({
			where: { id: pondId },
			select: { ownerId: true, feedingRatePct: true, feedsPerDay: true, population: true },
		});

		if (!pond || pond.ownerId !== ownerId) {
			throw new Error("Pond not found");
		}

		const log = await tx.biomassLog.create({
			data: {
				pondId,
				sampleWeightKg,
				sampleLengthCm,
				sampleCount,
				avgWeightKg,
				batchLabel,
				source: "form",
			},
		});

		if (fishSamples.length > 0) {
			await tx.fishSample.createMany({
				data: fishSamples.map((fs) => ({
					biomassLogId: log.id,
					weightGrams: fs.weightGrams,
					lengthCm: fs.lengthCm,
				})),
			});
		}

		const energyDevice = await tx.energyDevice.findFirst({
			where: { pondId },
		});
		const previousGrams = energyDevice?.gramsPerFeeding ?? null;
		const deviceOffline = energyDevice
			? Date.now() - (energyDevice.lastSeenAt?.getTime() ?? 0) > OFFLINE_THRESHOLD_MS
			: false;
		const population = pond.population ?? 0;

		const finish = (
			status: FeedScheduleStatus,
			calculatedGrams: number | null,
			effectiveGrams: number | null,
		): FeedCalculationResult => ({
			calculatedGrams,
			effectiveGrams,
			previousGrams,
			dailyFeedG:
				calculatedGrams !== null && pond.feedsPerDay > 0
					? Math.round(calculatedGrams * pond.feedsPerDay * 100) / 100
					: null,
			feedsPerDay: pond.feedsPerDay,
			feedingRatePct: pond.feedingRatePct,
			population,
			status,
			deviceOffline,
			batchLabel,
		});

		if (pond.feedingRatePct <= 0 || pond.feedsPerDay <= 0) {
			console.log(
				`[biomass] skipped device update: pond config incomplete (feedingRatePct=${pond?.feedingRatePct}, feedsPerDay=${pond?.feedsPerDay})`,
			);
			return finish("skipped_config", null, previousGrams);
		}

		if (!energyDevice) {
			console.log("[biomass] skipped device update: no linked EnergyDevice");
			return finish("skipped_no_device", null, null);
		}

		if (!pond.population || pond.population <= 0) {
			await tx.deviceStateEvent.create({
				data: {
					deviceId: energyDevice.id,
					eventType: "biomass_logged",
					source: "user",
					actorId: ownerId,
					metadata: {
						biomassLogId: log.id,
						avgWeightKg,
						sampleCount,
						autoAdjustSkipped: true,
						reason: "population not set — cannot compute biomass without a fish count",
					},
				},
			});
			return finish("skipped_no_population", null, previousGrams);
		}

		const newGrams = calculateNextFeeding(
			avgWeightKg,
			pond.feedingRatePct,
			pond.feedsPerDay,
			pond.population,
		);

		const newGramsCheck = feedGramsSchema.safeParse(newGrams);
		if (!newGramsCheck.success) {
			await tx.deviceStateEvent.create({
				data: {
					deviceId: energyDevice.id,
					eventType: "biomass_logged",
					source: "user",
					actorId: ownerId,
					metadata: {
						biomassLogId: log.id,
						avgWeightKg,
						sampleCount,
						autoAdjustRejected: true,
						reason: formatZodError(newGramsCheck.error),
						gramsProposed: newGrams,
						gramsCurrent: energyDevice.gramsPerFeeding,
					},
				},
			});
			return finish("rejected_out_of_range", newGrams, previousGrams);
		}

		const currentGrams = energyDevice.gramsPerFeeding;
		const currentValid = Number.isFinite(currentGrams) && currentGrams > 0;
		const deviation = currentValid ? Math.abs(newGrams - currentGrams) / currentGrams : 0;

		if (currentValid && deviation > DEVIATION_THRESHOLD) {
			console.warn(
				`[biomass] rejected auto-adjust: ${currentGrams}g → ${newGrams}g (${(deviation * 100).toFixed(1)}% deviation, threshold ${DEVIATION_THRESHOLD * 100}%) — biomassLogId=${log.id}`,
			);

			await tx.deviceStateEvent.create({
				data: {
					deviceId: energyDevice.id,
					eventType: "biomass_logged",
					source: "user",
					actorId: ownerId,
					metadata: {
						biomassLogId: log.id,
						avgWeightKg,
						sampleCount,
						autoAdjustRejected: true,
						deviationPct: deviation,
						gramsProposed: newGrams,
						gramsCurrent: currentGrams,
					},
				},
			});

			return finish("rejected_deviation", newGrams, previousGrams);
		}

		const status: FeedScheduleStatus =
			currentValid && newGrams === currentGrams ? "unchanged" : "updated";

		await tx.energyDevice.update({
			where: { id: energyDevice.id },
			data: { gramsPerFeeding: newGrams },
		});

		console.log(
			`[biomass] gramsPerFeeding: ${currentGrams}g → ${newGrams}g (biomassLogId=${log.id})`,
		);

		await tx.deviceStateEvent.create({
			data: {
				deviceId: energyDevice.id,
				eventType: "biomass_logged",
				source: "user",
				actorId: ownerId,
				metadata: {
					biomassLogId: log.id,
					avgWeightKg,
					sampleCount,
					gramsAdjusted: newGrams,
					gramsPrevious: currentGrams,
				},
			},
		});

		return finish(status, newGrams, newGrams);
	});

	revalidatePath("/[locale]/dashboard", "layout");

	return { success: true, feed: txResult };
}
