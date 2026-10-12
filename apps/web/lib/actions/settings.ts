"use server";

import { getCurrentPondOwnerId } from "@/lib/auth/session";
import { syncDeviceGramsForPond } from "@/lib/feed-grams";
import { formatZodError, notificationPrefsSchema, pondSettingsSchema } from "@/lib/limits";
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
		const parsed = notificationPrefsSchema.safeParse(prefs);
		if (!parsed.success) {
			return { success: false, error: formatZodError(parsed.error) };
		}

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
			data: { notificationPrefs: parsed.data as unknown as InputJsonValue },
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
	population?: number | null,
) {
	try {
		const parsed = pondSettingsSchema.safeParse({ feedingRatePct, feedsPerDay, population });
		if (!parsed.success) {
			return { success: false, error: formatZodError(parsed.error) };
		}
		const input = parsed.data;

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
			population?: number | null;
		} = {
			feedingRatePct: input.feedingRatePct,
			feedsPerDay: input.feedsPerDay,
		};
		if (sampleIntervalDays !== undefined && sampleIntervalDays > 0) {
			pondUpdateData.sampleIntervalDays = sampleIntervalDays;
		}
		if (population !== undefined) {
			pondUpdateData.population = input.population ?? null;
		}

		if (energyDevice) {
			const fmt = (d: Date) =>
				`${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;

			const commandResult = await updateScheduleCommand(pondId, energyDevice.id, {
				scheduleStart: fmt(pond.scheduleStart),
				scheduleEnd: fmt(pond.scheduleEnd),
				feedsPerDay: input.feedsPerDay,
				feedingRatePct: input.feedingRatePct,
			});
			if (!commandResult.success) {
				return commandResult;
			}

			await prisma.deviceStateEvent.create({
				data: {
					deviceId: energyDevice.id,
					eventType: "settings_changed",
					source: "user",
					actorId: ownerId,
					metadata: {
						feedingRatePct: input.feedingRatePct,
						feedsPerDay: input.feedsPerDay,
						sampleIntervalDays: pondUpdateData.sampleIntervalDays,
						population: pondUpdateData.population,
					},
				},
			});

			await prisma.pond.update({
				where: { id: pondId },
				data: pondUpdateData,
			});

			// Keep the device's dispensed grams in sync with the new config/biomass.
			await syncDeviceGramsForPond(pondId, {
				feedingRatePct: input.feedingRatePct,
				feedsPerDay: input.feedsPerDay,
				population: pondUpdateData.population,
			});

			revalidatePath("/[locale]/(dashboard)", "layout");
			return { success: true };
		}

		await prisma.pond.update({
			where: { id: pondId },
			data: pondUpdateData,
		});

		await syncDeviceGramsForPond(pondId, {
			feedingRatePct: input.feedingRatePct,
			feedsPerDay: input.feedsPerDay,
			population: pondUpdateData.population,
		});

		revalidatePath("/[locale]/(dashboard)", "layout");
		return { success: true };
	} catch (error) {
		console.error("Failed to update pond settings:", error);
		return { success: false, error: "Failed to update pond settings" };
	}
}
