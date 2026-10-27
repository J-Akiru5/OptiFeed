"use server";

import { requirePermission } from "@/lib/auth/permissions";
import { getCurrentPondOwnerId, requireWriteAccess } from "@/lib/auth/session";
import { STALE_SENT_MS } from "@/lib/constants";
import { syncDeviceGramsForPond } from "@/lib/feed-grams";
import { setSchedulePause } from "@/lib/feed/commands";
import { dailyFeedCapG, formatZodError, scheduleInputSchema } from "@/lib/limits";
import prisma from "@/lib/prisma";
import { getFeedingLimits } from "@/lib/settings/feeding-caps";
import { revalidatePath } from "next/cache";

export async function toggleDevicePause(deviceId: string, isPaused: boolean) {
	// Guard outside try: the catch below rethrows a generic message and would
	// hide the write-access reason from the caller.
	await requireWriteAccess();
	await requirePermission("control_feeder");
	try {
		const ownerId = await getCurrentPondOwnerId();

		// Same pause implementation as superadmin remote control (plan M5.2).
		const outcome = await setSchedulePause(prisma, {
			deviceId,
			isPaused,
			actorId: ownerId,
			farmId: ownerId,
		});
		if (!outcome.ok) {
			throw new Error(outcome.code === "pond_fallow" ? "POND_FALLOW" : outcome.error);
		}

		revalidatePath("/[locale]/(dashboard)/dashboard/schedule", "page");
	} catch (error) {
		if (error instanceof Error && error.message === "POND_FALLOW") {
			throw new Error(
				"This pond is fallow after harvest. Start the next grow-out cycle before resuming feeding.",
			);
		}
		console.error("Failed to toggle device pause:", error);
		throw new Error("Failed to toggle device pause");
	}
}

export interface UpdateScheduleResult {
	success: boolean;
	commandId?: string;
	error?: string;
}

// STALE_SENT_MS (lib/constants.ts): 10 minutes — the device should ack
// within the dispense window; past this, something went wrong.

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
	// Guard outside try: the catch below returns a generic message and would
	// hide the write-access reason from the caller (matches toggleDevicePause).
	await requireWriteAccess();
	await requirePermission("manage_schedule");
	try {
		const parsed = scheduleInputSchema.safeParse(data);
		if (!parsed.success) {
			return { success: false, error: formatZodError(parsed.error) };
		}
		const input = parsed.data;

		const ownerId = await getCurrentPondOwnerId();

		const device = await prisma.energyDevice.findFirst({
			where: { id: deviceId, pondId, pond: { ownerId } },
			include: { pond: { select: { isFallow: true } } },
		});
		if (!device) return { success: false, error: "Device not found or access denied" };
		if (device.pond?.isFallow) {
			return {
				success: false,
				error:
					"This pond is fallow after harvest. Start the next grow-out cycle before changing the feeding schedule.",
			};
		}

		const limits = await getFeedingLimits();
		const dailyCapG = dailyFeedCapG(device.hopperCapacityG, limits.dailyCapFactor);
		const scheduledDailyG = input.feedsPerDay * device.gramsPerFeeding;
		if (scheduledDailyG > dailyCapG) {
			return {
				success: false,
				error: `Schedule would dispense ${Math.round(scheduledDailyG)} g/day — over the ${Math.round(dailyCapG)} g/day limit. Lower feeds per day or the feed amount.`,
			};
		}

		if (
			device.gramsPerSecond > 0 &&
			device.gramsPerFeeding / device.gramsPerSecond > limits.maxDispenseMs / 1000
		) {
			return {
				success: false,
				error: `Feed amount of ${device.gramsPerFeeding} g would take more than ${limits.maxDispenseMs / 1000} s of relay time at ${device.gramsPerSecond} g/s.`,
			};
		}

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

		const [startHours, startMinutes] = input.scheduleStart.split(":").map(Number);
		const [endHours, endMinutes] = input.scheduleEnd.split(":").map(Number);

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
				feedsPerDay: input.feedsPerDay,
				feedingRatePct: input.feedingRatePct,
				buttonFeedGrams: input.buttonFeedGrams ?? 80,
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
					scheduleStart: input.scheduleStart,
					scheduleEnd: input.scheduleEnd,
					feedsPerDay: input.feedsPerDay,
					feedingRatePct: input.feedingRatePct,
				},
			},
		});

		// Keep the device's dispensed grams in sync with the new rate/feeds config.
		await syncDeviceGramsForPond(pondId, {
			feedsPerDay: input.feedsPerDay,
			feedingRatePct: input.feedingRatePct,
		});

		revalidatePath("/[locale]/(dashboard)/dashboard/schedule", "page");
		return { success: true, commandId: command.id };
	} catch (error) {
		console.error("Failed to create schedule command:", error);
		return { success: false, error: "Failed to create schedule command" };
	}
}
