"use server";

import {
	type ActionDenialReason,
	actionDenialResult,
	rethrowIfNavigationError,
} from "@/lib/auth/action-denial";
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
import { getFeedingLimits } from "@/lib/settings/feeding-caps";
import {
	type PondDeviceConflict,
	type PondSettingsFieldError,
	buildPondDeviceConstraints,
	buildPondFeedPreview,
	detectPondDeviceConflicts,
	pondFieldError,
} from "@/lib/settings/pond-conflicts";
import type { PondSettingsField } from "@/lib/settings/pond-fields";
import type { InputJsonValue } from "@prisma/client/runtime/library";
import { revalidatePath } from "next/cache";
import type { ZodError } from "zod";
import { updateScheduleCommand } from "./schedule";

/**
 * The pond settings save result (#371).
 *
 * A failure is never a bare sentence any more: it carries the field-level
 * errors (so each input can explain itself), the device conflicts (so the form
 * can link to the exact setting and offer the pond value) and no writes. The
 * form keeps the reader's typed values either way; this shape is what makes
 * that possible to test.
 *
 * A guard refusal keeps its own reason (`code`, and the sentence for it) even
 * though the guard is inside the try (#336): an authorization failure must not
 * be reported as "Failed to update pond settings".
 */
export type PondSettingsActionResult =
	| { success: true }
	| {
			success: false;
			error: string;
			fieldErrors: PondSettingsFieldError[];
			conflicts: PondDeviceConflict[];
			code?: ActionDenialReason;
	  };

const POND_FIELD_CODES: Record<
	PondSettingsField,
	{ min: Parameters<typeof pondFieldError>[1]; max: Parameters<typeof pondFieldError>[1] }
> = {
	feedingRatePct: { min: "rate_min", max: "rate_max" },
	feedsPerDay: { min: "feeds_min", max: "feeds_max" },
	sampleIntervalDays: { min: "interval_min", max: "interval_max" },
	population: { min: "population_min", max: "population_max" },
	areaM2: { min: "area_invalid", max: "area_invalid" },
	averageDepthM: { min: "depth_invalid", max: "depth_invalid" },
	feedPricePerKg: { min: "price_invalid", max: "price_invalid" },
};

function zodFieldErrors(error: ZodError): PondSettingsFieldError[] {
	const fieldErrors: PondSettingsFieldError[] = [];
	for (const issue of error.issues) {
		const field = issue.path[0];
		if (typeof field !== "string" || !(field in POND_FIELD_CODES)) continue;
		const codes = POND_FIELD_CODES[field as PondSettingsField];
		const code =
			issue.code === "too_small" ? codes.min : issue.code === "too_big" ? codes.max : codes.min;
		fieldErrors.push(pondFieldError(field as PondSettingsField, code, issue.message));
	}
	return fieldErrors;
}

function conflictSentence(conflicts: PondDeviceConflict[]): string {
	const first = conflicts[0];
	if (!first) return "The pond settings conflict with the device limits.";
	if (first.code === "daily-ceiling") {
		return `The pond needs ${Math.round(first.pondValueG)} g/day, over the feeder's ${Math.round(first.deviceValueG)} g/day ceiling. Pond settings win; raise the device ceiling or link the setting.`;
	}
	if (first.code === "relay-time") {
		return `The pond needs ${Math.round(first.pondValueG)} g per meal, more than the ${Math.round(first.deviceValueG)} g the feeder can dispense in one relay window. Recalibrate the feeder or split the feed into more meals.`;
	}
	return `The pond needs ${Math.round(first.pondValueG)} g per meal, over the feeder's ${Math.round(first.deviceValueG)} g limit. Split the feed into more meals.`;
}

export interface NotificationPrefs {
	missedFeeding: boolean;
	deviceOffline: boolean;
	hopperLow: boolean;
}

