"use server";

import { actorContext, writePlatformAudit } from "@/lib/actions/platform/audit";
import { requirePlatformAdmin } from "@/lib/auth/require-platform-admin";
import prisma from "@/lib/prisma";
import {
	LIST_PAGE_SIZE_KEY,
	LIST_PAGE_SIZE_MAX,
	LIST_PAGE_SIZE_MIN,
	normalizeListPageSize,
} from "@/lib/settings/platform";
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
