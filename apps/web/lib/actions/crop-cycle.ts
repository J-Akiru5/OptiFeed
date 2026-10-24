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
import { formatZodError } from "@/lib/limits";
import prisma from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";

export type CropCycleActionResult =
	| { success: true; cycleId: string }
	| { success: false; error: string };

const CYCLE_EXISTS = "This pond already has an active grow-out cycle. Harvest or cancel it first.";

function revalidateCropPaths(): void {
	revalidatePath("/[locale]/(dashboard)/dashboard/harvest", "page");
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
				include: { pond: { select: { id: true, name: true, farmId: true } } },
			});
			if (!cycle) throw new Error("CYCLE_NOT_FOUND");
			if (cycle.status !== "ACTIVE") throw new Error("CYCLE_NOT_ACTIVE");
			if (cycle.pondId !== data.pondId) throw new Error("CYCLE_NOT_FOUND");

			await tx.cropCycle.update({
				where: { id: cycle.id },
				data: {
					label: data.label ?? null,
					stockingDate: dateOnlyToUtcDate(data.stockingDate),
					stockingCount: data.stockingCount,
					stockingAvgWeightG: data.stockingAvgWeightG ?? null,
					growOutDays,
					targetHarvestDate: dateOnlyToUtcDate(data.targetHarvestDate),
					targetHarvestWeightG: data.targetHarvestWeightG ?? null,
					expectedSurvivalPct: data.expectedSurvivalPct ?? null,
					notes: data.notes ?? null,
				},
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
					linkTo: "/dashboard/harvest",
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
					linkTo: "/dashboard/harvest",
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
