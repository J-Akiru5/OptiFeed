"use server";

import { requirePermission } from "@/lib/auth/permissions";
import { getCurrentPondOwnerId, requireWriteAccess } from "@/lib/auth/session";
import { STALE_DISPATCHED_MS } from "@/lib/constants";
import {
	MAX_DISPENSE_MS,
	OFFLINE_THRESHOLD_MS,
	dailyFeedCapG,
	feedGramsSchema,
	formatZodError,
} from "@/lib/limits";
import prisma from "@/lib/prisma";
import { revalidatePath } from "next/cache";

// STALE_DISPATCHED_MS (lib/constants.ts): 10 minutes.
// Calculated from default gramsPerSecond = 4.0:
//   500g feed dispenses in ~125s + 5s queue flush = ~130s total.
//   10min gives 4.6x margin even for hypothetical 1000g feed (255s).
//   Recalibrate if gramsPerSecond changes or max dose changes.

function manilaDayRange(nowMs: number = Date.now()): { start: Date; end: Date } {
	const HOUR_MS = 60 * 60 * 1000;
	const DAY_MS = 24 * HOUR_MS;
	const startOfLocalDay = Math.floor((nowMs + 8 * HOUR_MS) / DAY_MS) * DAY_MS - 8 * HOUR_MS;
	return { start: new Date(startOfLocalDay), end: new Date(startOfLocalDay + DAY_MS) };
}

export async function requestFeed(deviceId: string, grams?: number) {
	// Guard outside try: the catch below returns a generic message and would
	// hide the write-access reason from the caller (matches toggleDevicePause).
	await requireWriteAccess();
	await requirePermission("control_feeder");
	try {
		const ownerId = await getCurrentPondOwnerId();
		const device = await prisma.energyDevice.findFirst({
			where: { id: deviceId, pond: { ownerId } },
			select: {
				gramsPerFeeding: true,
				gramsPerSecond: true,
				lastSeenAt: true,
				hopperCapacityG: true,
			},
		});

		if (!device) {
			return { success: false, error: "Device not found" };
		}

		// Expire stale dispatched requests that were picked up by the device
		// but never confirmed. This prevents zombie requests from accumulating
		// on dead devices and lets future retries succeed.
		await prisma.feedRequest.updateMany({
			where: {
				deviceId,
				status: "dispatched",
				updatedAt: { lt: new Date(Date.now() - STALE_DISPATCHED_MS) },
			},
			data: { status: "expired" },
		});

		// N10: reject while the device is offline — it cannot pick the request
		// up, so queueing it would silently strand the dose.
		if (!device.lastSeenAt || Date.now() - device.lastSeenAt.getTime() > OFFLINE_THRESHOLD_MS) {
			return {
				success: false,
				error: "Device is offline — feed request rejected. Retry once the device reconnects.",
			};
		}

		const feedGrams = grams ?? device.gramsPerFeeding;
		const gramsCheck = feedGramsSchema.safeParse(feedGrams);
		if (!gramsCheck.success) {
			return { success: false, error: formatZodError(gramsCheck.error) };
		}

		if (device.gramsPerSecond > 0 && feedGrams / device.gramsPerSecond > MAX_DISPENSE_MS / 1000) {
			return {
				success: false,
				error: `Dose would need more than ${MAX_DISPENSE_MS / 1000} s of relay time at ${device.gramsPerSecond} g/s — reduce the feed amount.`,
			};
		}

		const existing = await prisma.feedRequest.findFirst({
			where: { deviceId, status: "pending" },
		});

		if (existing) {
			return { success: true, message: "Feed already pending" };
		}

		const dispatched = await prisma.feedRequest.findFirst({
			where: { deviceId, status: "dispatched" },
		});

		if (dispatched) {
			return {
				success: false,
				error: "A feed is already in progress — wait for it to finish before requesting another.",
			};
		}

		const day = manilaDayRange();
		const today = await prisma.feedRequest.aggregate({
			where: {
				deviceId,
				status: { in: ["pending", "dispatched", "completed"] },
				createdAt: { gte: day.start, lt: day.end },
			},
			_sum: { grams: true },
		});
		const usedTodayG = today._sum.grams ?? 0;
		const dailyCapG = dailyFeedCapG(device.hopperCapacityG);
		if (usedTodayG + feedGrams > dailyCapG) {
			return {
				success: false,
				error: `Daily feed limit reached — ${Math.round(dailyCapG)} g/day cap with ${Math.round(usedTodayG)} g already used today. Try again after midnight (Asia/Manila).`,
			};
		}

		await prisma.feedRequest.create({
			data: {
				deviceId,
				grams: feedGrams,
				status: "pending",
			},
		});

		await prisma.deviceStateEvent.create({
			data: {
				deviceId,
				eventType: "manual_trigger",
				source: "user",
				actorId: ownerId,
				metadata: { grams: feedGrams, triggerSource: "energy_actions" },
			},
		});

		revalidatePath("/[locale]/(dashboard)/dashboard", "page");
		revalidatePath("/[locale]/(dashboard)/dashboard/schedule", "page");
		return { success: true };
	} catch (error) {
		console.error("Failed to create feed request:", error);
		return { success: false, error: "Failed to create feed request" };
	}
}

