/**
 * Cheap client/server pre-filter so ordinary questions keep the streaming
 * chat path and only action-shaped messages pay for the structured planner.
 */
export function looksLikeAction(message: string): boolean {
	const text = message.trim();
	if (!text) return false;
	const verb =
		/\b(set|create|start|update|change|apply|move|reschedule|adjust|edit|make|add|log|delete|cancel|harvest)\b/i;
	const subject =
		/\b(cycle|grow[\s-]?out|target|harvest|feeding|feed|plan|schedule|calendar|event|sample)\b/i;
	return verb.test(text) && subject.test(text);
}
