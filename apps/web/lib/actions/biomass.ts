"use server";

import { getCurrentPondOwnerId, requireWriteAccess } from "@/lib/auth/session";
import { dateOnlyToUtcDate, isValidDateOnly } from "@/lib/crop-cycle/dates";
import { isDeviceUnreachable } from "@/lib/device-status";
import { applyGrowthPlanForPond } from "@/lib/growth-plan-apply";
import {
	biomassLogSchema,
	feedGramsSchema,
	fishSamplesSchema,
	formatZodError,
	resolveDailyCapG,
} from "@/lib/limits";
import prisma from "@/lib/prisma";
import { getDeviceStatusPolicy } from "@/lib/settings/device-status";
import { getFeedingLimits } from "@/lib/settings/feeding-caps";
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
	| "skipped_no_population"
	| "skipped_target_plan";

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
	const clientEventIdRaw = formData.get("clientEventId");
	const clientEventId =
		typeof clientEventIdRaw === "string" && /^offline-[A-Za-z0-9-]{8,80}$/.test(clientEventIdRaw)
			? clientEventIdRaw
			: null;
	const recordedAtRaw = formData.get("recordedAt");
	const recordedAt =
		typeof recordedAtRaw === "string" && recordedAtRaw.trim() !== ""
			? new Date(recordedAtRaw)
			: null;
	const safeRecordedAt =
		recordedAt instanceof Date &&
		Number.isFinite(recordedAt.getTime()) &&
		recordedAt.getTime() <= Date.now() + 5 * 60_000
			? recordedAt
			: null;

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

	let txResult: FeedCalculationResult;
	try {
		txResult = await prisma.$transaction(async (tx) => {
			const pond = await tx.pond.findUnique({
				where: { id: pondId },
				select: { ownerId: true, feedingRatePct: true, feedsPerDay: true, population: true },
			});

			if (!pond || pond.ownerId !== ownerId) {
				throw new Error("Pond not found");
			}

			const log = await tx.biomassLog.create({
				data: {
					...(clientEventId ? { id: clientEventId } : {}),
					...(safeRecordedAt ? { recordedAt: safeRecordedAt } : {}),
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
				? isDeviceUnreachable(energyDevice.lastSeenAt, new Date(), await getDeviceStatusPolicy())
				: false;
			const population = pond.population ?? 0;

			// A target-weight cycle owns the feeding adjustment. The generic
			// biomass formula must not also move the device, or a single sample
			// could apply two changes inside the 15-day safety window.
			const activeTargetCycle = await tx.cropCycle.findFirst({
				where: { pondId, status: "ACTIVE", targetHarvestWeightG: { not: null } },
				select: { id: true },
			});

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

			if (activeTargetCycle) {
				return finish("skipped_target_plan", null, previousGrams);
			}

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

			if (newGrams === null) {
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
							reason: "population or average weight invalid",
						},
					},
				});
				return finish("skipped_config", null, previousGrams);
			}

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

			// The daily ceiling is the only gram cap. feedGramsSchema is just the
			// 5,000 g sanity bound, so a within-schema dose still has to fit the
			// pond's daily allowance before it may move the device.
			const feedingLimits = await getFeedingLimits();
			const dailyCapG = resolveDailyCapG({
				configuredCapG: energyDevice.dailyCapG,
				hopperCapacityG: energyDevice.hopperCapacityG,
				dailyCapFactor: feedingLimits.dailyCapFactor,
			});
			const scheduledDailyG = newGrams * pond.feedsPerDay;
			if (scheduledDailyG > dailyCapG + 0.05) {
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
							reason: "recommendation would exceed the daily feed ceiling",
							gramsProposed: newGrams,
							gramsCurrent: energyDevice.gramsPerFeeding,
							scheduledDailyG,
							dailyCapG,
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
	} catch (error) {
		if (
			clientEventId &&
			typeof error === "object" &&
			error !== null &&
			(error as { code?: string }).code === "P2002"
		) {
			return {
				success: true,
				feed: {
					calculatedGrams: null,
					effectiveGrams: null,
					previousGrams: null,
					dailyFeedG: null,
					feedsPerDay: 0,
					feedingRatePct: 0,
					population: 0,
					status: "unchanged",
					deviceOffline: false,
					batchLabel: null,
				},
			};
		}
		throw error;
	}

	revalidatePath("/[locale]/dashboard", "layout");

	let feedResult = txResult;
	if (txResult.status === "skipped_target_plan") {
		const planResult = await applyGrowthPlanForPond({
			pondId,
			ownerId,
			actorId: ownerId,
			note: "Applied automatically after a biomass sample.",
			initializeIfFirst: true,
		});
		if (planResult.success) {
			feedResult = {
				...txResult,
				status: "updated",
				calculatedGrams: planResult.newGrams ?? null,
				effectiveGrams: planResult.newGrams ?? null,
				previousGrams: planResult.previousGrams ?? null,
				dailyFeedG:
					planResult.newGrams !== undefined && txResult.feedsPerDay > 0
						? Math.round(planResult.newGrams * txResult.feedsPerDay * 100) / 100
						: null,
			};
		} else {
			feedResult = {
				...txResult,
				calculatedGrams: null,
				effectiveGrams: txResult.previousGrams,
			};
		}
	}

	return { success: true, feed: feedResult };
}

export type BiomassLogActionResult = { success: true } | { success: false; error: string };

/**
 * Edit an existing sample. The aggregate fields are recalculated; individual
 * fish rows are left untouched because the original sample detail is still
 * useful history. The next target-plan calculation uses the edited aggregate.
 */
export async function updateBiomassLog(input: {
	id: string;
	sampleCount: number;
	sampleWeightKg: number;
	sampleLengthCm: number;
	batchLabel: string | null;
	recordedAt?: string;
}): Promise<BiomassLogActionResult> {
	try {
		await requireWriteAccess();
		const ownerId = await getCurrentPondOwnerId();
		const parsed = biomassLogSchema.safeParse({
			sampleCount: input.sampleCount,
			sampleWeightKg: input.sampleWeightKg,
			sampleLengthCm: input.sampleLengthCm,
			batchLabel: input.batchLabel,
		});
		if (!parsed.success) return { success: false, error: formatZodError(parsed.error) };
		if (input.recordedAt !== undefined && !isValidDateOnly(input.recordedAt)) {
			return { success: false, error: "Use a valid sample date (YYYY-MM-DD)." };
		}

		const log = await prisma.biomassLog.findFirst({
			where: { id: input.id, pond: { ownerId } },
			select: { id: true, pondId: true },
		});
		if (!log) return { success: false, error: "Sample not found." };

		const avgWeightKg = parsed.data.sampleWeightKg / parsed.data.sampleCount;
		await prisma.$transaction(async (tx) => {
			await tx.biomassLog.update({
				where: { id: log.id },
				data: {
					sampleCount: parsed.data.sampleCount,
					sampleWeightKg: parsed.data.sampleWeightKg,
					sampleLengthCm: parsed.data.sampleLengthCm,
					avgWeightKg,
					batchLabel: parsed.data.batchLabel ?? null,
					...(input.recordedAt ? { recordedAt: dateOnlyToUtcDate(input.recordedAt) } : {}),
				},
			});

			const device = await tx.energyDevice.findFirst({
				where: { pondId: log.pondId },
				select: { id: true },
			});
			if (device) {
				await tx.deviceStateEvent.create({
					data: {
						deviceId: device.id,
						eventType: "biomass_log_edited",
						source: "user",
						actorId: ownerId,
						metadata: {
							biomassLogId: log.id,
							sampleCount: parsed.data.sampleCount,
							sampleWeightKg: parsed.data.sampleWeightKg,
							avgWeightKg,
						},
					},
				});
			}
		});

		revalidatePath("/[locale]/dashboard", "layout");
		return { success: true };
	} catch (error) {
		console.error("[biomass] update failed:", error);
		return { success: false, error: "Could not update the sample." };
	}
}

export async function deleteBiomassLog(id: string): Promise<BiomassLogActionResult> {
	try {
		await requireWriteAccess();
		const ownerId = await getCurrentPondOwnerId();
		const log = await prisma.biomassLog.findFirst({
			where: { id, pond: { ownerId } },
			select: { id: true, pondId: true },
		});
		if (!log) return { success: false, error: "Sample not found." };

		await prisma.$transaction(async (tx) => {
			const device = await tx.energyDevice.findFirst({
				where: { pondId: log.pondId },
				select: { id: true },
			});
			await tx.biomassLog.delete({ where: { id: log.id } });
			if (device) {
				await tx.deviceStateEvent.create({
					data: {
						deviceId: device.id,
						eventType: "biomass_log_deleted",
						source: "user",
						actorId: ownerId,
						metadata: { biomassLogId: log.id },
					},
				});
			}
		});

		revalidatePath("/[locale]/dashboard", "layout");
		return { success: true };
	} catch (error) {
		console.error("[biomass] delete failed:", error);
		return { success: false, error: "Could not delete the sample." };
	}
}
