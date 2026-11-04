"use server";

import { writePlatformAudit } from "@/lib/actions/platform/audit";
import { requirePermission } from "@/lib/auth/permissions";
import { getCurrentPondOwnerId, getCurrentUser, requireWriteAccess } from "@/lib/auth/session";
import {
	GROWTH_DEFAULT_BOUNDS,
	GROWTH_DEFAULT_FIELDS,
	type GrowthDefaults,
	isEmptyGrowthDefaults,
	sanitizeGrowthDefaults,
} from "@/lib/growth/defaults";
import prisma from "@/lib/prisma";
import { getOrgSettingsForFarm } from "@/lib/settings/org";
import type { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { z } from "zod";

/**
 * Per-pond growth-default overrides (#828).
 *
 * The farm-level default is an organization setting and is written by
 * `updateOrgSettings` in the /admin console. This action only touches the
 * pond's own row, so an owner/admin can override grow-out duration, target
 * weight, survival, stocking weight or the density advisory for one pond.
 *
 * Guards follow the pond settings surface: write access plus
 * `manage_farms_ponds`, and the pond is re-read inside the transaction against
 * `getCurrentPondOwnerId()` so another tenant's id behaves exactly like a
 * missing pond. Every write appends one `PlatformAuditLog` row with the
 * before/after values, and the calendar/growth/settings paths are revalidated.
 *
 * A cleared field writes `NULL` (inherit), and clearing every field deletes
 * the row instead of storing a row of nulls.
 */

const BOUNDS = GROWTH_DEFAULT_BOUNDS;

const pondGrowthDefaultsSchema = z
	.object({
		growOutDays: z
			.number("Grow-out days must be a number")
			.int("Grow-out days must be a whole number")
			.min(BOUNDS.growOutDays.min)
			.max(BOUNDS.growOutDays.max)
			.nullable()
			.optional(),
		targetHarvestWeightG: z
			.number("Target weight must be a number")
			.min(BOUNDS.targetHarvestWeightG.min)
			.max(BOUNDS.targetHarvestWeightG.max)
			.nullable()
			.optional(),
		expectedSurvivalPct: z
			.number("Survival must be a number")
			.min(BOUNDS.expectedSurvivalPct.min)
			.max(BOUNDS.expectedSurvivalPct.max)
			.nullable()
			.optional(),
		stockingAvgWeightG: z
			.number("Stocking weight must be a number")
			.min(BOUNDS.stockingAvgWeightG.min)
			.max(BOUNDS.stockingAvgWeightG.max)
			.nullable()
			.optional(),
		densityAdvisoryPerM2: z
			.number("Density advisory must be a number")
			.min(BOUNDS.densityAdvisoryPerM2.min)
			.max(BOUNDS.densityAdvisoryPerM2.max)
			.nullable()
			.optional(),
	})
	.strict();

export type PondGrowthDefaultsInput = z.input<typeof pondGrowthDefaultsSchema>;

export type PondGrowthDefaultsResult = { success: true } | { success: false; error: string };

const AUDIT_REASON = "Pond growth defaults changed by an owner or admin";
const NOT_FOUND = "Pond not found.";
const SAVE_FAILED = "Could not save the pond growth defaults. Try again.";
const NOTHING_TO_UPDATE = "Nothing to update.";

function revalidateGrowthDefaultPaths(): void {
	revalidatePath("/[locale]/(dashboard)/dashboard/settings/pond", "page");
	revalidatePath("/[locale]/(dashboard)/dashboard/calendar", "page");
	revalidatePath("/[locale]/(dashboard)/dashboard/growth", "page");
	revalidatePath("/[locale]/(admin)/admin/calendar", "page");
}

function sameDefaults(left: GrowthDefaults, right: GrowthDefaults): boolean {
	return GROWTH_DEFAULT_FIELDS.every((field) => left[field] === right[field]);
}

export async function savePondGrowthDefaults(
	pondId: string,
	input: PondGrowthDefaultsInput,
): Promise<PondGrowthDefaultsResult> {
	try {
		await requireWriteAccess();
		await requirePermission("manage_farms_ponds");
	} catch {
		return { success: false, error: "You do not have permission to change pond defaults." };
	}

	if (typeof pondId !== "string" || pondId.length === 0) {
		return { success: false, error: NOT_FOUND };
	}

	const parsed = pondGrowthDefaultsSchema.safeParse(input ?? {});
	if (!parsed.success) {
		return { success: false, error: parsed.error.issues[0]?.message ?? "Invalid value." };
	}
	if (Object.keys(parsed.data).length === 0) {
		return { success: false, error: NOTHING_TO_UPDATE };
	}

	const ownerId = await getCurrentPondOwnerId();
	const actor = await getCurrentUser();
	if (!actor) return { success: false, error: "Not authenticated." };

	try {
		const { orgId } = await getOrgSettingsForFarm(ownerId);

		const result = await prisma.$transaction(async (tx) => {
			const pond = await tx.pond.findFirst({
				where: { id: pondId, ownerId },
				select: { id: true },
			});
			if (!pond) return { kind: "not_found" as const };

			const existing = await tx.pondGrowthOverride.findUnique({ where: { pondId: pond.id } });
			const before = existing ? sanitizeGrowthDefaults(existing) : sanitizeGrowthDefaults(null);
			// `undefined` means "leave this field alone"; `null` means "clear it".
			const patch = Object.fromEntries(
				Object.entries(parsed.data).filter(([, value]) => value !== undefined),
			);
			const after = sanitizeGrowthDefaults({ ...before, ...patch });
			if (sameDefaults(before, after)) return { kind: "unchanged" as const };

			if (isEmptyGrowthDefaults(after)) {
				await tx.pondGrowthOverride.deleteMany({ where: { pondId: pond.id } });
			} else {
				await tx.pondGrowthOverride.upsert({
					where: { pondId: pond.id },
					create: { pondId: pond.id, ...after, updatedById: actor.id },
					update: { ...after, updatedById: actor.id },
				});
			}

			await writePlatformAudit(tx, {
				actorUserId: actor.id,
				action: "pond.growth_defaults.update",
				targetType: "pond",
				targetId: pond.id,
				orgId,
				reason: AUDIT_REASON,
				before: before as unknown as Prisma.InputJsonValue,
				after: after as unknown as Prisma.InputJsonValue,
			});

			return { kind: "saved" as const };
		});

		if (result.kind === "not_found") return { success: false, error: NOT_FOUND };
		if (result.kind === "saved") revalidateGrowthDefaultPaths();
		return { success: true };
	} catch (error) {
		console.error("[growth-defaults] savePondGrowthDefaults failed:", error);
		return { success: false, error: SAVE_FAILED };
	}
}
