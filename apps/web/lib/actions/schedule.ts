"use server";

import { getCurrentPondOwnerId } from "@/lib/auth/session";
import prisma from "@/lib/prisma";
import { revalidatePath } from "next/cache";

export async function toggleDevicePause(deviceId: string, isPaused: boolean) {
	try {
		const ownerId = await getCurrentPondOwnerId();

		const device = await prisma.energyDevice.findFirst({
			where: { id: deviceId, pond: { ownerId } },
		});
		if (!device) throw new Error("Device not found or access denied");

		await prisma.energyDevice.update({
			where: { id: deviceId },
			data: { isPaused },
		});

		await prisma.deviceStateEvent.create({
			data: {
				deviceId,
				eventType: "pause_toggled",
				source: "user",
				actorId: ownerId,
				metadata: { isPaused },
			},
		});

		revalidatePath("/[locale]/(dashboard)/dashboard/schedule", "page");
	} catch (error) {
		console.error("Failed to toggle device pause:", error);
		throw new Error("Failed to toggle device pause");
	}
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
		const ownerId = await getCurrentPondOwnerId();

		const device = await prisma.energyDevice.findFirst({
			where: { id: deviceId, pondId, pond: { ownerId } },
		});
		if (!device) return { success: false, error: "Device not found or access denied" };

		// Expire stale sent commands that were picked up by the device
		// but never acked. Prevents zombie commands from blocking future edits.
		const staleCommands = await prisma.scheduleCommand.findMany({
			where: {
				deviceId,
				status: "sent",
				updatedAt: { lt: new Date(Date.now() - STALE_SENT_MS) },
			},
		});

		for (const cmd of staleCommands) {
			await prisma.scheduleCommand.update({
				where: { id: cmd.id },
				data: { status: "failed" },
			});

			await prisma.deviceStateEvent.create({
				data: {
					deviceId,
					eventType: "command_failed",
					source: "system",
					metadata: {
						commandId: cmd.id,
						scheduleStart: `${String(cmd.scheduleStart.getUTCHours()).padStart(2, "0")}:${String(cmd.scheduleStart.getUTCMinutes()).padStart(2, "0")}`,
						scheduleEnd: `${String(cmd.scheduleEnd.getUTCHours()).padStart(2, "0")}:${String(cmd.scheduleEnd.getUTCMinutes()).padStart(2, "0")}`,
					},
				},
			});
		}

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
				createdBy: ownerId,
			},
		});

		await prisma.deviceStateEvent.create({
			data: {
				deviceId,
				eventType: "schedule_changed",
				source: "user",
				actorId: ownerId,
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