export async function saveHopperCalibration(
	deviceId: string,
	data: { hopperFullCm: number; hopperEmptyCm: number; hopperCapacityG: number },
) {
	try {
		await requireWriteAccess();
		await requirePermission("manage_schedule");
		const ownerId = await getCurrentPondOwnerId();
		const device = await prisma.energyDevice.findFirst({
			where: { id: deviceId, pond: { ownerId } },
			select: { id: true },
		});

		if (!device) {
			return { success: false, error: "Device not found" };
		}

		await prisma.energyDevice.update({
			where: { id: deviceId },
			data: {
				hopperFullCm: data.hopperFullCm,
				hopperEmptyCm: data.hopperEmptyCm,
				hopperCapacityG: data.hopperCapacityG,
			},
		});

		await prisma.deviceStateEvent.create({
			data: {
				deviceId,
				eventType: "hopper_calibrated",
				source: "user",
				actorId: ownerId,
				metadata: {
					hopperFullCm: data.hopperFullCm,
					hopperEmptyCm: data.hopperEmptyCm,
					hopperCapacityG: data.hopperCapacityG,
				},
			},
		});

		revalidatePath("/[locale]/(dashboard)/dashboard/app-settings", "page");
		return { success: true };
	} catch (error) {
		console.error("Failed to save hopper calibration:", error);
		return { success: false, error: "Failed to save hopper calibration" };
	}
}

export async function saveDurationCalibration(deviceId: string, gramsPerSecond: number) {
	try {
		await requireWriteAccess();
		await requirePermission("manage_schedule");
		const ownerId = await getCurrentPondOwnerId();
		const device = await prisma.energyDevice.findFirst({
			where: { id: deviceId, pond: { ownerId } },
			select: { id: true },
		});

		if (!device) {
			return { success: false, error: "Device not found" };
		}

		if (!Number.isFinite(gramsPerSecond) || gramsPerSecond <= 0 || gramsPerSecond > 100) {
			return { success: false, error: "Grams per second must be between 0 and 100" };
		}

		await prisma.energyDevice.update({
			where: { id: deviceId },
			data: { gramsPerSecond },
		});

		await prisma.deviceStateEvent.create({
			data: {
				deviceId,
				eventType: "duration_calibrated",
				source: "user",
				actorId: ownerId,
				metadata: { gramsPerSecond },
			},
		});

		revalidatePath("/[locale]/(dashboard)/dashboard/settings/hardware", "page");
		return { success: true };
	} catch (error) {
		console.error("Failed to save duration calibration:", error);
		return { success: false, error: "Failed to save duration calibration" };
	}
}

export async function saveTemperatureCalibration(deviceId: string, tempOffsetC: number) {
	try {
		await requireWriteAccess();
		await requirePermission("manage_schedule");
		const ownerId = await getCurrentPondOwnerId();
		const device = await prisma.energyDevice.findFirst({
			where: { id: deviceId, pond: { ownerId } },
			select: { id: true },
		});

		if (!device) {
			return { success: false, error: "Device not found" };
		}

		if (!Number.isFinite(tempOffsetC) || tempOffsetC < -20 || tempOffsetC > 20) {
			return { success: false, error: "Temperature offset must be between -20 and 20 °C" };
		}

		await prisma.energyDevice.update({
			where: { id: deviceId },
			data: { tempOffsetC },
		});

		await prisma.deviceStateEvent.create({
			data: {
				deviceId,
				eventType: "temperature_calibrated",
				source: "user",
				actorId: ownerId,
				metadata: { tempOffsetC },
			},
		});

		revalidatePath("/[locale]/(dashboard)/dashboard/settings/hardware", "page");
		return { success: true };
	} catch (error) {
		console.error("Failed to save temperature calibration:", error);
		return { success: false, error: "Failed to save temperature calibration" };
	}
}
