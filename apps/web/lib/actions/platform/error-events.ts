"use server";

import { actorContext, writePlatformAudit } from "@/lib/actions/platform/audit";
import { requirePlatformAdmin } from "@/lib/auth/require-platform-admin";
import prisma from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { z } from "zod";

/**
 * Resolve one captured error (mission 2026-10-29e, I-64).
 *
 * Platform-admin only, idempotent, and audited: resolving changes an
 * operational record, so it leaves one `PlatformAuditLog` row like every other
 * platform action. A recurring error reopens itself (see
 * lib/error-capture.ts), so this action cannot hide an active failure.
 */

const errorEventIdSchema = z.string().trim().min(1).max(64);

export type ResolveErrorEventResult = { success: true } | { error: string };

const RESOLVE_REASON = "Error event marked resolved from the platform error console.";

export async function resolveErrorEvent(id: string): Promise<ResolveErrorEventResult> {
	await requirePlatformAdmin();

	const parsed = errorEventIdSchema.safeParse(id);
	if (!parsed.success) return { error: "Unknown error event." };

	const actor = await actorContext();
	let missing = false;

	await prisma.$transaction(async (tx) => {
		const existing = await tx.errorEvent.findUnique({
			where: { id: parsed.data },
			select: { id: true, resolved: true },
		});
		if (!existing) {
			missing = true;
			return;
		}
		// Already resolved: succeed without a second audit row or timestamp.
		if (existing.resolved) return;

		await tx.errorEvent.update({
			where: { id: existing.id },
			data: { resolved: true, resolvedAt: new Date(), resolvedBy: actor.id },
		});

		await writePlatformAudit(tx, {
			actorUserId: actor.id,
			action: "platform.error_event.resolve",
			targetType: "error_event",
			targetId: existing.id,
			reason: RESOLVE_REASON,
			temporaryGrant: actor.temporaryGrant,
		});
	});

	if (missing) return { error: "Unknown error event." };

	revalidatePath("/[locale]/(superadmin)/superadmin/operations/errors", "page");
	return { success: true };
}
