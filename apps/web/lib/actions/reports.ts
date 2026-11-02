"use server";

import { actorContext, writePlatformAudit } from "@/lib/actions/platform/audit";
import { requirePlatformAdmin } from "@/lib/auth/require-platform-admin";
import prisma from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { z } from "zod";

/**
 * Resolve one public/assistant issue report (issue #487).
 *
 * Platform-admin only, idempotent, and audited: closing a report changes an
 * operational record, so it leaves one `PlatformAuditLog` row like every other
 * platform action. A second resolve succeeds without a second audit row or
 * timestamp.
 */

const issueReportIdSchema = z.string().trim().min(1).max(64);

export type ResolveIssueReportResult = { success: true } | { error: string };

const RESOLVE_REASON = "Issue report marked resolved from the platform console.";

export async function resolveIssueReport(id: string): Promise<ResolveIssueReportResult> {
	await requirePlatformAdmin();

	const parsed = issueReportIdSchema.safeParse(id);
	if (!parsed.success) return { error: "Unknown report." };

	const actor = await actorContext();
	let missing = false;

	await prisma.$transaction(async (tx) => {
		const existing = await tx.issueReport.findUnique({
			where: { id: parsed.data },
			select: { id: true, status: true },
		});
		if (!existing) {
			missing = true;
			return;
		}
		// Already resolved: succeed without a second audit row or timestamp.
		if (existing.status === "RESOLVED") return;

		await tx.issueReport.update({
			where: { id: existing.id },
			data: { status: "RESOLVED", resolvedAt: new Date(), resolvedBy: actor.id },
		});

		await writePlatformAudit(tx, {
			actorUserId: actor.id,
			action: "platform.issue_report.resolve",
			targetType: "issue_report",
			targetId: existing.id,
			reason: RESOLVE_REASON,
			temporaryGrant: actor.temporaryGrant,
		});
	});

	if (missing) return { error: "Unknown report." };

	revalidatePath("/[locale]/(superadmin)/superadmin/operations/reports", "page");
	return { success: true };
}
