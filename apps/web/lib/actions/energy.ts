"use server";

import { randomUUID } from "node:crypto";
import prisma from "@/lib/prisma";
import { revalidatePath } from "next/cache";

// Stale dispatched threshold: 10 minutes.
// Calculated from firmware GRAMS_PER_SECOND = 4.0:
//   500g feed dispenses in ~125s + 5s queue flush = ~130s total.
//   10min gives 4.6x margin even for hypothetical 1000g feed (255s).
//   Recalibrate if GRAMS_PER_SECOND changes or max dose changes.
const STALE_DISPATCHED_MS = 10 * 60 * 1000;

export async function requestFeed(deviceId: string, grams?: number) {
	try {
		const device = await prisma.energyDevice.findUnique({
			where: { id: deviceId },
			select: { gramsPerFeeding: true },
		});

		// Remote "Feed Now" carries the real scheduled dose (gramsPerFeeding),
		// not the button's fixed snack override — the farmer is remote because
		// he can't be at the pond, so this feed stands in for what he'd do
		// himself. Default to gramsPerFeeding (150g), not buttonFeedGrams (80g).
		const feedGrams = grams ?? device?.gramsPerFeeding ?? 150;

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
		await prisma.energyDevice.update({
			where: { id: deviceId },
			data: {
				hopperFullCm: data.hopperFullCm,
				hopperEmptyCm: data.hopperEmptyCm,
				hopperCapacityG: data.hopperCapacityG,
			},
		});
		revalidatePath("/[locale]/(dashboard)/dashboard/app-settings", "page");
		return { success: true };
	} catch (error) {
		console.error("Failed to save hopper calibration:", error);
		return { success: false, error: "Failed to save hopper calibration" };
	}
}

export async function registerEnergyDevice(
	mac: string,
	label: string,
	pondId?: string,
): Promise<string> {
	const token = `esp32-tok-${randomUUID()}`;
	await prisma.energyDevice.create({
		data: {
			mac,
			token,
			label,
			pondId: pondId ?? null,
		},
	});
	return token;
}
