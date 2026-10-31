// Generic OpenAI-compatible adapter (issue #432).
//
// One adapter covers the many vendors that expose the OpenAI chat-completions
// shape: OpenAI, Groq, DeepSeek, Moonshot/Kimi, GLM/Zhipu, OpenRouter, Together
// and self-hosted gateways. The base URL, model and key come from the
// AiProviderConfig row, so adding a vendor is a console action rather than a
// code change.
//
// Deliberately plain: only `model`, `messages` and `stream` are sent. Vendor
// extensions such as OpenRouter's `reasoning` object are not included, because
// a strict OpenAI server rejects unknown fields.

import type { AiHttpError, AiProvider, CompletionResult, ProviderRequest } from "./types";
import { chatCompletionsUrl } from "./url-safety";

const USER_AGENT = "optifeed/1.0";

function requireBaseUrl(request: ProviderRequest): string {
	const baseUrl = request.config.baseUrl?.trim();
	if (!baseUrl) {
		const error = new Error("OpenAI-compatible provider has no base URL.") as AiHttpError;
		error.status = 500;
		throw error;
	}
	return chatCompletionsUrl(baseUrl);
}

function buildBody(request: ProviderRequest, stream: boolean) {
	return {
		model: request.config.model,
		messages: [
			{ role: "system", content: request.systemPrompt },
			...request.turns.map((turn) => ({ role: turn.role, content: turn.text })),
		],
		stream,
	};
}

function requestHeaders(apiKey: string) {
	return {
		"Content-Type": "application/json",
		Authorization: `Bearer ${apiKey}`,
		"User-Agent": USER_AGENT,
	};
}

function httpError(response: Response): AiHttpError {
	const error = new Error(
		`Provider HTTP ${response.status}: ${response.statusText}`,
	) as AiHttpError;
	error.status = response.status;
	return error;
}

export const openAiCompatibleProvider: AiProvider = {
	id: "openai-compatible",
	label: "OpenAI-compatible",
	defaultModel: "gpt-4o-mini",
	defaultApiKeyEnv: "OPENAI_API_KEY",

	async *stream(request: ProviderRequest): AsyncGenerator<string> {
		if (!request.config.apiKey) return;

		const response = await fetch(requireBaseUrl(request), {
			method: "POST",
			headers: requestHeaders(request.config.apiKey),
			body: JSON.stringify(buildBody(request, true)),
			signal: AbortSignal.timeout(120_000),
		});

		if (!response.ok || !response.body) throw httpError(response);

		const reader = response.body.getReader();
		const decoder = new TextDecoder();
		let buffer = "";

		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			buffer += decoder.decode(value, { stream: true });

			let newline = buffer.indexOf("\n");
			while (newline !== -1) {
				const line = buffer.slice(0, newline).trim();
				buffer = buffer.slice(newline + 1);
				newline = buffer.indexOf("\n");

				if (!line.startsWith("data:")) continue;
				const payload = line.slice(5).trim();
				if (!payload || payload === "[DONE]") continue;
				try {
					const parsed = JSON.parse(payload) as {
						choices?: { delta?: { content?: string | null } }[];
					};
					const text = parsed.choices?.[0]?.delta?.content;
					if (text) yield text;
				} catch {
					// A partial or non-JSON keep-alive line is ignored; the next
					// read completes it.
				}
			}
		}
	},

	async complete(request: ProviderRequest): Promise<CompletionResult | null> {
		if (!request.config.apiKey) return null;

		const response = await fetch(requireBaseUrl(request), {
			method: "POST",
			headers: requestHeaders(request.config.apiKey),
			body: JSON.stringify(buildBody(request, false)),
			signal: AbortSignal.timeout(60_000),
		});

		if (!response.ok) throw httpError(response);

		const data = (await response.json()) as {
			choices?: { message?: { content?: string | null } }[];
		};
		return {
			content: data.choices?.[0]?.message?.content ?? "",
			reasoning: null,
		};
	},
};
