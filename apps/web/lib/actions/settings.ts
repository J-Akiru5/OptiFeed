"use server";

import { getCurrentPondOwnerId, requireWriteAccess } from "@/lib/auth/session";
import { syncDeviceGramsForPond } from "@/lib/feed-grams";
import {
	dailyCapSchema,
	formatZodError,
	notificationPrefsSchema,
	pondSettingsSchema,
} from "@/lib/limits";
import { type PondProfileInput, mergePondProfile, pondProfileSchema } from "@/lib/pond-profile";
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
		await requireWriteAccess();
		const parsed = notificationPrefsSchema.safeParse(prefs);
		if (!parsed.success) {
			return { success: false, error: formatZodError(parsed.error) };
		}

		const ownerId = await getCurrentPondOwnerId();
		const pond = await prisma.pond.findFirst({
			where: { id: pondId, ownerId },
			select: { id: true, notificationPrefs: true },
		});

		if (!pond) {
			return { success: false, error: "Pond not found" };
		}

		// Keep the pond profile bridge intact when notification prefs are saved.
		const existing =
			pond.notificationPrefs &&
			typeof pond.notificationPrefs === "object" &&
			!Array.isArray(pond.notificationPrefs)
				? (pond.notificationPrefs as Record<string, unknown>)
				: {};
		const nextPrefs = {
			...parsed.data,
			...(existing.profile !== undefined ? { profile: existing.profile } : {}),
		};

		await prisma.pond.update({
			where: { id: pondId },
			data: { notificationPrefs: nextPrefs as unknown as InputJsonValue },
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
	profile?: PondProfileInput,
) {
	try {
		await requireWriteAccess();
		const parsed = pondSettingsSchema.safeParse({ feedingRatePct, feedsPerDay, population });
		if (!parsed.success) {
			return { success: false, error: formatZodError(parsed.error) };
		}
		const input = parsed.data;

		let parsedProfile: PondProfileInput | null = null;
		if (profile !== undefined) {
			const profileResult = pondProfileSchema.safeParse(profile);
			if (!profileResult.success) {
				return { success: false, error: formatZodError(profileResult.error) };
			}
			parsedProfile = profileResult.data;
		}

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
			notificationPrefs?: InputJsonValue;
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
		if (parsedProfile !== null) {
			pondUpdateData.notificationPrefs = mergePondProfile(
				pond.notificationPrefs,
				parsedProfile,
			) as unknown as InputJsonValue;
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
						profile: parsedProfile,
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

/**
 * Raise or lower the daily feed ceiling for one device.
 *
 * The pond owner (ADMIN/OPERATOR) may set anything inside the writable window;
 * the hard guard and the platform factor are applied by `resolveDailyCapG`
 * wherever the cap is enforced, so a stored value can never exceed them.
 */
export async function updateDeviceDailyCap(
	deviceId: string,
	dailyCapG: number,
): Promise<{ success: boolean; error?: string; dailyCapG?: number }> {
	try {
		await requireWriteAccess();
		const parsed = dailyCapSchema.safeParse(dailyCapG);
		if (!parsed.success) {
			return { success: false, error: formatZodError(parsed.error) };
		}

		const ownerId = await getCurrentPondOwnerId();
		const device = await prisma.energyDevice.findFirst({
			where: { id: deviceId, pond: { ownerId } },
			select: { id: true, dailyCapG: true },
		});
		if (!device) {
			return { success: false, error: "Device not found" };
		}

		await prisma.$transaction([
			prisma.energyDevice.update({
				where: { id: device.id },
				data: { dailyCapG: parsed.data },
			}),
			prisma.deviceStateEvent.create({
				data: {
					deviceId: device.id,
					eventType: "daily_cap_changed",
					source: "user",
					actorId: ownerId,
					metadata: {
						previousCapG: device.dailyCapG,
						dailyCapG: parsed.data,
					},
				},
			}),
		]);

		revalidatePath("/[locale]/(dashboard)", "layout");
		return { success: true, dailyCapG: parsed.data };
	} catch (error) {
		console.error("Failed to update daily feed ceiling:", error);
		return { success: false, error: "Failed to update the daily feed ceiling" };
	}
}
