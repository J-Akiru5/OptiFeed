"use server";

import { writePlatformAudit } from "@/lib/actions/platform/audit";
import { MEMBER_ROLES } from "@/lib/auth/member-rules";
import { resolveOrgScope } from "@/lib/auth/org-scope";
import { requirePermission } from "@/lib/auth/permissions";
import { getCurrentUser } from "@/lib/auth/session";
import { requireTenantAdmin } from "@/lib/auth/tenant-admin";
import { formatZodError } from "@/lib/limits";
import prisma from "@/lib/prisma";
import {
	DEVICE_REGISTRATION_MODES,
	ORG_DEFAULT_FEEDING_RATE_MAX,
	ORG_DEFAULT_FEEDING_RATE_MIN,
	ORG_HOPPER_LOW_PCT_MAX,
	ORG_HOPPER_LOW_PCT_MIN,
	ORG_OFFLINE_AFTER_MIN_MAX,
	ORG_OFFLINE_AFTER_MIN_MIN,
	type OrgSettings,
	getOrgSettings,
	mergeOrgSettings,
} from "@/lib/settings/org";
import type { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { z } from "zod";

/**
 * Organization settings (issue #190 / decision E6).
 *
 * Every mutation is a tenant-admin action: `requireTenantAdmin()` (OWNER/ADMIN
 * of an ACTIVE org) plus `manage_farms_ponds`, then the target org must be one
 * of the caller's scoped orgs. The row is upserted because an org created before
 * the settings migration has none, and the before/after values are written to
 * the platform audit log (the only audit table) in the same transaction.
 */

const settingsPatchSchema = z
	.object({
		defaultFeedingRatePct: z
			.number("Default feeding rate must be a number")
			.min(ORG_DEFAULT_FEEDING_RATE_MIN)
			.max(ORG_DEFAULT_FEEDING_RATE_MAX)
			.optional(),
		hopperLowPct: z
			.number("Hopper low threshold must be a number")
			.int("Hopper low threshold must be a whole number")
			.min(ORG_HOPPER_LOW_PCT_MIN)
			.max(ORG_HOPPER_LOW_PCT_MAX)
			.optional(),
		offlineAfterMin: z
			.number("Offline alert delay must be a number")
			.int("Offline alert delay must be a whole number")
			.min(ORG_OFFLINE_AFTER_MIN_MIN)
			.max(ORG_OFFLINE_AFTER_MIN_MAX)
			.optional(),
		missedFeedingAlerts: z.boolean().optional(),
		alertRoles: z.array(z.enum(MEMBER_ROLES)).min(1, "Choose at least one alert role").optional(),
		deviceRegistration: z.enum(DEVICE_REGISTRATION_MODES).optional(),
	})
	.strict();

export type UpdateOrgSettingsInput = z.input<typeof settingsPatchSchema> & {
	/** Defaults to the caller's first scoped org. */
	orgId?: string;
};

export type UpdateOrgSettingsResult = { success: true } | { error: string };

const SETTINGS_REASON = "Organization settings updated by a tenant admin";

function changedFields(before: OrgSettings, after: OrgSettings): string[] {
	return (Object.keys(after) as (keyof OrgSettings)[]).filter((key) => {
		const a = before[key];
		const b = after[key];
		return Array.isArray(a) && Array.isArray(b) ? a.join(",") !== b.join(",") : a !== b;
	});
}

export async function updateOrgSettings(
	input: UpdateOrgSettingsInput,
): Promise<UpdateOrgSettingsResult> {
	await requireTenantAdmin();
	await requirePermission("manage_farms_ponds");

	const scope = await resolveOrgScope();
	if (scope.orgIds.length === 0) {
		return { error: "You must belong to an organization to change its settings." };
	}

	const raw = input && typeof input === "object" ? input : ({} as UpdateOrgSettingsInput);
	const requestedOrgId = typeof raw.orgId === "string" && raw.orgId ? raw.orgId : undefined;
	const orgId = requestedOrgId ?? scope.orgIds[0];
	if (!orgId || !scope.orgIds.includes(orgId)) {
		return { error: "That organization is outside your scope." };
	}

	const { orgId: _ignored, ...patch } = raw;
	const parsed = settingsPatchSchema.safeParse(patch);
	if (!parsed.success) {
		return { error: formatZodError(parsed.error) };
	}
	if (Object.keys(parsed.data).length === 0) {
		return { error: "Nothing to update." };
	}

	const actor = await getCurrentUser();
	if (!actor) return { error: "Not authenticated." };

	const before = await getOrgSettings(orgId);
	const after = mergeOrgSettings({ ...before, ...parsed.data });
	if (changedFields(before, after).length === 0) {
		return { success: true };
	}

	try {
		await prisma.$transaction(async (tx) => {
			await tx.orgSetting.upsert({
				where: { orgId },
				create: { orgId, ...after, updatedById: actor.id },
				update: { ...after, updatedById: actor.id },
			});
			await writePlatformAudit(tx, {
				actorUserId: actor.id,
				action: "org.settings.update",
				targetType: "org_setting",
				targetId: orgId,
				orgId,
				reason: SETTINGS_REASON,
				before: before as unknown as Prisma.InputJsonValue,
				after: after as unknown as Prisma.InputJsonValue,
			});
		});

		revalidatePath("/[locale]/(admin)/admin/settings", "page");
		revalidatePath("/[locale]/(admin)/admin/devices", "page");
		revalidatePath("/[locale]/(admin)/admin/ponds/new", "page");
		return { success: true };
	} catch (error) {
		console.error("[org-settings] updateOrgSettings error:", error);
		return { error: "Failed to save the organization settings." };
	}
}
