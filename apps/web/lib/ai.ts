// OpenRouter AI client (OpenAI-compatible). Primary provider: DeepSeek V4.1
// Flash with reasoning enabled by default. Replaces the old Gemini integration.

const API_URL = "https://openrouter.ai/api/v1/chat/completions";
const DEFAULT_MODEL = "deepseek/deepseek-v4.1-flash";
const DEFAULT_REASONING_EFFORT = "high";

// Read env lazily (not captured at module load) so tests and runtime config
// changes are picked up without a process restart.
function getApiKey(): string | undefined {
	return process.env.OPENROUTER_API_KEY;
}

export type ReasoningEffort = "none" | "low" | "medium" | "high";

export interface AiTurn {
	role: "user" | "assistant";
	text: string;
}

export function isAiEnabled(): boolean {
	return !!getApiKey();
}

export function getAiModelId(): string {
	return process.env.OPENROUTER_MODEL ?? DEFAULT_MODEL;
}

// "none" disables the reasoning param entirely; anything else is passed through
// to OpenRouter. Defaults to "high" per product decision — override via env
// without a deploy if latency/cost needs to come down.
export function getReasoningEffort(): ReasoningEffort {
	const raw = (process.env.OPENROUTER_REASONING_EFFORT ?? DEFAULT_REASONING_EFFORT).toLowerCase();
	if (raw === "none" || raw === "off" || raw === "disabled") return "none";
	if (raw === "low") return "low";
	if (raw === "medium") return "medium";
	return "high";
}

// Single source of truth for diagnostics (route logging + debug endpoint).
// Never exposes the full key.
export function aiDebugInfo() {
	return {
		hasKey: isAiEnabled(),
		nodeEnv: process.env.NODE_ENV ?? "unknown",
		model: getAiModelId(),
		reasoningEffort: getReasoningEffort(),
	};
}

// Returns true when the error is a quota/rate-limit/credit failure we should
// silently fall back from. Any other error is re-thrown by callers' catch.
export function isAiQuotaError(error: unknown): boolean {
	const status = (error as { status?: number }).status;
	const message = String((error as { message?: string }).message ?? "");
	return (
		status === 429 ||
		message.includes("429") ||
		message.includes("rate limit") ||
		message.includes("Rate limit") ||
		message.includes("insufficient credit") ||
		message.includes("quota")
	);
}

function buildBody(turns: AiTurn[], systemPrompt: string, stream: boolean) {
	const messages = [
		{ role: "system", content: systemPrompt },
		...turns.map((t) => ({ role: t.role, content: t.text })),
	];
	const effort = getReasoningEffort();
	return {
		model: getAiModelId(),
		messages,
		stream,
		// Reasoning models think by default; pin effort explicitly so behavior
		// is stable across provider defaults.
		...(effort !== "none" ? { reasoning: { effort } } : {}),
	};
}

function requestHeaders(): Record<string, string> {
	return {
		"Content-Type": "application/json",
		Authorization: `Bearer ${getApiKey()}`,
		// Optional attribution headers — lets the app show up on OpenRouter boards.
		"HTTP-Referer": process.env.OPENROUTER_SITE_URL ?? "https://optifeed.app",
		"X-Title": "OptiFeed",
	};
}

// Streams an AI reply token-by-token (answer text only — reasoning/thinking
// deltas are consumed server-side and not surfaced). Returns nothing (empty
// generator) when no API key is configured, so callers can fall back to the
// keyword assistant.
export async function* streamAi(turns: AiTurn[], systemPrompt: string): AsyncGenerator<string> {
	if (!isAiEnabled()) return;

	const response = await fetch(API_URL, {
		method: "POST",
		headers: requestHeaders(),
		body: JSON.stringify(buildBody(turns, systemPrompt, true)),
		signal: AbortSignal.timeout(120_000),
	});

	if (!response.ok || !response.body) {
		const error = new Error(`OpenRouter HTTP ${response.status}: ${response.statusText}`);
		(error as { status?: number }).status = response.status;
		throw error;
	}

	const reader = response.body.getReader();
	const decoder = new TextDecoder();
	let buffer = "";

	while (true) {
		const { done, value } = await reader.read();
		if (done) break;
		buffer += decoder.decode(value, { stream: true });

		const lines = buffer.split("\n");
		buffer = lines.pop() ?? "";

		for (const line of lines) {
			const trimmed = line.trim();
			if (!trimmed.startsWith("data:")) continue;
			const payload = trimmed.slice(5).trim();
			if (!payload || payload === "[DONE]") continue;
			try {
				const parsed = JSON.parse(payload) as {
					choices?: { delta?: { content?: string } }[];
				};
				const text = parsed.choices?.[0]?.delta?.content;
				if (text) yield text;
			} catch {
				// Ignore malformed keep-alive/heartbeat lines.
			}
		}
	}
}

// Non-streaming completion — used by the prediction engine for structured JSON.
// Returns null when no API key is configured.
export async function completeAi(
	turns: AiTurn[],
	systemPrompt: string,
): Promise<{ content: string; reasoning: string | null } | null> {
	if (!isAiEnabled()) return null;

	const response = await fetch(API_URL, {
		method: "POST",
		headers: requestHeaders(),
		body: JSON.stringify(buildBody(turns, systemPrompt, false)),
		signal: AbortSignal.timeout(60_000),
	});

	if (!response.ok) {
		const error = new Error(`OpenRouter HTTP ${response.status}: ${response.statusText}`);
		(error as { status?: number }).status = response.status;
		throw error;
	}

	const data = (await response.json()) as {
		choices?: {
			message?: {
				content?: string | null;
				reasoning_details?: { text?: string }[];
			};
		}[];
	};

	const message = data.choices?.[0]?.message;
	const content = message?.content ?? "";
	const reasoning =
		message?.reasoning_details
			?.map((d) => d.text ?? "")
			.join("")
			.trim() || null;

	return { content, reasoning };
}
