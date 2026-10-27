import { ok } from "@/lib/api/envelope";
import { badRequest, notFound, rateLimited } from "@/lib/api/errors";
import { withApi } from "@/lib/api/instrumentation";
import { withAuth } from "@/lib/auth/with-auth";
import { planAgentAction } from "@/lib/chat/agent";
import { looksLikeAction } from "@/lib/chat/agent-intent";
import { buildChatContext } from "@/lib/chat/context";
import { LEGACY_API_SUNSET } from "@/lib/constants";
import { loadGrowthPlanForPond } from "@/lib/growth-plan-loader";
import { reportError } from "@/lib/observability";
import { parsePondProfile } from "@/lib/pond-profile";
import { getActivePond } from "@/lib/pond-selection";
import { checkApiRateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

interface AgentHistoryItem {
	role: "user" | "assistant";
	content: string;
}

export const POST = withApi(
	withAuth(async (request, { ownerId }) => {
		const { success } = await checkApiRateLimit(ownerId);
		if (!success) {
			throw rateLimited("Too many assistant requests. Wait a minute before trying again.", 60);
		}

		let message = "";
		let locale = "en";
		let history: AgentHistoryItem[] = [];
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
							(item): item is AgentHistoryItem =>
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
		if (!looksLikeAction(message)) {
			return ok({ kind: "fallback" });
		}

		const pond = await getActivePond();
		if (!pond) throw notFound("No active pond.");

		const [context, loaded] = await Promise.all([
			buildChatContext(ownerId),
			loadGrowthPlanForPond(pond.id, { ownerId }),
		]);
		const profile = parsePondProfile(pond.notificationPrefs);

		try {
			const result = await planAgentAction({
				message,
				history,
				locale,
				ownerId,
				context,
				plan: loaded?.plan ?? null,
				pondId: pond.id,
				pondName: pond.name,
				areaM2: profile.areaM2,
				averageDepthM: profile.averageDepthM,
			});
			return ok(result);
		} catch (error) {
			// A provider outage is not a client error: answer with the documented
			// fallback so the widget continues with the normal streaming chat.
			reportError(error, { route: "chat/agent" });
			return ok({ kind: "fallback" });
		}
	}),
	// The planner is a non-streaming model completion, so a valid answer easily
	// exceeds the 2 s default guard. The budget matches the other AI route
	// (POST /api/predict-feeding) instead of turning slow answers into a 504.
	{
		route: "POST /api/chat/agent",
		cacheControl: "no-store",
		timeoutMs: 12_000,
		slowMs: 3_000,
		violationMs: 12_000,
		sunset: LEGACY_API_SUNSET,
	},
);
