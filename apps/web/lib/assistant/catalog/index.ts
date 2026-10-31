import { todayDateOnly } from "@/lib/crop-cycle/dates";
import type { AssistantActionDefinition, AssistantToolId } from "../types";
import { adminActions } from "./admin";
import { feedingActions } from "./feeding";
import { pondsActions } from "./ponds";
import { recordsActions } from "./records";
import { superadminActions } from "./superadmin";

/**
 * The server-side tool catalogue for the assistant (issue #194, E10).
 *
 * Every entry wraps an **existing** server action. There is deliberately no
 * write logic here: the assistant must inherit the same permission checks,
 * caps, offline/fallow blocks, rate limits and audit rows as the button a
 * person would press.
 *
 * The entries are grouped by the screen they belong to (`feeding`, `records`,
 * `ponds`, `admin`, `superadmin`) so that each file stays inside the per-file
 * complexity budget; this module composes them into the single record the
 * assistant, the planner and Accept all read.
 */

export const ASSISTANT_ACTION_DEFINITIONS: Record<AssistantToolId, AssistantActionDefinition> = {
	...feedingActions,
	...recordsActions,
	...pondsActions,
	...adminActions,
	...superadminActions,
};

export type { AssistantActionDefinition, AssistantToolId } from "../types";

export function getAssistantActionDefinition(id: string): AssistantActionDefinition | null {
	// Own-property check: a plain record lookup also resolves inherited members,
	// so a caller-supplied id such as "toString" or "constructor" would return a
	// function instead of null and violate the return type.
	if (!Object.hasOwn(ASSISTANT_ACTION_DEFINITIONS, id)) return null;
	return (ASSISTANT_ACTION_DEFINITIONS as Record<string, AssistantActionDefinition>)[id] ?? null;
}

/** Today in farm time, exported for the planner prompt. */
export function assistantToday(): string {
	return todayDateOnly();
}
