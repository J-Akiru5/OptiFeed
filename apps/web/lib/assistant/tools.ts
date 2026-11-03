import { toolRefusal } from "./authorize";
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
		if (definition.availableTo && !definition.availableTo(caller)) continue;
		if (toolRefusal(definition, caller) !== null) continue;
		ids.push(definition.id);
	}
	return ids;
}

export function availableDefinitions(caller: AssistantCaller): AssistantActionDefinition[] {
	return availableToolIds(caller).map((id) => ASSISTANT_ACTION_DEFINITIONS[id]);
}

/**
 * The tools the caller may not use, each with the exact sentence the planner
 * should say instead of proposing it. The model cannot name the required role
 * for a tool it never sees, so this list is what makes refusals specific.
 */
export function describeUnavailableToolsForPrompt(caller: AssistantCaller): string {
	const available = new Set(availableToolIds(caller));
	const lines: string[] = [];
	for (const definition of Object.values(ASSISTANT_ACTION_DEFINITIONS)) {
		if (available.has(definition.id)) continue;
		const reason = toolRefusal(definition, caller);
		if (reason) lines.push(`- ${definition.id} — ${reason}`);
	}
	return lines.length > 0 ? lines.join("\n") : "(none)";
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
