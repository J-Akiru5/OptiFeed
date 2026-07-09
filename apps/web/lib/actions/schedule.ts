"use server";

import prisma from "@/lib/prisma";
import { revalidatePath } from "next/cache";

export async function toggleDevicePause(deviceId: string, isPaused: boolean) {
	await prisma.device.update({
		where: { id: deviceId },
		data: { isPaused },
	});

	// Revalidate the schedule page so the new state reflects
	revalidatePath("/[locale]/(dashboard)/dashboard/schedule", "page");
}

export async function triggerManualFeed(deviceId: string) {
	// In a real hardware integration, this would send an MQTT message or HTTP request
	// to the physical feeder device. For our dashboard, we will just record
	// that a manual feeding event was triggered.

	// Assuming a default manual feed amount of 500g for the demo
	const MANUAL_FEED_AMOUNT_G = 500;

	await prisma.feedingEvent.create({
		data: {
			deviceId,
			scheduledTime: new Date(),
			dispensedVolumeG: MANUAL_FEED_AMOUNT_G,
			status: "completed",
		},
	});

	revalidatePath("/[locale]/(dashboard)/dashboard/schedule", "page");
	revalidatePath("/[locale]/(dashboard)/dashboard/history", "page");
}