export async function updateNotificationPrefs(
	pondId: string,
	prefs: NotificationPrefs,
): Promise<{ success: boolean; error?: string; code?: ActionDenialReason }> {
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
		rethrowIfNavigationError(error);
		const denied = actionDenialResult(error);
		if (denied) return denied;
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
): Promise<PondSettingsActionResult> {
	try {
		await requireWriteAccess();
		const parsed = pondSettingsSchema.safeParse({ feedingRatePct, feedsPerDay, population });
		if (!parsed.success) {
			return {
				success: false,
				error: formatZodError(parsed.error),
				fieldErrors: zodFieldErrors(parsed.error),
				conflicts: [],
			};
		}
		const input = parsed.data;

		let parsedProfile: PondProfileInput | null = null;
		if (profile !== undefined) {
			const profileResult = pondProfileSchema.safeParse(profile);
			if (!profileResult.success) {
				return {
					success: false,
					error: formatZodError(profileResult.error),
					fieldErrors: zodFieldErrors(profileResult.error),
					conflicts: [],
				};
			}
			parsedProfile = profileResult.data;
		}

		const ownerId = await getCurrentPondOwnerId();
		const pond = await prisma.pond.findFirst({
			where: { id: pondId, ownerId },
		});

		if (!pond) {
			return {
				success: false,
				error: "Pond not found",
				fieldErrors: [],
				conflicts: [],
			};
		}

		const energyDevice = await prisma.energyDevice.findFirst({
			where: { pondId },
			select: {
				id: true,
				dailyCapG: true,
				hopperCapacityG: true,
				gramsPerSecond: true,
			},
		});

		// The pond is the source of truth (#371): compute the grams these typed
		// values ask for, compare them with what the feeder can safely dispense,
		// and report every disagreement before a single write. A conflict is a
		// save failure with its own field/card, not a generic sentence.
		const effectivePopulation =
			population !== undefined ? (input.population ?? null) : pond.population;
		let conflicts: PondDeviceConflict[] = [];
		if (energyDevice) {
			const [latestBiomass, limits] = await Promise.all([
				prisma.biomassLog.findFirst({
					where: { pondId },
					orderBy: { recordedAt: "desc" },
					select: { avgWeightKg: true },
				}),
				getFeedingLimits(),
			]);
			const preview = buildPondFeedPreview({
				population: effectivePopulation,
				avgWeightKg: latestBiomass?.avgWeightKg ?? null,
				feedingRatePct: input.feedingRatePct,
				feedsPerDay: input.feedsPerDay,
			});
			const constraints = buildPondDeviceConstraints({
				deviceId: energyDevice.id,
				configuredDailyCapG: energyDevice.dailyCapG,
				hopperCapacityG: energyDevice.hopperCapacityG,
				gramsPerSecond: energyDevice.gramsPerSecond,
				maxDispenseMs: limits.maxDispenseMs,
				dailyCapFactor: limits.dailyCapFactor,
			});
			conflicts = detectPondDeviceConflicts(preview, constraints);
		}

		if (conflicts.length > 0) {
			return {
				success: false,
				error: conflictSentence(conflicts),
				fieldErrors: [],
				conflicts,
			};
		}

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

			// Derive the device's per-meal grams from the *typed* values before the
			// schedule command validates them. Otherwise the command checks a stale
			// dose from the previous biomass and can refuse a save that is actually
			// lighter, while accepting one the new settings make too heavy.
			await syncDeviceGramsForPond(pondId, {
				feedingRatePct: input.feedingRatePct,
				feedsPerDay: input.feedsPerDay,
				population: pondUpdateData.population,
			});

			const commandResult = await updateScheduleCommand(pondId, energyDevice.id, {
				scheduleStart: fmt(pond.scheduleStart),
				scheduleEnd: fmt(pond.scheduleEnd),
				feedsPerDay: input.feedsPerDay,
				feedingRatePct: input.feedingRatePct,
				// The pond row still holds the old fish count here, so the command
				// has to be told which count the dose is derived from (#430).
				population: pondUpdateData.population ?? undefined,
			});
			if (!commandResult.success) {
				return {
					success: false,
					error: commandResult.error ?? "Failed to update the feeding schedule",
					fieldErrors: [],
					conflicts: [],
				};
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
		rethrowIfNavigationError(error);
		const denied = actionDenialResult(error);
		if (denied) return { ...denied, fieldErrors: [], conflicts: [] };
		console.error("Failed to update pond settings:", error);
		return {
			success: false,
			error: "Failed to update pond settings",
			fieldErrors: [],
			conflicts: [],
		};
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
): Promise<{ success: boolean; error?: string; dailyCapG?: number; code?: ActionDenialReason }> {
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
		rethrowIfNavigationError(error);
		const denied = actionDenialResult(error);
		if (denied) return denied;
		console.error("Failed to update daily feed ceiling:", error);
		return { success: false, error: "Failed to update the daily feed ceiling" };
	}
}
