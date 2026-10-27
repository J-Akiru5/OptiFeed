import type { AssistantCaller } from "./caller";
import { ASSISTANT_ACTION_DEFINITIONS } from "./catalog";
import type { AssistantActionDefinition, AssistantToolId } from "./types";

/**
 * The tools a caller may be offered.
 *
 * This is the outer gate, and it is deliberately conservative: a role never
 * sees a kind it could not carry out, so the model cannot propose an admin
 * action to a farmer or a tenant action to a platform admin without the
 * corresponding permission. Accept re-checks all of this anyway (see
 * `lib/assistant/accept.ts`); this filter only keeps the offer honest.
 */
export function availableToolIds(caller: AssistantCaller): AssistantToolId[] {
	const ids: AssistantToolId[] = [];
	for (const definition of Object.values(ASSISTANT_ACTION_DEFINITIONS)) {
		if (definition.platformAdminOnly && !caller.isPlatformAdmin) continue;
		if (definition.tenantAdminOnly && !caller.isTenantAdmin) continue;
		if (definition.permission && !caller.permissions.has(definition.permission)) continue;
		// Kinds with no permission gate (logging a sample) still need a writer.
		if (!definition.permission && !definition.platformAdminOnly && !caller.canWrite) continue;
		ids.push(definition.id);
	}
	return ids;
}

export function availableDefinitions(caller: AssistantCaller): AssistantActionDefinition[] {
	return availableToolIds(caller).map((id) => ASSISTANT_ACTION_DEFINITIONS[id]);
}

/** The tool section of the planner prompt. Ids and parameter shapes only. */
export function describeToolsForPrompt(caller: AssistantCaller): string {
	const definitions = availableDefinitions(caller);
	if (definitions.length === 0) {
		return "(This caller has no actions available. Use navigate, clarify or answer.)";
	}
	return definitions
		.map(
			(definition) =>
				`- ${definition.id} — ${definition.description}\n  args: ${definition.params}`,
		)
		.join("\n");
}
