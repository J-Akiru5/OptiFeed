// OpenCode Go AI client (OpenAI-compatible). Primary provider: DeepSeek V4.1
// Flash with reasoning enabled by default.
//
// OpenCode Go requires every request to carry a stable per-conversation
// `x-opencode-session` header; requests without it are rejected with HTTP 400
// (MissingSessionID). Routing and prompt caching key off that value, so callers
// should derive it from something stable for the conversation (farm id plus the
// opening message, or a per-day bucket for one-shot predictions).

const API_URL = "https://opencode.ai/inference/go/openai/v1/chat/completions";
const DEFAULT_MODEL = "deepseek-v4.1-flash";
const DEFAULT_REASONING_EFFORT = "high";

// Go asks clients to identify themselves rather than sending a generic SDK UA.
const USER_AGENT = "optifeed/1.0";

// Read env lazily (not captured at module load) so tests and runtime config
// changes are picked up without a process restart.
function getApiKey(): string | undefined {
	return process.env.OPENCODE_GO_API_KEY;
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
	return process.env.OPENCODE_GO_MODEL ?? DEFAULT_MODEL;
}

// "none" disables the reasoning param entirely; anything else is passed through
// to OpenCode Go. Defaults to "high" per product decision — override via env
// without a deploy if latency/cost needs to come down.
export function getReasoningEffort(): ReasoningEffort {
	const raw = (process.env.OPENCODE_GO_REASONING_EFFORT ?? DEFAULT_REASONING_EFFORT).toLowerCase();
	if (raw === "none" || raw === "off" || raw === "disabled") return "none";
	if (raw === "low") return "low";
	if (raw === "medium") return "medium";
	return "high";
}

// Deterministic, collision-resistant-enough session id for the
// `x-opencode-session` header. FNV-1a keeps this dependency-free and stable
// across processes, which matters because the value is a routing/caching hint.
export function stableSessionId(...parts: (string | number | null | undefined)[]): string {
	const input = parts
		.filter((p) => p !== null && p !== undefined && p !== "")
		.map(String)
		.join("\u0000");
	let hash = 0x811c9dc5;
	for (let i = 0; i < input.length; i += 1) {
		hash ^= input.charCodeAt(i);
		hash = Math.imul(hash, 0x01000193);
	}
	return `optifeed-${(hash >>> 0).toString(36)}`;
}

// Single source of truth for diagnostics (route logging + debug endpoint).
// Never exposes the full key.
export function aiDebugInfo() {
	return {
		provider: "opencode-go",
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

function requestHeaders(sessionId: string): Record<string, string> {
	return {
		"Content-Type": "application/json",
		Authorization: `Bearer ${getApiKey()}`,
		"User-Agent": USER_AGENT,
		"x-opencode-session": sessionId,
	};
}

// Streams an AI reply token-by-token (answer text only — reasoning/thinking
// deltas are consumed server-side and not surfaced). Returns nothing (empty
// generator) when no API key is configured, so callers can fall back to the
// keyword assistant.
export async function* streamAi(
	turns: AiTurn[],
	systemPrompt: string,
	sessionId: string,
): AsyncGenerator<string> {
	if (!isAiEnabled()) return;

	const response = await fetch(API_URL, {
		method: "POST",
		headers: requestHeaders(sessionId),
		body: JSON.stringify(buildBody(turns, systemPrompt, true)),
		signal: AbortSignal.timeout(120_000),
	});

	if (!response.ok || !response.body) {
		const error = new Error(`OpenCode Go HTTP ${response.status}: ${response.statusText}`);
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
					choices?: { delta?: { content?: string; reasoning_content?: string } }[];
				};
				// Reasoning deltas arrive in `reasoning_content`; only surface the
				// answer text so thinking stays server-side.
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
	sessionId: string,
): Promise<{ content: string; reasoning: string | null } | null> {
	if (!isAiEnabled()) return null;

	const response = await fetch(API_URL, {
		method: "POST",
		headers: requestHeaders(sessionId),
		body: JSON.stringify(buildBody(turns, systemPrompt, false)),
		signal: AbortSignal.timeout(60_000),
	});

	if (!response.ok) {
		const error = new Error(`OpenCode Go HTTP ${response.status}: ${response.statusText}`);
		(error as { status?: number }).status = response.status;
		throw error;
	}

	const data = (await response.json()) as {
		choices?: {
			message?: {
				content?: string | null;
				reasoning_content?: string | null;
			};
		}[];
	};

	const message = data.choices?.[0]?.message;
	const content = message?.content ?? "";
	const reasoning = message?.reasoning_content?.trim() || null;

	return { content, reasoning };
}
