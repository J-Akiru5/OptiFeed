"use server";

import { requirePermission } from "@/lib/auth/permissions";
import { getCurrentPondOwnerId, requireWriteAccess } from "@/lib/auth/session";
import {
	dateOnlyToUtcDate,
	dateRangeUtc,
	daysBetween,
	todayDateOnly,
} from "@/lib/crop-cycle/dates";
import { computeFinalFcr } from "@/lib/crop-cycle/metrics";
import {
	type CancelCycleInput,
	type CropCycleInput,
	type HarvestInput,
	cancelCycleSchema,
	cropCycleInputSchema,
	harvestInputSchema,
} from "@/lib/crop-cycle/schema";
import {
	type GrowthTargetResolution,
	cycleTargetConflict,
	isCycleTargetWeightInRange,
	roundTargetWeightG,
} from "@/lib/growth-target";
import { formatZodError } from "@/lib/limits";
import {
	type PondGrowthTarget,
	mergePondGrowthTarget,
	parsePondGrowthTarget,
} from "@/lib/pond-profile";
import prisma from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";

export type CropCycleActionResult =
	| { success: true; cycleId: string }
	| { success: false; error: string };

export interface UpdateCropCycleOptions {
	/**
	 * Set only when the caller has been told a saved calculator target exists
	 * and chose what to do with it (D-2). Omitting it while the target changed
	 * is refused rather than silently picking a side.
	 */
	growthTargetResolution?: GrowthTargetResolution;
}

const CYCLE_EXISTS = "This pond already has an active grow-out cycle. Harvest or cancel it first.";
const GROWTH_TARGET_CONFLICT =
	"A saved calculator target exists for this cycle. Choose whether to replace it or keep it.";
const SAVED_TARGET_OUT_OF_RANGE =
	"The saved calculator target is outside the range the cycle target can store. Replace it with a new cycle value or remove the target.";
const TARGET_OUT_OF_RANGE = "Target weight is outside the range the cycle target can store.";

function revalidateCropPaths(): void {
	revalidatePath("/[locale]/(dashboard)/dashboard/calendar", "page");
	revalidatePath("/[locale]/(dashboard)/dashboard", "page");
	revalidatePath("/[locale]/(dashboard)/dashboard/growth", "page");
}

