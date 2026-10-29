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

export function permissionRefusal(definition: AssistantActionDefinition): string {
	return `You need the "${definition.permission ?? "required"}" permission to ${actionPhrase(definition.label)}. Ask an organization admin to grant it.`;
}

/** A caller with no write access (for a kind that has no named permission). */
export function writeRefusal(definition: AssistantActionDefinition): string {
	return `You have read-only access, so you cannot ${actionPhrase(definition.label)}.`;
}

/** The row stays PENDING, so the user can re-enter their password and Accept again. */
export function stepUpRefusal(definition: AssistantActionDefinition): string {
	return `Re-enter your password to ${actionPhrase(definition.label)}. This action needs a fresh 5-minute check.`;
}
