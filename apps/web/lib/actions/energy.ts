"use server";

import { requirePermission } from "@/lib/auth/permissions";
import { getCurrentPondOwnerId, requireWriteAccess } from "@/lib/auth/session";
import { createManualFeedRequest } from "@/lib/feed/commands";
import {
	GRAMS_PER_SECOND_MAX,
	GRAMS_PER_SECOND_MIN,
	formatZodError,
	hopperCalibrationSchema,
} from "@/lib/limits";
import prisma from "@/lib/prisma";
import { revalidatePath } from "next/cache";

// The caps and the full command sequence live in lib/feed/commands.ts, shared
// with superadmin remote control (plan M5.2). STALE_DISPATCHED_MS there is 10
// minutes: a 500 g feed dispenses in ~125 s at the default 4.0 g/s, so the
// window leaves a 4.6x margin even for a hypothetical 1,000 g dose.

export async function requestFeed(deviceId: string, grams?: number) {
	// Guard outside try: the catch below returns a generic message and would
	// hide the write-access reason from the caller (matches toggleDevicePause).
	await requireWriteAccess();
	await requirePermission("control_feeder");
	try {
		const ownerId = await getCurrentPondOwnerId();
		const outcome = await createManualFeedRequest(prisma, {
			deviceId,
			grams,
			farmId: ownerId,
			actorId: ownerId,
			triggerSource: "energy_actions",
		});

		if (!outcome.ok) {
			return { success: false, error: outcome.error };
		}
		if (outcome.alreadyPending) {
			return { success: true, message: "Feed already pending" };
		}

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

		// A server action is a public entry point: the form bounds are not a
		// guard. A zero capacity silently raises the daily feed cap to the hard
		// maximum, and NaN or an inverted full/empty pair makes every feed-level
		// percentage meaningless on the device.
		const parsed = hopperCalibrationSchema.safeParse(data);
		if (!parsed.success) {
			return { success: false, error: formatZodError(parsed.error) };
		}

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
				hopperFullCm: parsed.data.hopperFullCm,
				hopperEmptyCm: parsed.data.hopperEmptyCm,
				hopperCapacityG: parsed.data.hopperCapacityG,
			},
		});

		await prisma.deviceStateEvent.create({
			data: {
				deviceId,
				eventType: "hopper_calibrated",
				source: "user",
				actorId: ownerId,
				metadata: {
					hopperFullCm: parsed.data.hopperFullCm,
					hopperEmptyCm: parsed.data.hopperEmptyCm,
					hopperCapacityG: parsed.data.hopperCapacityG,
				},
			},
		});

		revalidatePath("/[locale]/(dashboard)/dashboard/settings/hardware", "page");
		revalidatePath("/[locale]/(dashboard)/dashboard", "page");
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

		if (
			!Number.isFinite(gramsPerSecond) ||
			gramsPerSecond < GRAMS_PER_SECOND_MIN ||
			gramsPerSecond > GRAMS_PER_SECOND_MAX
		) {
			return {
				success: false,
				error: `Grams per second must be between ${GRAMS_PER_SECOND_MIN} and ${GRAMS_PER_SECOND_MAX}`,
			};
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
