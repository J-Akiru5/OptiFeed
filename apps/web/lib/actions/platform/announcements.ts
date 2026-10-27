"use server";

import { randomUUID } from "node:crypto";
import { actorContext, writePlatformAudit } from "@/lib/actions/platform/audit";
import {
	ANNOUNCEMENT_KEY,
	type Announcement,
	announcementInputSchema,
	endOfDayIso,
} from "@/lib/announcement";
import { requirePlatformAdmin } from "@/lib/auth/require-platform-admin";
import prisma from "@/lib/prisma";
import type { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { z } from "zod";

/**
 * Platform announcements (E16.4, task I-15).
 *
 * The banner is written to `PlatformSetting` (`announcement.current`) so no
 * schema change is needed. Publishing and clearing are platform actions: an
 * active PlatformAdmin, a zod-validated payload, a required reason and exactly
 * one `PlatformAuditLog` row in the same transaction as the setting write.
 */

const MIN_REASON_LENGTH = 10;
const MAX_REASON_LENGTH = 500;
const reasonSchema = z.string().trim().min(MIN_REASON_LENGTH).max(MAX_REASON_LENGTH);

export type AnnouncementActionResult = { success: true } | { error: string };

function reasonError(): string {
	return `A reason of at least ${MIN_REASON_LENGTH} characters is required.`;
}

function revalidateAnnouncementSurfaces(): void {
	// The banner lives in the dashboard and admin layouts, so a layout-level
	// revalidation is enough for every tenant page.
	revalidatePath("/[locale]/(dashboard)", "layout");
	revalidatePath("/[locale]/(admin)", "layout");
	revalidatePath("/[locale]/(superadmin)/superadmin/operations/announcements", "page");
}

export async function publishAnnouncement(
	input: unknown,
	reason: string,
): Promise<AnnouncementActionResult> {
	await requirePlatformAdmin();

	const parsed = announcementInputSchema.safeParse(input);
	if (!parsed.success) {
		const issue = parsed.error.issues[0];
		return { error: issue?.message ?? "The announcement is invalid." };
	}

	const parsedReason = reasonSchema.safeParse(reason);
	if (!parsedReason.success) return { error: reasonError() };

	const now = new Date();
	let endsAt: string | null = null;
	if (parsed.data.endsOn !== null) {
		endsAt = endOfDayIso(parsed.data.endsOn);
		if (!endsAt) return { error: "The end date is not a real calendar day." };
		if (new Date(endsAt).getTime() <= now.getTime()) {
			return { error: "The end date must be today or later." };
		}
	}

	const actor = await actorContext();
	const announcement: Announcement = {
		id: randomUUID(),
		title: parsed.data.title,
		body: parsed.data.body,
		severity: parsed.data.severity,
		endsAt,
		publishedAt: now.toISOString(),
		createdById: actor.id,
	};

	await prisma.$transaction(async (tx) => {
		const existing = await tx.platformSetting.findUnique({
			where: { key: ANNOUNCEMENT_KEY },
			select: { value: true },
		});

		await tx.platformSetting.upsert({
			where: { key: ANNOUNCEMENT_KEY },
			create: {
				key: ANNOUNCEMENT_KEY,
				value: announcement as unknown as Prisma.InputJsonValue,
				updatedById: actor.id,
			},
			update: {
				value: announcement as unknown as Prisma.InputJsonValue,
				updatedById: actor.id,
			},
		});

		await writePlatformAudit(tx, {
			actorUserId: actor.id,
			action: "platform.announcement.publish",
			targetType: "platform_setting",
			targetId: ANNOUNCEMENT_KEY,
			reason: parsedReason.data,
			temporaryGrant: actor.temporaryGrant,
			...(existing ? { before: existing.value as Prisma.InputJsonValue } : {}),
			after: announcement as unknown as Prisma.InputJsonValue,
		});
	});

	revalidateAnnouncementSurfaces();
	return { success: true };
}

export async function clearAnnouncement(reason: string): Promise<AnnouncementActionResult> {
	await requirePlatformAdmin();

	const parsedReason = reasonSchema.safeParse(reason);
	if (!parsedReason.success) return { error: reasonError() };

	const actor = await actorContext();

	await prisma.$transaction(async (tx) => {
		const existing = await tx.platformSetting.findUnique({
			where: { key: ANNOUNCEMENT_KEY },
			select: { value: true },
		});

		await tx.platformSetting.deleteMany({ where: { key: ANNOUNCEMENT_KEY } });

		await writePlatformAudit(tx, {
			actorUserId: actor.id,
			action: "platform.announcement.clear",
			targetType: "platform_setting",
			targetId: ANNOUNCEMENT_KEY,
			reason: parsedReason.data,
			temporaryGrant: actor.temporaryGrant,
			...(existing ? { before: existing.value as Prisma.InputJsonValue } : {}),
		});
	});

	revalidateAnnouncementSurfaces();
	return { success: true };
}
