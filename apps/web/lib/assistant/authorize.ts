import type { AssistantCaller } from "./caller";
import {
	ownerRefusal,
	permissionRefusal,
	platformAdminRefusal,
	tenantAdminRefusal,
	writeRefusal,
} from "./guard-message";
import type { AssistantActionDefinition } from "./types";

/**
 * One authorization rule for the assistant (issue #194/#344, RBAC follow-up).
 *
 * The planner uses it to decide which tools to offer and how to refuse; the
 * proposal writer uses it again before storing a row; Accept repeats the check
 * against fresh database state. Keeping the rule in one function is what stops
 * the prompt, the card and Accept from disagreeing.
 */
export function toolRefusal(
	definition: AssistantActionDefinition,
	caller: AssistantCaller,
	payload: Record<string, unknown> = {},
): string | null {
	if (definition.platformAdminOnly && !caller.isPlatformAdmin) {
		return platformAdminRefusal(definition);
	}

	const ownerOnly = definition.resolveOwnerOnly?.(payload) ?? definition.ownerOnly === true;
	if (ownerOnly && !caller.isOwner) {
		return ownerRefusal(definition);
	}

	if (definition.tenantAdminOnly && !caller.isTenantAdmin) {
		return tenantAdminRefusal(definition);
	}

	const resolved = definition.resolvePermission?.(payload) ?? null;
	const permission = resolved ?? definition.permission ?? null;
	if (permission && !caller.permissions.has(permission)) {
		return permissionRefusal({ ...definition, permission });
	}

	// Kinds with no named permission (logging a sample) still need a writer.
	if (
		!permission &&
		!definition.platformAdminOnly &&
		definition.requiresWrite !== false &&
		!caller.canWrite
	) {
		return writeRefusal(definition);
	}

	if (definition.validateProposal) {
		const message = definition.validateProposal(payload, caller);
		if (message) return message;
	}

	return null;
}
