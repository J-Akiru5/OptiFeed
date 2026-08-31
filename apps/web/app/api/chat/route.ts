import { farmIdFromEmail } from "@/lib/auth/session";
import { buildChatContext } from "@/lib/chat/context";
import { createNamespaceTranslator, runFallbackIntent } from "@/lib/chat/fallback";
import { buildSystemPrompt, enforcePromptLimit, sanitizeInput } from "@/lib/chat/prompt";
import { geminiDebugInfo, isGeminiEnabled, isGeminiQuotaError, streamGemini } from "@/lib/gemini";
import { checkApiRateLimit } from "@/lib/rate-limit";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

interface ChatHistoryItem {
	role: "user" | "assistant";
	content: string;
}

const encoder = new TextEncoder();

function sse(text: string): Uint8Array {
	return encoder.encode(`data: ${JSON.stringify({ text })}\n\n`);
}

export async function POST(request: Request) {
	const supabase = await createClient();
	const {
		data: { user },
	} = await supabase.auth.getUser();

	if (!user?.email) {
		return new Response("Unauthorized", { status: 401 });
	}

	const ownerId = farmIdFromEmail(user.email);
	if (!ownerId) {
		return new Response("Unauthorized", { status: 401 });
	}

	// Rate limit: 30 requests per 60 seconds per user
	const { success } = checkApiRateLimit(ownerId);
	if (!success) {
		return new Response("Too Many Requests", { status: 429 });
	}

	let locale = "en";
	let history: ChatHistoryItem[] = [];
	try {
		const body = (await request.json()) as { locale?: string; history?: ChatHistoryItem[] };
		locale = body.locale === "hil" ? "hil" : "en";
		history = Array.isArray(body.history)
			? body.history.filter((m) => m && typeof m.content === "string")
			: [];
	} catch {
		return new Response("Bad Request", { status: 400 });
	}

	// Keep the conversation window bounded to the most recent turns.
	history = history.slice(-20);

	// Enforce per-message length limit to prevent prompt injection.
	const MAX_MSG_LEN = 2000;
	history = history.map((m) => ({
		...m,
		content: m.content.slice(0, MAX_MSG_LEN),
	}));

	const stream = new ReadableStream<Uint8Array>({
		async start(controller) {
			const push = (text: string) => controller.enqueue(sse(text));
			const t = createNamespaceTranslator(locale, "chat");

			try {
				const ctx = await buildChatContext(ownerId);
				const systemPrompt = buildSystemPrompt(ctx, locale);

				if (isGeminiEnabled() && history.length > 0) {
					// First log line on any chat call: which model is requested and
					// whether a key exists, so a silent fallback is always traceable.
					console.log("[chat-debug]", geminiDebugInfo());

					const turns = history
						.map((m) => ({
							role: m.role === "assistant" ? ("model" as const) : ("user" as const),
							text: m.content,
						}))
						.filter((m) => m.text.trim().length > 0);

					// Gemini expects the conversation to start with a user turn;
					// drop any leading assistant/model turns (e.g. the intro).
					const firstUserIndex = turns.findIndex((m) => m.role === "user");
					const normalizedTurns = firstUserIndex > 0 ? turns.slice(firstUserIndex) : turns;

					if (normalizedTurns.length > 0) {
						try {
							let sentAny = false;
							for await (const chunk of streamGemini(normalizedTurns, systemPrompt)) {
								push(chunk);
								sentAny = true;
							}
							if (sentAny) {
								return;
							}
						} catch (error) {
							// Always log the real failure (auth/quota/network + model)
							// before falling back — never swallow it silently.
							console.error(
								"[chat-debug] gemini call failed, falling back:",
								{
									model: geminiDebugInfo().model,
									reason: isGeminiQuotaError(error) ? "quota" : "error",
								},
								error,
							);
						}
					}
				}

				// Fallback: keyword intents (no API key, quota exceeded, or empty history).
				const reply = await runFallbackIntent({
					message: history[history.length - 1]?.content ?? "",
					locale,
					ownerId,
					ctx,
				});
				push(reply);
			} catch (error) {
				console.error("[Chat] Route error:", error);
				push(t("serverError"));
			} finally {
				controller.close();
			}
		},
	});

	return new Response(stream, {
		headers: {
			"Content-Type": "text/event-stream; charset=utf-8",
			"Cache-Control": "no-cache, no-transform",
			Connection: "keep-alive",
			"X-Accel-Buffering": "no",
		},
	});
}
