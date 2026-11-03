import type { Permission } from "@/lib/auth/permissions";
import type { AssistantActionDefinition } from "./types";

/**
 * One vocabulary for assistant refusals (issue #344).
 *
 * The planner, the proposal card and Accept all have to say the same thing:
 * a missing permission, a missing tenant/platform role, a read-only session and
 * a missing step-up are different problems with different next steps. Keeping
 * the sentences here stops the three call sites drifting apart, and makes the
 * refusal name the action the user asked for instead of "that".
 */

/** "Change a member role" -> "change a member role", for a sentence predicate. */
function actionPhrase(label: string | undefined): string {
	const trimmed = label?.trim() ?? "";
	return trimmed ? `${trimmed[0]?.toLowerCase() ?? ""}${trimmed.slice(1)}` : "do that";
}

export function platformAdminRefusal(definition: AssistantActionDefinition): string {
	return `Only a platform admin can ${actionPhrase(definition.label)}.`;
}

export function tenantAdminRefusal(definition: AssistantActionDefinition): string {
	return `Only an organization owner or admin can ${actionPhrase(definition.label)}.`;
}

export function ownerRefusal(definition: AssistantActionDefinition): string {
	return `Only an organization owner can ${actionPhrase(definition.label)}.`;
}

/**
 * The role that normally holds a permission. Permissions can be granted or
 * revoked per membership, so the refusal names this as a hint rather than a
 * hard role rule; the permission itself is the gate.
 */
const PERMISSION_ROLE_HINT: Record<Permission, string> = {
	view_dashboard: "any member",
	view_reports: "any member",
	manage_members: "an organization owner",
	manage_farms_ponds: "an organization owner or admin",
	manage_schedule: "an operator or above",
	manage_crop_cycle: "an operator or above",
	claim_feeder: "an operator or above",
	control_feeder: "an operator or above",
	record_dispatch: "an operator or above",
	view_billing: "an organization owner or admin",
};

export function permissionRefusal(definition: AssistantActionDefinition): string {
	const permission = definition.permission;
	const hint = permission ? PERMISSION_ROLE_HINT[permission] : null;
	const scope = hint ? ` (normally ${hint})` : "";
	return `You need the "${permission ?? "required"}" permission${scope} to ${actionPhrase(definition.label)}. Ask an organization admin to grant it.`;
}

/** A caller with no write access (for a kind that has no named permission). */
export function writeRefusal(definition: AssistantActionDefinition): string {
	return `You have read-only access, so you cannot ${actionPhrase(definition.label)}.`;
}

/** The row stays PENDING, so the user can re-enter their password and Accept again. */
export function stepUpRefusal(definition: AssistantActionDefinition): string {
	return `Re-enter your password to ${actionPhrase(definition.label)}. This action needs a fresh 5-minute check.`;
}
