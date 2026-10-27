"use server";

import { acceptAssistantActionWith } from "@/lib/assistant/accept";
import { getAssistantActionDefinition } from "@/lib/assistant/catalog";
import { getCurrentPermissions } from "@/lib/auth/permissions";
import { isCurrentPlatformAdmin } from "@/lib/auth/require-platform-admin";
import { assertPasswordChanged, canWrite, getCurrentUser } from "@/lib/auth/session";
import { requireStepUp } from "@/lib/auth/step-up";
import { isCurrentTenantAdmin } from "@/lib/auth/tenant-admin";
import { assertNotViewingAs } from "@/lib/auth/view-as";
import prisma from "@/lib/prisma";

/**
 * Accept / Reject an assistant proposal (issue #194, E10).
 *
 * This is the *only* execution path for a proposal. It never trusts the card
 * the client rendered: the row and its payload come from the database, the
 * payload is re-validated, the permissions are re-read, and the tool runs the
 * same server action a button would.
 */

export type AcceptAssistantActionResult =
	| { success: true; message: string }
	| { success: false; error: string; code?: "step_up_required" };

export async function acceptAssistantAction(
	actionId: string,
): Promise<AcceptAssistantActionResult> {
	try {
		await assertPasswordChanged();
	} catch {
		return { success: false, error: "Change your temporary password first." };
	}
	try {
		// A read-only view-as session may not decide proposals either; the
		// underlying action would refuse the write, but deciding a row is a
		// write too, so fail before touching one.
		await assertNotViewingAs();
	} catch {
		return { success: false, error: "This is a read-only view-as session." };
	}

	const user = await getCurrentUser();
	if (!user) return { success: false, error: "Not authenticated." };

	return acceptAssistantActionWith(user.id, actionId, {
		now: () => new Date(),
		load: (id) =>
			prisma.assistantAction.findUnique({
				where: { id },
				select: {
					id: true,
					userId: true,
					kind: true,
					payload: true,
					status: true,
					expiresAt: true,
				},
			}),
		markExpired: async (id) => {
			await prisma.assistantAction.update({
				where: { id },
				data: { status: "EXPIRED", decidedAt: new Date() },
			});
		},
		markAccepted: async (id, result) => {
			await prisma.assistantAction.update({
				where: { id },
				data: {
					status: "ACCEPTED",
					decidedAt: new Date(),
					result: { message: result.message },
				},
			});
		},
		markFailed: async (id, error) => {
			await prisma.assistantAction.update({
				where: { id },
				data: { status: "FAILED", decidedAt: new Date(), error: error.slice(0, 1000) },
			});
		},
		hasPermission: async (permission) => (await getCurrentPermissions()).has(permission),
		canWrite,
		isPlatformAdmin: isCurrentPlatformAdmin,
		isTenantAdmin: isCurrentTenantAdmin,
		requireStepUp: async () => {
			await requireStepUp();
		},
		execute: async (toolId, payload, userId) => {
			const definition = getAssistantActionDefinition(toolId);
			if (!definition) return { success: false, message: "Unknown action." };
			return definition.execute(payload, { userId });
		},
	});
}

export async function rejectAssistantAction(
	actionId: string,
): Promise<{ success: true } | { success: false; error: string }> {
	try {
		await assertNotViewingAs();
	} catch {
		return { success: false, error: "This is a read-only view-as session." };
	}
	const user = await getCurrentUser();
	if (!user) return { success: false, error: "Not authenticated." };

	const row = await prisma.assistantAction.findUnique({
		where: { id: actionId },
		select: { id: true, userId: true, status: true, expiresAt: true },
	});
	if (!row || row.userId !== user.id) {
		return { success: false, error: "That action was not found." };
	}
	if (row.status !== "PENDING") {
		return { success: false, error: "That action was already decided." };
	}

	const expired = row.expiresAt.getTime() <= Date.now();
	await prisma.assistantAction.update({
		where: { id: row.id },
		data: { status: expired ? "EXPIRED" : "REJECTED", decidedAt: new Date() },
	});
	return { success: true };
}
