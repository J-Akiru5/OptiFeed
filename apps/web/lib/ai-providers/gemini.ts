// Gemini adapter (Google Generative Language REST API).
//
// Deliberately dependency-free: the old lib/gemini.ts used the
// @google/generative-ai SDK, which was removed with the provider switch. Calling
// the REST API directly avoids re-adding a package for one provider.
//
// Gemini is not OpenAI-compatible: it uses `systemInstruction` and `contents`
// (role "user" | "model"), and returns `candidates[].content.parts[].text`.

import { scrubText } from "@/lib/error-scrub";
import type { AiHttpError, AiProvider, CompletionResult, ProviderRequest } from "./types";

const BASE_URL = "https://generativelanguage.googleapis.com/v1beta/models";
const MAX_ERROR_DETAIL = 200;

function endpoint(
	model: string,
	method: "generateContent" | "streamGenerateContent",
	stream: boolean,
) {
	const suffix = stream ? "?alt=sse" : "";
	return `${BASE_URL}/${model}:${method}${suffix}`;
}

function buildBody(request: ProviderRequest) {
	const { turns, systemPrompt } = request;
	return {
		systemInstruction: { parts: [{ text: systemPrompt }] },
		contents: turns.map((t) => ({
			role: t.role === "assistant" ? "model" : "user",
			parts: [{ text: t.text }],
		})),
	};
}

function requestHeaders(apiKey: string) {
	return {
		"Content-Type": "application/json",
		"x-goog-api-key": apiKey,
	};
}

function httpError(response: Response, detail: string): AiHttpError {
	// The adapter error reaches console/error capture. Bound the upstream body
	// and scrub credentials: an upstream message must never carry a key value.
	const safeDetail = scrubText(detail).slice(0, MAX_ERROR_DETAIL);
	const error = new Error(
		`Gemini HTTP ${response.status}: ${safeDetail || response.statusText}`,
	) as AiHttpError;
	error.status = response.status;
	return error;
}

interface GeminiCandidate {
	content?: { parts?: { text?: string }[] };
	finishReason?: string;
}

function textFromCandidate(candidate: GeminiCandidate | undefined): string {
	if (!candidate?.content?.parts) return "";
	return candidate.content.parts.map((p) => p.text ?? "").join("");
}

export const geminiProvider: AiProvider = {
	id: "gemini",
	label: "Google Gemini",
	defaultModel: "gemini-2.5-flash",
	defaultApiKeyEnv: "GEMINI_API_KEY",

	async *stream(request: ProviderRequest): AsyncGenerator<string> {
		if (!request.config.apiKey) return;

		const response = await fetch(endpoint(request.config.model, "streamGenerateContent", true), {
			method: "POST",
			headers: requestHeaders(request.config.apiKey),
			body: JSON.stringify(buildBody(request)),
			signal: AbortSignal.timeout(request.timeoutMs ?? 120_000),
		});

		if (!response.ok || !response.body) {
			const detail = await response.text().catch(() => "");
			throw httpError(response, detail);
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
					const parsed = JSON.parse(payload) as { candidates?: GeminiCandidate[] };
					const text = textFromCandidate(parsed.candidates?.[0]);
					if (text) yield text;
				} catch {
					// Ignore malformed keep-alive lines.
				}
			}
		}
	},

	async complete(request: ProviderRequest): Promise<CompletionResult | null> {
		if (!request.config.apiKey) return null;

		const response = await fetch(endpoint(request.config.model, "generateContent", false), {
			method: "POST",
			headers: requestHeaders(request.config.apiKey),
			body: JSON.stringify(buildBody(request)),
			signal: AbortSignal.timeout(request.timeoutMs ?? 60_000),
		});

		if (!response.ok) {
			const detail = await response.text().catch(() => "");
			throw httpError(response, detail);
		}

		const data = (await response.json()) as { candidates?: GeminiCandidate[] };
		return {
			content: textFromCandidate(data.candidates?.[0]),
			// Gemini does not expose reasoning text on this endpoint.
			reasoning: null,
		};
	},
};
