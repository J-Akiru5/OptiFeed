"use server";

import { getCurrentPondOwnerId, requireWriteAccess } from "@/lib/auth/session";
import { computePondFeedAmount, syncDeviceGramsForPond } from "@/lib/feed-grams";
import { checkScheduleCaps } from "@/lib/feed/commands";
import {
	MAX_FEED_GRAMS_PER_REQUEST,
	formatZodError,
	notificationPrefsSchema,
	pondSettingsSchema,
} from "@/lib/limits";
import { type PondProfileInput, mergePondProfile, pondProfileSchema } from "@/lib/pond-profile";
import prisma from "@/lib/prisma";
import { getFeedingLimits } from "@/lib/settings/feeding-caps";
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
			select: { id: true, gramsPerFeeding: true, gramsPerSecond: true, hopperCapacityG: true },
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

			// Check the caps against the state this save will produce. The schedule
			// action re-checks against the stored pond row, which still holds the
			// old population at this point, so a population change submitted with a
			// rate change would otherwise be validated against the wrong fish count
			// (audit 2026-10-28).
			const feedAmount = await computePondFeedAmount(pondId, {
				feedsPerDay: input.feedsPerDay,
				feedingRatePct: input.feedingRatePct,
				population: pondUpdateData.population,
			});
			if (feedAmount?.reason === "over_device_limit") {
				return {
					success: false,
					error: `That feeding rate needs more than the ${MAX_FEED_GRAMS_PER_REQUEST} g per-meal limit. Lower the rate or add meals.`,
				};
			}
			const feedingLimits = await getFeedingLimits();
			const capsCheck = checkScheduleCaps({
				gramsPerMeal: feedAmount?.grams ?? energyDevice.gramsPerFeeding,
				feedsPerDay: input.feedsPerDay,
				hopperCapacityG: energyDevice.hopperCapacityG,
				gramsPerSecond: energyDevice.gramsPerSecond,
				maxDispenseMs: feedingLimits.maxDispenseMs,
				dailyCapFactor: feedingLimits.dailyCapFactor,
			});
			if (!capsCheck.ok) {
				return { success: false, error: capsCheck.error };
			}

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
