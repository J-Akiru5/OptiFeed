"use server";

import { getCurrentPondOwnerId } from "@/lib/auth/session";
import prisma from "@/lib/prisma";
import type { InputJsonValue } from "@prisma/client/runtime/library";
import { revalidatePath } from "next/cache";
import { updateScheduleCommand } from "./schedule";

export interface NotificationPrefs {
	missedFeeding: boolean;
	deviceOffline: boolean;
	hopperLow: boolean;
}

export async function updateNotificationPrefs(
	pondId: string,
	prefs: NotificationPrefs,
): Promise<{ success: boolean; error?: string }> {
	try {
		const ownerId = await getCurrentPondOwnerId();
		const pond = await prisma.pond.findFirst({
			where: { id: pondId, ownerId },
			select: { id: true },
		});

		if (!pond) {
			return { success: false, error: "Pond not found" };
		}

		await prisma.pond.update({
			where: { id: pondId },
			data: { notificationPrefs: prefs as unknown as InputJsonValue },
		});

		revalidatePath("/[locale]/(dashboard)/dashboard/settings/profile", "page");
		return { success: true };
	} catch (error) {
		console.error("Failed to update notification prefs:", error);
		return { success: false, error: "Failed to update notification preferences" };
	}
}

export async function updatePondSettings(
	pondId: string,
	feedingRatePct: number,
	feedsPerDay: number,
	sampleIntervalDays?: number,
) {
	try {
		const ownerId = await getCurrentPondOwnerId();
		const pond = await prisma.pond.findFirst({
			where: { id: pondId, ownerId },
		});

		if (!pond) {
			return { success: false, error: "Pond not found" };
		}

		const energyDevice = await prisma.energyDevice.findFirst({
			where: { pondId },
			select: { id: true },
		});

		const pondUpdateData: {
			feedingRatePct: number;
			feedsPerDay: number;
			sampleIntervalDays?: number;
		} = {
			feedingRatePct,
			feedsPerDay,
		};
		if (sampleIntervalDays !== undefined && sampleIntervalDays > 0) {
			pondUpdateData.sampleIntervalDays = sampleIntervalDays;
		}

		if (energyDevice) {
			const fmt = (d: Date) =>
				`${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;

			await updateScheduleCommand(pondId, energyDevice.id, {
				scheduleStart: fmt(pond.scheduleStart),
				scheduleEnd: fmt(pond.scheduleEnd),
				feedsPerDay,
				feedingRatePct,
			});

			await prisma.deviceStateEvent.create({
				data: {
					deviceId: energyDevice.id,
					eventType: "settings_changed",
					source: "user",
					actorId: ownerId,
					metadata: {
						feedingRatePct,
						feedsPerDay,
						sampleIntervalDays: pondUpdateData.sampleIntervalDays,
					},
				},
			});

			await prisma.pond.update({
				where: { id: pondId },
				data: pondUpdateData,
			});

			revalidatePath("/[locale]/(dashboard)", "layout");
			return { success: true };
		}

		await prisma.pond.update({
			where: { id: pondId },
			data: pondUpdateData,
		});

		revalidatePath("/[locale]/(dashboard)", "layout");
		return { success: true };
	} catch (error) {
		console.error("Failed to update pond settings:", error);
		return { success: false, error: "Failed to update pond settings" };
	}
}
