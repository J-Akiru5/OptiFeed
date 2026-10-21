import { GoogleGenerativeAI } from "@google/generative-ai";

const apiKey = process.env.GEMINI_API_KEY;

export function isGeminiEnabled(): boolean {
	return !!apiKey;
}

// Resolves the model to use. Defaults to gemini-2.5-flash (gemini-2.0-flash has
// zero free-tier quota on some keys) and can be swapped via GEMINI_MODEL without
// a code deploy — free-tier allocations shift per model over time.
export function getGeminiModelId(): string {
	return process.env.GEMINI_MODEL ?? "gemini-2.5-flash";
}

export function getGeminiClient(): GoogleGenerativeAI | null {
	return apiKey ? new GoogleGenerativeAI(apiKey) : null;
}

// Single source of truth for diagnostics (route logging + debug endpoint).
// Never exposes the full key — only a 6-char prefix.
export function geminiDebugInfo() {
	return {
		hasKey: isGeminiEnabled(),
		nodeEnv: process.env.NODE_ENV ?? "unknown",
		model: getGeminiModelId(),
	};
}

// Returns true when the error is a quota/rate-limit failure we should silently
// fall back from (429 / RESOURCE_EXHAUSTED). Any other error is re-thrown.
export function isGeminiQuotaError(error: unknown): boolean {
	const status = (error as { status?: number }).status;
	const message = String((error as { message?: string }).message ?? "");
	return (
		status === 429 ||
		message.includes("429") ||
		message.includes("RESOURCE_EXHAUSTED") ||
		message.includes("exceeded your current quota")
	);
}

interface ChatTurn {
	role: "user" | "model";
	text: string;
}

// Streams a Gemini reply token-by-token. Returns nothing (empty generator) when
// no API key is configured, so callers can fall back to the keyword assistant.
export async function* streamGemini(
	turns: ChatTurn[],
	systemInstruction: string,
): AsyncGenerator<string> {
	if (!apiKey) return;

	const genAI = new GoogleGenerativeAI(apiKey);
	const model = genAI.getGenerativeModel({
		model: getGeminiModelId(),
		systemInstruction,
	});

	const result = await model.generateContentStream({
		contents: turns.map((t) => ({
			role: t.role,
			parts: [{ text: t.text }],
		})),
	});

	for await (const chunk of result.stream) {
		const text = chunk.text();
		if (text) yield text;
	}
}
