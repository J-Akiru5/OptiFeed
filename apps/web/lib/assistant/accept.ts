import type { Permission } from "@/lib/auth/permissions";
import { getAssistantActionDefinition } from "./catalog";
import type { AssistantExecuteResult } from "./types";

/**
 * Accepting an assistant proposal (issue #194, E10).
 *
 * The rules, in order, and every one of them fails closed:
 * 1. the row must exist and belong to the caller;
 * 2. it must still be PENDING (a replayed Accept does nothing);
 * 3. it must not be expired;
 * 4. the stored payload is re-validated with the tool's schema;
 * 5. the caller must still hold the permission and still be allowed the kind;
 * 6. admin/superadmin kinds need a fresh step-up;
 * 7. execution goes through the definition, which calls the same server action
 *    a button uses, so caps, offline/fallow blocks and audit apply again.
 *
 * Dependencies are injected so the whole sequence can be tested without a
 * database or a browser session.
 */

export interface AssistantActionRow {
	id: string;
	userId: string;
	kind: string;
	payload: unknown;
	status: "PENDING" | "ACCEPTED" | "REJECTED" | "EXPIRED" | "FAILED";
	expiresAt: Date;
}

export interface AcceptDependencies {
	now(): Date;
	load(actionId: string): Promise<AssistantActionRow | null>;
	markExpired(actionId: string): Promise<void>;
	/**
	 * Atomically claim a PENDING row before running it. Returns false when another
	 * Accept already claimed it, so two concurrent Accepts can never both execute.
	 */
	claim(actionId: string): Promise<boolean>;
	markAccepted(actionId: string, result: { message: string }): Promise<void>;
	markFailed(actionId: string, error: string): Promise<void>;
	hasPermission(permission: Permission): Promise<boolean>;
	canWrite(): Promise<boolean>;
	isPlatformAdmin(): Promise<boolean>;
	isTenantAdmin(): Promise<boolean>;
	requireStepUp(): Promise<void>;
	execute(
		toolId: string,
		payload: Record<string, unknown>,
		userId: string,
	): Promise<AssistantExecuteResult>;
}

export type AcceptOutcome =
	| { success: true; message: string }
	| { success: false; code?: "step_up_required"; error: string };

export async function acceptAssistantActionWith(
	userId: string,
	actionId: string,
	deps: AcceptDependencies,
): Promise<AcceptOutcome> {
	const row = await deps.load(actionId);
	// Deliberately identical for "not found" and "someone else's row": the
	// response must not reveal that another user's proposal exists.
	if (!row || row.userId !== userId) {
		return { success: false, error: "That action was not found. Ask me again." };
	}

	if (row.status !== "PENDING") {
		return { success: false, error: "That action was already decided." };
	}

	if (row.expiresAt.getTime() <= deps.now().getTime()) {
		await deps.markExpired(row.id);
		return { success: false, error: "That action expired. Ask me again." };
	}

	const definition = getAssistantActionDefinition(row.kind);
	if (!definition) {
		await deps.markFailed(row.id, "Unknown action.");
		return { success: false, error: "That action is no longer supported." };
	}

	const stored = row.payload && typeof row.payload === "object" ? row.payload : {};
	const parsed = definition.schema.safeParse(stored);
	if (!parsed.success) {
		await deps.markFailed(row.id, "The stored action is no longer valid.");
		return { success: false, error: "The stored action is no longer valid. Ask me again." };
	}

	if (definition.platformAdminOnly && !(await deps.isPlatformAdmin())) {
		await deps.markFailed(row.id, "Platform admin required.");
		return { success: false, error: "Only a platform admin can do that." };
	}
	if (definition.tenantAdminOnly && !(await deps.isTenantAdmin())) {
		await deps.markFailed(row.id, "Tenant admin required.");
		return { success: false, error: "Only an organization owner or admin can do that." };
	}
	if (definition.permission && !(await deps.hasPermission(definition.permission))) {
		await deps.markFailed(row.id, "Permission denied.");
		return {
			success: false,
			error: "You no longer have permission to do that.",
		};
	}
	// Kinds with no named permission (logging a sample) still require a writer;
	// the underlying action re-checks this, but failing early keeps the card
	// honest and avoids a pointless write attempt.
	if (!definition.permission && !definition.platformAdminOnly && !(await deps.canWrite())) {
		await deps.markFailed(row.id, "Write access required.");
		return { success: false, error: "You have read-only access, so that cannot run." };
	}

	if (definition.requiresStepUp) {
		try {
			await deps.requireStepUp();
		} catch {
			// The row stays PENDING so the user can re-enter their password and
			// press Accept again without asking the assistant to rebuild it.
			return {
				success: false,
				code: "step_up_required",
				error: "Re-enter your password to continue. This action needs a fresh 5-minute check.",
			};
		}
	}

	if (!(await deps.claim(row.id))) {
		return { success: false, error: "That action was already decided." };
	}

	let outcome: AssistantExecuteResult;
	try {
		outcome = await deps.execute(definition.id, parsed.data as Record<string, unknown>, userId);
	} catch (error) {
		const message = error instanceof Error ? error.message : "The action failed.";
		await deps.markFailed(row.id, message);
		return { success: false, error: message };
	}

	if (!outcome.success) {
		await deps.markFailed(row.id, outcome.message);
		return { success: false, error: outcome.message };
	}

	await deps.markAccepted(row.id, { message: outcome.message });
	return { success: true, message: outcome.message };
}