function isUniqueConstraintError(error: unknown): boolean {
	return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

function safeMessage(error: unknown, fallback: string): string {
	if (error instanceof Error) {
		if (error.message === "CYCLE_EXISTS") return CYCLE_EXISTS;
		if (error.message === "POND_NOT_FOUND") return "Pond not found.";
		if (error.message === "CYCLE_NOT_FOUND") return "Grow-out cycle not found.";
		if (error.message === "CYCLE_NOT_ACTIVE") return "Only an active cycle can be changed.";
		if (error.message === "GROWTH_TARGET_CONFLICT") return GROWTH_TARGET_CONFLICT;
		if (error.message === "SAVED_TARGET_OUT_OF_RANGE") return SAVED_TARGET_OUT_OF_RANGE;
		if (error.message === "TARGET_OUT_OF_RANGE") return TARGET_OUT_OF_RANGE;
		if (error.message === "Harvest date cannot be before the stocking date.") {
			return error.message;
		}
	}
	if (isUniqueConstraintError(error)) return CYCLE_EXISTS;
	return fallback;
}

function eventTitle(kind: "stocking" | "harvest", label: string | null): string {
	const suffix = label ? ` — ${label}` : "";
	return kind === "stocking" ? `Stocking${suffix}` : `Harvest planned${suffix}`;
}

export async function createCropCycle(input: CropCycleInput): Promise<CropCycleActionResult> {
	try {
		await requireWriteAccess();
		await requirePermission("manage_crop_cycle");
	} catch {
		return {
			success: false,
			error: "You do not have permission to manage grow-out cycles.",
		};
	}

	const parsed = cropCycleInputSchema.safeParse(input);
	if (!parsed.success) return { success: false, error: formatZodError(parsed.error) };
	const data = parsed.data;
	const ownerId = await getCurrentPondOwnerId();
	const growOutDays = daysBetween(data.stockingDate, data.targetHarvestDate);

	try {
		const cycle = await prisma.$transaction(async (tx) => {
			const pond = await tx.pond.findFirst({
				where: { id: data.pondId, ownerId },
				select: { id: true, name: true, farmId: true },
			});
			if (!pond) throw new Error("POND_NOT_FOUND");

			const existing = await tx.cropCycle.findFirst({
				where: { pondId: pond.id, status: "ACTIVE" },
				select: { id: true },
			});
			if (existing) throw new Error("CYCLE_EXISTS");

			const created = await tx.cropCycle.create({
				data: {
					pondId: pond.id,
					farmId: pond.farmId,
					label: data.label ?? null,
					status: "ACTIVE",
					stockingDate: dateOnlyToUtcDate(data.stockingDate),
					stockingCount: data.stockingCount,
					stockingAvgWeightG: data.stockingAvgWeightG ?? null,
					growOutDays,
					targetHarvestDate: dateOnlyToUtcDate(data.targetHarvestDate),
					targetHarvestWeightG: data.targetHarvestWeightG ?? null,
					expectedSurvivalPct: data.expectedSurvivalPct ?? null,
					notes: data.notes ?? null,
					createdBy: ownerId,
				},
			});

			await tx.pondEvent.createMany({
				data: [
					{
						pondId: pond.id,
						cropCycleId: created.id,
						farmId: pond.farmId,
						type: "STOCKING",
						status: "DONE",
						title: eventTitle("stocking", data.label ?? null),
						startsAt: dateOnlyToUtcDate(data.stockingDate),
						allDay: true,
						source: "cycle",
						createdBy: ownerId,
						completedBy: ownerId,
						completedAt: new Date(),
					},
					{
						pondId: pond.id,
						cropCycleId: created.id,
						farmId: pond.farmId,
						type: "HARVEST_PLANNED",
						status: "PLANNED",
						title: eventTitle("harvest", data.label ?? null),
						startsAt: dateOnlyToUtcDate(data.targetHarvestDate),
						allDay: true,
						source: "cycle",
						createdBy: ownerId,
					},
				],
			});

			await tx.pond.update({
				where: { id: pond.id },
				data: { population: data.stockingCount, isFallow: false },
			});

			return created;
		});

		revalidateCropPaths();
		return { success: true, cycleId: cycle.id };
	} catch (error) {
		console.error("[crop-cycle] createCropCycle failed:", error);
		return { success: false, error: safeMessage(error, "Could not start the grow-out cycle.") };
	}
}

export async function updateCropCycle(
	cycleId: string,
	input: CropCycleInput,
	options: UpdateCropCycleOptions = {},
): Promise<CropCycleActionResult> {
	try {
		await requireWriteAccess();
		await requirePermission("manage_crop_cycle");
	} catch {
		return { success: false, error: "You do not have permission to manage grow-out cycles." };
	}

	if (!cycleId) return { success: false, error: "Grow-out cycle not found." };

	const parsed = cropCycleInputSchema.safeParse(input);
	if (!parsed.success) return { success: false, error: formatZodError(parsed.error) };
	const data = parsed.data;
	const ownerId = await getCurrentPondOwnerId();
	const growOutDays = daysBetween(data.stockingDate, data.targetHarvestDate);

	try {
		await prisma.$transaction(async (tx) => {
			const cycle = await tx.cropCycle.findFirst({
				where: { id: cycleId, pond: { ownerId } },
				include: {
					pond: {
						select: { id: true, name: true, farmId: true, notificationPrefs: true },
					},
				},
			});
			if (!cycle) throw new Error("CYCLE_NOT_FOUND");
			if (cycle.status !== "ACTIVE") throw new Error("CYCLE_NOT_ACTIVE");
			if (cycle.pondId !== data.pondId) throw new Error("CYCLE_NOT_FOUND");

			// D-2: a saved calculator target outranks the cycle target until the
			// caller explicitly chooses. `null` means the pond target was removed,
			// and `undefined` means the pond profile must not be written.
			const savedTarget = parsePondGrowthTarget(cycle.pond.notificationPrefs);
			const nextWeightG = data.targetHarvestWeightG ?? null;
			const conflict = savedTarget
				? cycleTargetConflict({
						savedWeightG: savedTarget.targetWeightG,
						cycleWeightG: cycle.targetHarvestWeightG,
						nextWeightG,
					})
				: null;

			let cycleTargetWeightG = nextWeightG;
			let targetToWrite: PondGrowthTarget | null | undefined;

			if (conflict) {
				if (options.growthTargetResolution === "replace") {
					if (nextWeightG === null) {
						// Replacing with an empty cycle target removes the saved
						// target too; the choice was explicit, not silent.
						cycleTargetWeightG = null;
						targetToWrite = null;
					} else {
						const weightG = roundTargetWeightG(nextWeightG);
						if (!isCycleTargetWeightInRange(weightG)) {
							throw new Error("TARGET_OUT_OF_RANGE");
						}
						cycleTargetWeightG = weightG;
						targetToWrite = {
							targetWeightG: weightG,
							population: data.stockingCount,
							cycleId: cycle.id,
							setAt: new Date().toISOString(),
						};
					}
				} else if (options.growthTargetResolution === "keep") {
					if (!isCycleTargetWeightInRange(conflict.savedWeightG)) {
						// Keeping an unmovable value would leave two numbers; refuse
						// and let the caller replace or remove it instead.
						throw new Error("SAVED_TARGET_OUT_OF_RANGE");
					}
					// Keep the calculator target authoritative and restore the
					// mirror, so every page still shows the same number.
					cycleTargetWeightG = conflict.savedWeightG;
				} else {
					throw new Error("GROWTH_TARGET_CONFLICT");
				}
			}

			await tx.cropCycle.update({
				where: { id: cycle.id },
				data: {
					label: data.label ?? null,
					stockingDate: dateOnlyToUtcDate(data.stockingDate),
					stockingCount: data.stockingCount,
					stockingAvgWeightG: data.stockingAvgWeightG ?? null,
					growOutDays,
					targetHarvestDate: dateOnlyToUtcDate(data.targetHarvestDate),
					targetHarvestWeightG: cycleTargetWeightG,
					expectedSurvivalPct: data.expectedSurvivalPct ?? null,
					notes: data.notes ?? null,
				},
			});

			if (targetToWrite !== undefined) {
				const pondUpdated = await tx.pond.updateMany({
					where: { id: cycle.pondId, ownerId },
					data: {
						notificationPrefs: mergePondGrowthTarget(
							cycle.pond.notificationPrefs,
							targetToWrite,
						) as unknown as Prisma.InputJsonValue,
					},
				});
				if (pondUpdated.count !== 1) throw new Error("POND_NOT_FOUND");
			}

			await tx.pond.update({
				where: { id: data.pondId },
				data: { population: data.stockingCount },
			});

			await tx.pondEvent.updateMany({
				where: { cropCycleId: cycle.id, type: "STOCKING" },
				data: {
					title: eventTitle("stocking", data.label ?? null),
					startsAt: dateOnlyToUtcDate(data.stockingDate),
				},
			});
			await tx.pondEvent.updateMany({
				where: { cropCycleId: cycle.id, type: "HARVEST_PLANNED" },
				data: {
					title: eventTitle("harvest", data.label ?? null),
					startsAt: dateOnlyToUtcDate(data.targetHarvestDate),
					status: "PLANNED",
				},
			});
		});

		revalidateCropPaths();
		return { success: true, cycleId };
	} catch (error) {
		console.error("[crop-cycle] updateCropCycle failed:", error);
		return { success: false, error: safeMessage(error, "Could not update the grow-out cycle.") };
	}
}

export async function markCycleHarvested(input: HarvestInput): Promise<CropCycleActionResult> {
	try {
		await requireWriteAccess();
		await requirePermission("manage_crop_cycle");
	} catch {
		return { success: false, error: "You do not have permission to record a harvest." };
	}

	const parsed = harvestInputSchema.safeParse(input);
	if (!parsed.success) return { success: false, error: formatZodError(parsed.error) };
	const data = parsed.data;
	const ownerId = await getCurrentPondOwnerId();

	try {
		const result = await prisma.$transaction(async (tx) => {
			const cycle = await tx.cropCycle.findFirst({
				where: { id: data.cycleId, pondId: data.pondId, pond: { ownerId } },
				include: { pond: { select: { id: true, name: true, farmId: true } } },
			});
			if (!cycle) throw new Error("CYCLE_NOT_FOUND");
			if (cycle.status !== "ACTIVE") throw new Error("CYCLE_NOT_ACTIVE");

			const stockingDate = cycle.stockingDate.toISOString().slice(0, 10);
			if (daysBetween(stockingDate, data.actualHarvestDate) < 0) {
				throw new Error("Harvest date cannot be before the stocking date.");
			}

			const devices = await tx.energyDevice.findMany({
				where: { pondId: cycle.pondId },
				select: { id: true },
			});
			const deviceIds = devices.map((device) => device.id);
			const range = dateRangeUtc(stockingDate, data.actualHarvestDate);
			const feed = deviceIds.length
				? await tx.feedEvent.aggregate({
						where: {
							deviceId: { in: deviceIds },
							eventType: "feed_dispensed",
							receivedAt: { gte: range.gte, lt: range.lte },
						},
						_sum: { grams: true },
					})
				: null;

			const totalFeedKg = (feed?._sum.grams ?? 0) / 1000;
			const finalFcr =
				data.actualFcr ??
				computeFinalFcr({
					totalFeedKg,
					harvestWeightKg: data.actualHarvestWeightKg,
					stockingCount: cycle.stockingCount,
					stockingAvgWeightG: cycle.stockingAvgWeightG,
				});

			const now = new Date();
			const harvestDate = dateOnlyToUtcDate(data.actualHarvestDate);

			await tx.cropCycle.update({
				where: { id: cycle.id },
				data: {
					status: "HARVESTED",
					actualHarvestDate: harvestDate,
					actualHarvestWeightKg: data.actualHarvestWeightKg,
					actualHarvestCount: data.actualHarvestCount,
					actualFcr: finalFcr,
					notes: data.notes ?? cycle.notes,
				},
			});

			await tx.pondEvent.updateMany({
				where: {
					cropCycleId: cycle.id,
					type: "HARVEST_PLANNED",
					status: "PLANNED",
				},
				data: { status: "DONE", completedAt: now, completedBy: ownerId },
			});
			await tx.pondEvent.create({
				data: {
					pondId: cycle.pondId,
					cropCycleId: cycle.id,
					farmId: cycle.pond.farmId,
					type: "HARVEST_ACTUAL",
					status: "DONE",
					title: `Harvest completed${cycle.label ? ` — ${cycle.label}` : ""}`,
					startsAt: harvestDate,
					allDay: true,
					notes: data.notes ?? null,
					source: "cycle",
					createdBy: ownerId,
					completedBy: ownerId,
					completedAt: now,
				},
			});

			await tx.pond.update({
				where: { id: cycle.pondId },
				data: { isFallow: true },
			});
			await tx.energyDevice.updateMany({
				where: { pondId: cycle.pondId },
				data: { isPaused: true },
			});
			await tx.notification.create({
				data: {
					pondId: cycle.pondId,
					tier: "INFO",
					category: "harvest",
					message: `Harvest recorded for ${cycle.pond.name}: ${data.actualHarvestWeightKg.toFixed(2)} kg. The feeder is paused until the next cycle.`,
					linkTo: "/dashboard/calendar",
				},
			});

			for (const device of devices) {
				await tx.deviceStateEvent.create({
					data: {
						deviceId: device.id,
						eventType: "harvest_recorded",
						source: "user",
						actorId: ownerId,
						metadata: {
							cycleId: cycle.id,
							actualHarvestDate: data.actualHarvestDate,
							actualHarvestWeightKg: data.actualHarvestWeightKg,
							actualHarvestCount: data.actualHarvestCount,
							actualFcr: finalFcr,
						},
					},
				});
			}

			return cycle.id;
		});

		revalidateCropPaths();
		return { success: true, cycleId: result };
	} catch (error) {
		console.error("[crop-cycle] markCycleHarvested failed:", error);
		return { success: false, error: safeMessage(error, "Could not record the harvest.") };
	}
}

export async function cancelCropCycle(input: CancelCycleInput): Promise<CropCycleActionResult> {
	try {
		await requireWriteAccess();
		await requirePermission("manage_crop_cycle");
	} catch {
		return { success: false, error: "You do not have permission to cancel a cycle." };
	}

	const parsed = cancelCycleSchema.safeParse(input);
	if (!parsed.success) return { success: false, error: formatZodError(parsed.error) };
	const data = parsed.data;
	const ownerId = await getCurrentPondOwnerId();

	try {
		const result = await prisma.$transaction(async (tx) => {
			const cycle = await tx.cropCycle.findFirst({
				where: { id: data.cycleId, pondId: data.pondId, pond: { ownerId } },
				include: { pond: { select: { id: true, name: true, farmId: true } } },
			});
			if (!cycle) throw new Error("CYCLE_NOT_FOUND");
			if (cycle.status !== "ACTIVE") throw new Error("CYCLE_NOT_ACTIVE");

			const now = new Date();
			await tx.cropCycle.update({
				where: { id: cycle.id },
				data: { status: "CANCELLED" },
			});
			await tx.pondEvent.updateMany({
				where: { cropCycleId: cycle.id, status: "PLANNED" },
				data: { status: "CANCELLED" },
			});
			await tx.pondEvent.create({
				data: {
					pondId: cycle.pondId,
					cropCycleId: cycle.id,
					farmId: cycle.pond.farmId,
					type: "OTHER",
					status: "DONE",
					title: "Cycle cancelled",
					startsAt: dateOnlyToUtcDate(todayDateOnly()),
					allDay: true,
					notes: data.notes ?? null,
					source: "cycle",
					createdBy: ownerId,
					completedBy: ownerId,
					completedAt: now,
				},
			});
			await tx.pond.update({
				where: { id: cycle.pondId },
				data: { isFallow: true },
			});
			await tx.energyDevice.updateMany({
				where: { pondId: cycle.pondId },
				data: { isPaused: true },
			});
			await tx.notification.create({
				data: {
					pondId: cycle.pondId,
					tier: "WARNING",
					category: "harvest",
					message: `Grow-out cycle cancelled for ${cycle.pond.name}. The feeder is paused.`,
					linkTo: "/dashboard/calendar",
				},
			});

			return cycle.id;
		});

		revalidateCropPaths();
		return { success: true, cycleId: result };
	} catch (error) {
		console.error("[crop-cycle] cancelCropCycle failed:", error);
		return { success: false, error: safeMessage(error, "Could not cancel the cycle.") };
	}
}

/**
 * Convenience alias for the post-harvest CTA. Starting the next cycle is the
 * same operation as starting the first one, including permission, ownership and
 * one-active-cycle checks.
 */
export async function startNextCycle(input: CropCycleInput): Promise<CropCycleActionResult> {
	return createCropCycle(input);
}
