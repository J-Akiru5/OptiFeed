/**
 * Cheap client/server pre-filter so ordinary questions keep the streaming
 * chat path and only action-shaped messages pay for the structured planner.
 */
export function looksLikeAction(message: string): boolean {
	const text = message.trim();
	if (!text) return false;
	const verb =
		/\b(set|create|start|update|change|apply|move|reschedule|adjust|edit|make|add|log|delete|remove|drop|rotate|revoke|cancel|harvest|archive|restore|assign|unassign|approve|reject|disable|enable|pause|resume)\b/i;
	const subject =
		/\b(cycle|grow[\s-]?out|target|harvest|feeding|feed|plan|schedule|calendar|event|task|sample|biomass|token|device|feeder|member|role|permission|pond|access|organization|account|user)\b/i;
	return verb.test(text) && subject.test(text);
}

/**
 * "Take me to X", "open the members page", "where do I change the schedule".
 * Kept separate from `looksLikeAction` because these requests change nothing;
 * they ask the assistant for a destination.
 */
export function looksLikeNavigation(message: string): boolean {
	const text = message.trim();
	if (!text) return false;
	return (
		/\b(take|bring|lead)\s+me\b/i.test(text) ||
		/\b(go|navigate|jump)\s+to\b/i.test(text) ||
		/\b(open|show)\s+(me\s+)?(the\s+)?[a-z]/i.test(text) ||
		/\bwhere\s+(can|do|is|are|should)\b/i.test(text) ||
		/\bhow\s+do\s+i\s+(get|go|find)\b/i.test(text)
	);
}

/** The minimum an intent check needs from the conversation so far. */
export interface AssistantIntentTurn {
	role: "user" | "assistant";
	content: string;
}

/**
 * A follow-up answer to the assistant's own question ("same day", "3 meals",
 * "now go") is still part of the action it was asking about. Without this the
 * second half of a clarify never reaches the planner and the streaming chat
 * answers as though it had no write access (#344).
 */
function answersAssistantQuestion(text: string, history: readonly AssistantIntentTurn[]): boolean {
	const lastAssistant = [...history]
		.reverse()
		.find((turn) => turn.role === "assistant" && turn.content.trim() !== "");
	if (!lastAssistant) return false;
	const prompt = lastAssistant.content.trim();
	const inviting =
		prompt.includes("?") ||
		/\b(please (provide|tell|give)|i need|tell me|which|what date|how many|confirm)\b/i.test(
			prompt,
		);
	if (!inviting) return false;

	return (
		/^(yes|yeah|yep|ok|okay|sure|go|do it|now go|proceed|confirm|correct|that'?s right|same day)\b/i.test(
			text,
		) ||
		/^\d+(?:[.,]\d+)?\s*(?:g|kg|fish|days?|meals?)\b/i.test(text) ||
		/\b(same day|no repeat|does not repeat|doesn't repeat|deadline|the deadline)\b/i.test(text)
	);
}

/**
 * The broader assistant vocabulary (issue #194): feeding controls, records,
 * device and pond maintenance, invitations and platform actions. A false
 * negative only means the message is answered as a normal question, so this
 * stays conservative — but it must cover every action the catalogue exposes,
 * otherwise a permitted user is told the assistant cannot write (#344).
 */
export function looksLikeAssistantRequest(
	message: string,
	history: readonly AssistantIntentTurn[] = [],
): boolean {
	if (looksLikeAction(message) || looksLikeNavigation(message)) return true;
	const text = message.trim();
	if (!text) return false;

	if (
		/\b(pause|resume|stop)\b[\s\S]*\b(feed|feeding|feeder|schedule)\b/i.test(text) ||
		/\b(feed|dispense)\b[\s\S]*\b(now|them|the fish)\b/i.test(text) ||
		/\b(invite|suspend|restore)\b/i.test(text) ||
		/\b(mark|tick)\b[\s\S]*\b(done|complete)\b/i.test(text) ||
		/\b(grant|revoke)\b[\s\S]*\b(permission|access|admin)\b/i.test(text) ||
		/\b(change|set)\b[\s\S]*\b(role|permission)\b/i.test(text) ||
		/\b(rotate|regenerate|reset)\b[\s\S]*\b(token|credential)\b/i.test(text) ||
		/\b(reveal|show)\b[\s\S]*\b(token|credential)\b/i.test(text) ||
		/\b(revoke|remove|delete)\b[\s\S]*\b(member|teammate|access)\b/i.test(text) ||
		/\b(archive|restore|delete|remove)\b[\s\S]*\bpond\b/i.test(text) ||
		/\b(move|unassign|assign)\b[\s\S]*\b(device|feeder)\b/i.test(text) ||
		/\b(approve|reject)\b[\s\S]*\b(device|feeder)\b/i.test(text) ||
		/\b(disable|enable)\b[\s\S]*\b(user|account)\b/i.test(text) ||
		/\b(stop|end|exit)\b[\s\S]*\bview[\s-]?as\b/i.test(text) ||
		/\b(delete|remove)\b[\s\S]*\b(calendar|event|task|sample|log)\b/i.test(text)
	) {
		return true;
	}

	return answersAssistantQuestion(text, history);
}
