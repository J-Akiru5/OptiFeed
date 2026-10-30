"use server";

import { actorContext, writePlatformAudit } from "@/lib/actions/platform/audit";
import { requirePlatformAdmin } from "@/lib/auth/require-platform-admin";
import {
	STICKER_RATING_KEY,
	type StickerRatingInput,
	normalizeStickerRating,
	stickerRatingInputSchema,
} from "@/lib/constants/sticker-rating";
import {
	DEVICE_OFFLINE_AFTER_MIN_MAX,
	DEVICE_OFFLINE_AFTER_MIN_MIN,
	DEVICE_OFFLINE_GRACE_MIN_MAX,
	DEVICE_OFFLINE_GRACE_MIN_MIN,
	DEVICE_STATUS_SETTING_KEY,
	DEVICE_WEAK_AFTER_MIN_MAX,
	DEVICE_WEAK_AFTER_MIN_MIN,
	type DeviceStatusSettingValue,
	normalizeDeviceStatusValue,
} from "@/lib/device-status";
import prisma from "@/lib/prisma";
import {
	LIST_PAGE_SIZE_KEY,
	LIST_PAGE_SIZE_MAX,
	LIST_PAGE_SIZE_MIN,
	normalizeListPageSize,
} from "@/lib/settings/platform";
import type { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { z } from "zod";

/**
 * The app-wide list page size (decision E1, issue #187).
 *
 * This is platform configuration, not tenant data: only a platform admin may
 * change it. The value is validated against the same 5–100 range the reader
 * enforces, and the old → new value plus the required reason are recorded in
 * one PlatformAuditLog row in the same transaction as the upsert.
 */

const MIN_REASON_LENGTH = 10;
const MAX_REASON_LENGTH = 500;

const inputSchema = z.object({
	value: z.number().int().min(LIST_PAGE_SIZE_MIN).max(LIST_PAGE_SIZE_MAX),
	reason: z.string().trim().min(MIN_REASON_LENGTH).max(MAX_REASON_LENGTH),
});

export type SetListPageSizeResult = { success: true; value: number } | { error: string };

export async function setListPageSize(
	value: number,
	reason: string,
): Promise<SetListPageSizeResult> {
	await requirePlatformAdmin();

	const parsed = inputSchema.safeParse({ value, reason });
	if (!parsed.success) {
		if (parsed.error.issues.some((issue) => issue.path.includes("value"))) {
			return {
				error: `Choose a whole number from ${LIST_PAGE_SIZE_MIN} to ${LIST_PAGE_SIZE_MAX}.`,
			};
		}
		return {
			error: `A reason of at least ${MIN_REASON_LENGTH} characters is required.`,
		};
	}

	const actor = await actorContext();

	const saved = await prisma.$transaction(async (tx) => {
		const existing = await tx.platformSetting.findUnique({
			where: { key: LIST_PAGE_SIZE_KEY },
			select: { value: true },
		});
		const before = normalizeListPageSize(existing?.value);

		await tx.platformSetting.upsert({
			where: { key: LIST_PAGE_SIZE_KEY },
			create: {
				key: LIST_PAGE_SIZE_KEY,
				value: parsed.data.value,
				updatedById: actor.id,
			},
			update: {
				value: parsed.data.value,
				updatedById: actor.id,
			},
		});

		await writePlatformAudit(tx, {
			actorUserId: actor.id,
			action: "platform.settings.list_page_size",
			targetType: "platform_setting",
			targetId: LIST_PAGE_SIZE_KEY,
			reason: parsed.data.reason,
			temporaryGrant: actor.temporaryGrant,
			before: { pageSize: before },
			after: { pageSize: parsed.data.value },
		});

		return parsed.data.value;
	});

	// Every list lives under one of these layouts; a layout revalidation keeps
	// server-rendered pagination consistent without touching client filters.
	revalidatePath("/[locale]/(dashboard)", "layout");
	revalidatePath("/[locale]/(admin)", "layout");
	revalidatePath("/[locale]/(superadmin)", "layout");

	return { success: true, value: saved };
}

/**
 * Device connectivity thresholds (issue #388).
 *
 * Three whole-minute values: when a late heartbeat becomes "weak signal", when
 * the unit becomes offline, and the grace added on top of the offline window so
 * one missed beat cannot flip the UI. Stored in `PlatformSetting` under
 * `device.status`; no schema change. `weakAfterMin` must stay below
 * `offlineAfterMin`, and every value is inside the same bounds the reader
 * enforces, so a hand-edited row cannot create an impossible policy.
 */

const deviceStatusSchema = z
	.object({
		weakAfterMin: z.number().int().min(DEVICE_WEAK_AFTER_MIN_MIN).max(DEVICE_WEAK_AFTER_MIN_MAX),
		offlineAfterMin: z
			.number()
			.int()
			.min(DEVICE_OFFLINE_AFTER_MIN_MIN)
			.max(DEVICE_OFFLINE_AFTER_MIN_MAX),
		graceMin: z.number().int().min(DEVICE_OFFLINE_GRACE_MIN_MIN).max(DEVICE_OFFLINE_GRACE_MIN_MAX),
	})
	.refine((value) => value.weakAfterMin < value.offlineAfterMin, {
		message: "The weak-signal window must be shorter than the offline window.",
		path: ["weakAfterMin"],
	});

export type DeviceStatusActionResult =
	| { success: true; value: DeviceStatusSettingValue }
	| { error: string };

export async function setDeviceStatusThresholds(
	input: DeviceStatusSettingValue,
	reason: string,
): Promise<DeviceStatusActionResult> {
	await requirePlatformAdmin();

	const parsed = deviceStatusSchema.safeParse(input);
	if (!parsed.success) {
		const issue = parsed.error.issues[0];
		const field = issue?.path.join(".");
		if (field === "weakAfterMin" && issue?.message.includes("shorter")) {
			return { error: issue.message };
		}
		return {
			error: `Use whole minutes: weak signal ${DEVICE_WEAK_AFTER_MIN_MIN}–${DEVICE_WEAK_AFTER_MIN_MAX}, offline ${DEVICE_OFFLINE_AFTER_MIN_MIN}–${DEVICE_OFFLINE_AFTER_MIN_MAX}, grace ${DEVICE_OFFLINE_GRACE_MIN_MIN}–${DEVICE_OFFLINE_GRACE_MIN_MAX}.`,
		};
	}

	const parsedReason = inputSchema.shape.reason.safeParse(reason);
	if (!parsedReason.success) {
		return {
			error: `A reason of at least ${MIN_REASON_LENGTH} characters is required.`,
		};
	}

	const next = normalizeDeviceStatusValue(parsed.data);
	const actor = await actorContext();

	await prisma.$transaction(async (tx) => {
		const existing = await tx.platformSetting.findUnique({
			where: { key: DEVICE_STATUS_SETTING_KEY },
			select: { value: true },
		});
		const before = normalizeDeviceStatusValue(existing?.value);

		await tx.platformSetting.upsert({
			where: { key: DEVICE_STATUS_SETTING_KEY },
			create: {
				key: DEVICE_STATUS_SETTING_KEY,
				value: next as unknown as Prisma.InputJsonValue,
				updatedById: actor.id,
			},
			update: { value: next as unknown as Prisma.InputJsonValue, updatedById: actor.id },
		});

		await writePlatformAudit(tx, {
			actorUserId: actor.id,
			action: "platform.settings.device_status",
			targetType: "platform_setting",
			targetId: DEVICE_STATUS_SETTING_KEY,
			reason: parsedReason.data,
			temporaryGrant: actor.temporaryGrant,
			before: { ...before },
			after: { ...next },
		});
	});

	revalidatePath("/[locale]/(superadmin)", "layout");
	revalidatePath("/[locale]/(admin)", "layout");
	revalidatePath("/[locale]/(dashboard)", "layout");
	return { success: true, value: next };
}

/**
 * Sticker rating default (decision E17, issue #197).
 *
 * The printed rating is a property of the product, not of one organization,
 * so only a platform admin may save a new default. Every print can still be
 * overridden for that print through the URL, which needs no extra permission.
 */

const MIN_RATING_REASON_LENGTH = 10;
const MAX_RATING_REASON_LENGTH = 500;

const ratingReasonSchema = z
	.string()
	.trim()
	.min(MIN_RATING_REASON_LENGTH)
	.max(MAX_RATING_REASON_LENGTH);

export type StickerRatingActionResult = { success: true } | { error: string };

function ratingReasonError(): string {
	return `A reason of at least ${MIN_RATING_REASON_LENGTH} characters is required.`;
}

function revalidatePrintPages(): void {
	revalidatePath("/[locale]/(print)/admin/devices/labels", "page");
	revalidatePath("/[locale]/(print)/superadmin/devices/labels", "page");
}

export async function setStickerRatingDefault(
	values: StickerRatingInput,
	reason: string,
): Promise<StickerRatingActionResult> {
	await requirePlatformAdmin();

	const parsedValues = stickerRatingInputSchema.safeParse(values);
	if (!parsedValues.success) {
		if (parsedValues.error.issues.some((issue) => issue.path.includes("measuredAt"))) {
			return { error: "Enter the measurement date when the rating was measured." };
		}
		return { error: "The rating values are outside the allowed range." };
	}

	const parsedReason = ratingReasonSchema.safeParse(reason);
	if (!parsedReason.success) return { error: ratingReasonError() };

	const rating = normalizeStickerRating(parsedValues.data);
	if (!rating) return { error: "The rating values are outside the allowed range." };

	const actor = await actorContext();

	await prisma.$transaction(async (tx) => {
		const existing = await tx.platformSetting.findUnique({
			where: { key: STICKER_RATING_KEY },
			select: { value: true },
		});
		const before = normalizeStickerRating(existing?.value);

		await tx.platformSetting.upsert({
			where: { key: STICKER_RATING_KEY },
			create: { key: STICKER_RATING_KEY, value: rating, updatedById: actor.id },
			update: { value: rating, updatedById: actor.id },
		});

		await writePlatformAudit(tx, {
			actorUserId: actor.id,
			action: "platform.settings.sticker_rating",
			targetType: "platform_setting",
			targetId: STICKER_RATING_KEY,
			reason: parsedReason.data,
			temporaryGrant: actor.temporaryGrant,
			before: { rating: before },
			after: { rating },
		});
	});

	revalidatePrintPages();
	return { success: true };
}

export async function clearStickerRatingDefault(
	reason: string,
): Promise<StickerRatingActionResult> {
	await requirePlatformAdmin();

	const parsedReason = ratingReasonSchema.safeParse(reason);
	if (!parsedReason.success) return { error: ratingReasonError() };

	const actor = await actorContext();

	const cleared = await prisma.$transaction(async (tx) => {
		const existing = await tx.platformSetting.findUnique({
			where: { key: STICKER_RATING_KEY },
			select: { value: true },
		});
		if (!existing) return false;

		const before = normalizeStickerRating(existing.value);
		await tx.platformSetting.delete({ where: { key: STICKER_RATING_KEY } });
		await writePlatformAudit(tx, {
			actorUserId: actor.id,
			action: "platform.settings.sticker_rating_clear",
			targetType: "platform_setting",
			targetId: STICKER_RATING_KEY,
			reason: parsedReason.data,
			temporaryGrant: actor.temporaryGrant,
			before: { rating: before },
			after: { rating: null },
		});
		return true;
	});

	if (cleared) revalidatePrintPages();
	return { success: true };
}
