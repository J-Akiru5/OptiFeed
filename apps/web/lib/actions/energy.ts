"use server";

import { randomUUID } from "node:crypto";
import { getCurrentPondOwnerId, getCurrentPondOwnerIdSafe } from "@/lib/auth/session";
import prisma from "@/lib/prisma";
import { revalidatePath } from "next/cache";

// Stale dispatched threshold: 10 minutes.
// Calculated from default gramsPerSecond = 4.0:
//   500g feed dispenses in ~125s + 5s queue flush = ~130s total.
//   10min gives 4.6x margin even for hypothetical 1000g feed (255s).
//   Recalibrate if gramsPerSecond changes or max dose changes.
const STALE_DISPATCHED_MS = 10 * 60 * 1000;

export async function requestFeed(deviceId: string, grams?: number) {
	try {
		const ownerId = await getCurrentPondOwnerId();
		const device = await prisma.energyDevice.findFirst({
			where: { id: deviceId, pond: { ownerId } },
			select: { gramsPerFeeding: true },
		});

		if (!device) {
			return { success: false, error: "Device not found" };
		}

		const feedGrams = grams ?? device.gramsPerFeeding;

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

		const existing = await prisma.feedRequest.findFirst({
			where: { deviceId, status: "pending" },
		});

		if (existing) {
			return { success: true, message: "Feed already pending" };
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

export async function registerEnergyDevice(
	mac: string,
	label: string,
	pondId?: string,
): Promise<string> {
	const ownerId = await getCurrentPondOwnerIdSafe();

	if (pondId && ownerId) {
		const pond = await prisma.pond.findFirst({
			where: { id: pondId, ownerId },
			select: { id: true },
		});
		if (!pond) throw new Error("Pond not found");
	}

	const token = `esp32-tok-${randomUUID()}`;
	const device = await prisma.energyDevice.create({
		data: {
			mac,
			token,
			label,
			pondId: pondId ?? null,
		},
	});

	await prisma.deviceStateEvent.create({
		data: {
			deviceId: device.id,
			eventType: "device_registered",
			source: "user",
			actorId: ownerId,
			metadata: { mac },
		},
	});

	return token;
}
