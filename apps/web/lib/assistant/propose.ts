import prisma from "@/lib/prisma";
import type { Prisma } from "@prisma/client";
import { getAssistantActionDefinition } from "./catalog";
import type { AssistantProposal, AssistantProposalContext, AssistantToolId } from "./types";

/** A proposal lives for ten minutes; after that Accept refuses it. */
export const ASSISTANT_PROPOSAL_TTL_MS = 10 * 60 * 1000;

/**
 * Store one validated action proposal. Nothing is executed here: the row is
 * PENDING until the user presses Accept (issue #194, E10).
 */
export async function createAssistantProposal(params: {
	userId: string;
	orgId: string | null;
	pondId: string | null;
	toolId: string;
	payload: Record<string, unknown>;
	context: AssistantProposalContext;
}): Promise<AssistantProposal> {
	const definition = getAssistantActionDefinition(params.toolId);
	if (!definition) throw new Error("Unknown assistant tool.");

	const parsed = definition.schema.parse(params.payload) as Record<string, unknown>;
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
