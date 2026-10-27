"use server";

import { actorContext, writePlatformAudit } from "@/lib/actions/platform/audit";
import { requirePlatformAdmin } from "@/lib/auth/require-platform-admin";
import { isStepUpRequiredError, withStepUp } from "@/lib/auth/step-up";
import prisma from "@/lib/prisma";
import { revalidatePath } from "next/cache";

/**
 * Platform organization suspension (issue #194, E10).
 *
 * A platform admin can stop a tenant from using the product without deleting
 * any data: every authorization path already refuses a SUSPENDED organization
 * (`resolveOrgScope`, `getCurrentPermissions`, `resolveManagedMember`). Restore
 * flips it back to ACTIVE.
 *
 * Same god-mode guardrails as the rest of the console: platform admin, a
 * written reason, a fresh step-up, and one PlatformAuditLog row per change.
 */

const MIN_REASON_LENGTH = 10;
const MAX_REASON_LENGTH = 500;

export type OrganizationStatus = "ACTIVE" | "SUSPENDED";

export type SetOrganizationStatusResult =
	| { success: true; status: OrganizationStatus }
	| { error: string; code?: "step_up_required" };

function requireReason(reason: string | undefined): string {
	const trimmed = reason?.trim() ?? "";
	if (trimmed.length < MIN_REASON_LENGTH) {
		throw new Error(`A reason of at least ${MIN_REASON_LENGTH} characters is required.`);
	}
	return trimmed.slice(0, MAX_REASON_LENGTH);
}

export async function setOrganizationStatus(input: {
	orgId: string;
	status: OrganizationStatus;
	reason: string;
}): Promise<SetOrganizationStatusResult> {
	await requirePlatformAdmin();

	if (input.status !== "ACTIVE" && input.status !== "SUSPENDED") {
		return { error: "Choose suspend or restore." };
	}

	let reason: string;
	try {
		reason = requireReason(input.reason);
	} catch (error) {
		return { error: error instanceof Error ? error.message : "A reason is required." };
	}

	try {
		const org = await prisma.organization.findUnique({
			where: { id: input.orgId },
			select: { id: true, name: true, status: true },
		});
		if (!org) return { error: "Organization not found." };
		if (org.status === "PURGED") {
			return { error: "This organization has been purged and cannot be restored." };
		}
		if (org.status === input.status) {
			return { success: true, status: input.status };
		}
		// Only a suspended org can be restored here. Cancelling a pending deletion is a
		// separate, deliberate flow and must not happen as a side effect of "restore".
		if (input.status === "ACTIVE" && org.status !== "SUSPENDED") {
			return { error: "Only a suspended organization can be restored." };
		}
		if (input.status === "SUSPENDED" && org.status !== "ACTIVE") {
			return { error: "Only an active organization can be suspended." };
		}

		const actor = await actorContext();

		await withStepUp(async (stepUpAt) => {
			await prisma.$transaction(async (tx) => {
				await tx.organization.update({
					where: { id: org.id },
					data: { status: input.status },
				});
				await writePlatformAudit(tx, {
					actorUserId: actor.id,
					action:
						input.status === "SUSPENDED"
							? "platform.organization.suspend"
							: "platform.organization.restore",
					targetType: "organization",
					targetId: org.id,
					orgId: org.id,
					reason,
					stepUpAt,
					temporaryGrant: actor.temporaryGrant,
					before: { status: org.status },
					after: { status: input.status },
				});
			});
		});

		revalidatePath("/[locale]/(superadmin)/superadmin/orgs", "page");
		revalidatePath(`/[locale]/(superadmin)/superadmin/orgs/${org.id}`, "page");
		return { success: true, status: input.status };
	} catch (error) {
		if (isStepUpRequiredError(error)) {
			return { error: error.message, code: "step_up_required" };
		}
		console.error(
			"[platform] setOrganizationStatus error:",
			error instanceof Error ? error.message : "unknown error",
		);
		return { error: "Failed to update the organization." };
	}
}
