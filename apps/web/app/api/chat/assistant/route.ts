import { ok } from "@/lib/api/envelope";
import { badRequest, rateLimited, unauthorized } from "@/lib/api/errors";
import { withApi } from "@/lib/api/instrumentation";
import { getAssistantCaller } from "@/lib/assistant/caller";
import { assistantToday } from "@/lib/assistant/catalog";
import { decideAssistantTurn } from "@/lib/assistant/planner";
import { createAssistantProposal } from "@/lib/assistant/propose";
import { buildAssistantTurnData } from "@/lib/assistant/turn-context";
import { withAuth } from "@/lib/auth/with-auth";
import { looksLikeAssistantRequest } from "@/lib/chat/agent-intent";
import { createNamespaceTranslator } from "@/lib/chat/fallback";
import { LEGACY_API_SUNSET } from "@/lib/constants";
import { checkApiRateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

interface AssistantHistoryItem {
	role: "user" | "assistant";
	content: string;
}

/**
 * The assistant turn endpoint (issue #194).
 *
 * Returns one of: a stored action proposal (Accept/Reject follows), a
 * navigation destination, a clarifying question, or `fallback` so the client
 * continues with the normal streaming chat. Nothing is executed here.
 */
export const POST = withApi(
	withAuth(async (request, { ownerId }) => {
		const { success } = await checkApiRateLimit(ownerId);
		if (!success) {
			throw rateLimited("Too many assistant requests. Wait a minute before trying again.", 60);
		}

		let message = "";
		let locale = "en";
		let history: AssistantHistoryItem[] = [];
		try {
			const body = (await request.json()) as {
				message?: unknown;
				locale?: unknown;
				history?: unknown;
			};
			message = typeof body.message === "string" ? body.message.slice(0, 2000) : "";
			locale = body.locale === "hil" ? "hil" : "en";
			history = Array.isArray(body.history)
				? body.history
						.filter(
							(item): item is AssistantHistoryItem =>
								!!item &&
								typeof item === "object" &&
								((item as { role?: unknown }).role === "user" ||
									(item as { role?: unknown }).role === "assistant") &&
								typeof (item as { content?: unknown }).content === "string",
						)
						.slice(-8)
				: [];
		} catch {
			throw badRequest("Invalid assistant request.");
		}
		if (!message.trim()) throw badRequest("Message is required.");
		if (!looksLikeAssistantRequest(message, history)) {
			return ok({ kind: "fallback" });
		}

		const caller = await getAssistantCaller();
		if (!caller) throw unauthorized();

		const data = await buildAssistantTurnData(locale, caller);
		const decision = await decideAssistantTurn({
			message,
			history,
			caller,
			context: data.turn,
			userId: caller.userId,
			today: assistantToday(),
		});

		const t = createNamespaceTranslator(locale, "chat");

		if (decision.kind === "propose") {
			const proposal = await createAssistantProposal({
				userId: caller.userId,
				orgId: data.orgId,
				pondId: data.pondId,
				toolId: decision.toolId,
				payload: decision.payload,
				context: data.proposal,
			});
			return ok({
				kind: "action",
				...proposal,
				text: t("assistantProposal"),
			});
		}

		if (decision.kind === "navigate") {
			return ok({
				kind: "navigate",
				route: decision.entry.route,
				target: decision.entry.target ?? null,
				label: decision.entry.label,
				text: t("assistantNavigating", { label: decision.entry.label }),
			});
		}

		if (decision.kind === "clarify") {
			return ok({ kind: "clarify", text: decision.text });
		}

		return ok({ kind: "fallback" });
	}),
	// The planner is a non-streaming model completion, so a valid answer easily
	// exceeds the 2 s default guard. The budget matches the other AI route
	// (POST /api/predict-feeding) instead of turning slow answers into a 504.
	{
		route: "POST /api/chat/assistant",
		cacheControl: "no-store",
		timeoutMs: 12_000,
		slowMs: 3_000,
		violationMs: 12_000,
		sunset: LEGACY_API_SUNSET,
	},
);
