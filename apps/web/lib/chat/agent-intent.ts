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

/**
 * The broader assistant vocabulary (issue #194): feeding controls, records,
 * invitations and platform actions, in addition to the original cycle planner.
 * A false negative only means the message is answered as a normal question, so
 * this stays conservative.
 */
export function looksLikeAssistantRequest(message: string): boolean {
	if (looksLikeAction(message) || looksLikeNavigation(message)) return true;
	const text = message.trim();
	if (!text) return false;
	return (
		/\b(pause|resume|stop)\b[\s\S]*\b(feed|feeding|feeder|schedule)\b/i.test(text) ||
		/\b(feed|dispense)\b[\s\S]*\b(now|them|the fish)\b/i.test(text) ||
		/\b(invite|suspend|restore)\b/i.test(text) ||
		/\bmark\b[\s\S]*\b(done|complete)\b/i.test(text) ||
		/\b(grant|revoke)\b[\s\S]*\b(permission|access)\b/i.test(text) ||
		/\b(change|set)\b[\s\S]*\b(role|permission)\b/i.test(text)
	);
}
