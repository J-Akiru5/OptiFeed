"use server";

import prisma from "@/lib/prisma";
import { revalidatePath } from "next/cache";

export async function toggleDevicePause(deviceId: string, isPaused: boolean) {
	await prisma.device.update({
		where: { id: deviceId },
		data: { isPaused },
	});

	revalidatePath("/[locale]/(dashboard)/dashboard/schedule", "page");
}

export async function triggerManualFeed(deviceId: string) {
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

export interface UpdateScheduleResult {
	success: boolean;
	commandId?: string;
	error?: string;
}

// Stale sent threshold: 10 minutes (matches energy.ts STALE_DISPATCHED_MS).
// The device should ack within the dispense window; past this, something went wrong.
const STALE_SENT_MS = 10 * 60 * 1000;

export async function updateScheduleCommand(
	pondId: string,
	deviceId: string,
	data: {
		scheduleStart: string; // "HH:MM" 24h
		scheduleEnd: string; // "HH:MM" 24h
		feedsPerDay: number;
		feedingRatePct: number;
		buttonFeedGrams?: number;
	},
): Promise<UpdateScheduleResult> {
	try {
		// Expire stale sent commands that were picked up by the device
		// but never acked. Prevents zombie commands from blocking future edits.
		await prisma.scheduleCommand.updateMany({
			where: {
				deviceId,
				status: "sent",
				updatedAt: { lt: new Date(Date.now() - STALE_SENT_MS) },
			},
			data: { status: "failed" },
		});

		const [startHours, startMinutes] = data.scheduleStart.split(":").map(Number);
		const [endHours, endMinutes] = data.scheduleEnd.split(":").map(Number);

		const scheduleStart = new Date();
		scheduleStart.setUTCHours(startHours, startMinutes, 0, 0);
		const scheduleEnd = new Date();
		scheduleEnd.setUTCHours(endHours, endMinutes, 0, 0);

		const command = await prisma.scheduleCommand.create({
			data: {
				deviceId,
				pondId,
				scheduleStart,
				scheduleEnd,
				feedsPerDay: data.feedsPerDay,
				feedingRatePct: data.feedingRatePct,
				buttonFeedGrams: data.buttonFeedGrams ?? 80,
				status: "pending",
				createdBy: "demo-farmer-1",
			},
		});

		await prisma.deviceStateEvent.create({
			data: {
				deviceId,
				eventType: "schedule_changed",
				source: "user",
				actorId: "demo-farmer-1",
				metadata: {
					commandId: command.id,
					scheduleStart: data.scheduleStart,
					scheduleEnd: data.scheduleEnd,
					feedsPerDay: data.feedsPerDay,
					feedingRatePct: data.feedingRatePct,
				},
			},
		});

		revalidatePath("/[locale]/(dashboard)/dashboard/schedule", "page");
		return { success: true, commandId: command.id };
	} catch (error) {
		console.error("Failed to create schedule command:", error);
		return { success: false, error: "Failed to create schedule command" };
	}
}
