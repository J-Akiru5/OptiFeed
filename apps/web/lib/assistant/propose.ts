import prisma from "@/lib/prisma";
import type { Prisma } from "@prisma/client";
import { toolRefusal } from "./authorize";
import type { AssistantCaller } from "./caller";
import { getAssistantActionDefinition } from "./catalog";
import type { AssistantProposal, AssistantProposalContext, AssistantToolId } from "./types";

/** A proposal that the server refused before it was stored. */
export class AssistantRefusalError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "AssistantRefusalError";
	}
}

/** A proposal lives for ten minutes; after that Accept refuses it. */
export const ASSISTANT_PROPOSAL_TTL_MS = 10 * 60 * 1000;

/**
 * Store one validated action proposal. Nothing is executed here: the row is
 * PENDING until the user presses Accept (issue #194, E10).
 *
 * The caller's permission, owner/admin flags and payload-specific rules are
 * checked here as well as in the planner and Accept. The planner filter keeps
 * the offer honest, but this is the write gate: a future caller cannot store a
 * proposal the session could not carry out.
 */
export async function createAssistantProposal(params: {
	userId: string;
	orgId: string | null;
	pondId: string | null;
	toolId: string;
	payload: Record<string, unknown>;
	context: AssistantProposalContext;
	caller: AssistantCaller;
}): Promise<AssistantProposal> {
	if (params.caller.userId !== params.userId) {
		throw new AssistantRefusalError("Your session changed. Ask me again.");
	}

	const definition = getAssistantActionDefinition(params.toolId);
	if (!definition) throw new Error("Unknown assistant tool.");

	const parsed = definition.schema.parse(params.payload) as Record<string, unknown>;
	const refusal = toolRefusal(definition, params.caller, parsed);
	if (refusal) throw new AssistantRefusalError(refusal);
	const { summary, fields } = definition.describe(parsed, params.context);
	const expiresAt = new Date(Date.now() + ASSISTANT_PROPOSAL_TTL_MS);

	const row = await prisma.assistantAction.create({
		data: {
			userId: params.userId,
			orgId: params.orgId,
			pondId: params.pondId,
			kind: definition.id,
			payload: parsed as Prisma.InputJsonValue,
			summary,
			expiresAt,
		},
		select: { id: true, expiresAt: true },
	});

	return {
		actionId: row.id,
		toolId: definition.id as AssistantToolId,
		summary,
		fields,
		expiresAt: row.expiresAt.toISOString(),
	};
}
