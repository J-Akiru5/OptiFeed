// Provider-agnostic AI facade.
//
// Callers (chat route, prediction engine) talk to this module only; which
// providers exist, their order, model and credentials are resolved at call time
// from the platform-global configuration (AiProviderConfig, managed in
// /superadmin) with built-in defaults as a fallback.
//
// Failover rule: a provider may be skipped only while it has produced nothing.
// Once a stream has yielded text we are committed to it — the tokens are already
// on the wire and switching would splice two answers together.

import { loadProviderConfigs } from "@/lib/ai-providers/config";
import { parseReasoningEffort } from "@/lib/ai-providers/reasoning";
import { getProvider, listProviders } from "@/lib/ai-providers/registry";
import type {
	AiProviderRuntimeConfig,
	AiTurn,
	CompletionResult,
	ReasoningEffort,
} from "@/lib/ai-providers/types";

export type { AiTurn, CompletionResult, ReasoningEffort };

export interface AiCallOptions {
	/** Override the resolved chain. Used by tests; production resolves from config. */
	configs?: AiProviderRuntimeConfig[];
}

/**
 * Deterministic, collision-resistant-enough session id for providers that need
 * conversation affinity (`x-opencode-session`). FNV-1a keeps this dependency-free
 * and stable across processes, which matters because the value is a routing and
 * prompt-caching hint, not a secret.
 */
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

/** Global default, overridable per provider row via params.reasoningEffort. */
export function getReasoningEffort(): ReasoningEffort {
	return parseReasoningEffort(process.env.OPENCODE_GO_REASONING_EFFORT);
}

/** True when at least one enabled provider holds a usable key. */
export async function isAiEnabled(options: AiCallOptions = {}): Promise<boolean> {
	const configs = options.configs ?? (await loadProviderConfigs());
	return configs.length > 0;
}

/**
 * Diagnostics for route logging. Reports the resolved chain and never exposes a
 * key — only provider ids, models and key presence.
 */
export async function aiDebugInfo(options: AiCallOptions = {}) {
	const configs = options.configs ?? (await loadProviderConfigs());
	return {
		providers: configs.map((c) => ({ provider: c.provider, model: c.model })),
		primary: configs[0]?.provider ?? "none",
		model: configs[0]?.model ?? "none",
		hasKey: configs.length > 0,
		nodeEnv: process.env.NODE_ENV ?? "unknown",
		reasoningEffort: configs[0]?.reasoningEffort ?? getReasoningEffort(),
	};
}

/** Registered provider ids, for the superadmin console. */
function listRegisteredProviders() {
	return listProviders().map((p) => ({
		id: p.id,
		label: p.label,
		defaultModel: p.defaultModel,
		defaultApiKeyEnv: p.defaultApiKeyEnv,
	}));
}

// Returns true when the error is a quota/rate-limit/credit failure. Kept for
// callers that classify failures in logs; failover itself is status-agnostic.
export function isAiQuotaError(error: unknown): boolean {
	const status = (error as { status?: number }).status;
	const message = String((error as { message?: string }).message ?? "");
	return (
		status === 429 ||
		message.includes("429") ||
		message.includes("rate limit") ||
		message.includes("Rate limit") ||
		message.includes("insufficient credit") ||
		message.includes("quota") ||
		message.includes("RESOURCE_EXHAUSTED")
	);
}

function chainLog(configs: AiProviderRuntimeConfig[]): string {
	return configs.map((c) => `${c.provider}:${c.model}`).join(" -> ");
}

/**
 * Streams an AI reply, walking the provider chain until one produces text.
 * Yields nothing when no provider is configured, so callers fall back to the
 * keyword assistant.
 */
export async function* streamAi(
	turns: AiTurn[],
	systemPrompt: string,
	sessionId: string,
	options: AiCallOptions = {},
): AsyncGenerator<string> {
	const configs = options.configs ?? (await loadProviderConfigs());
	let lastError: unknown = null;

	for (const config of configs) {
		const provider = getProvider(config.provider);
		if (!provider) continue;

		let yielded = false;
		try {
			for await (const chunk of provider.stream({ turns, systemPrompt, sessionId, config })) {
				yielded = true;
				yield chunk;
			}
			// Completed without error: whether or not it produced text, this
			// provider answered, so there is nothing to fail over to.
			return;
		} catch (error) {
			lastError = error;
			if (yielded) {
				// Already mid-stream: surface rather than splice two answers.
				throw error;
			}
			console.error(
				`[ai] ${config.provider} failed before first token (chain: ${chainLog(configs)})`,
				error,
			);
		}
	}

	if (lastError) throw lastError;
}

/**
 * Non-streaming completion, walking the provider chain until one returns content.
 * Used by the prediction engine for structured JSON.
 */
export async function completeAi(
	turns: AiTurn[],
	systemPrompt: string,
	sessionId: string,
	options: AiCallOptions = {},
): Promise<CompletionResult | null> {
	const configs = options.configs ?? (await loadProviderConfigs());
	let lastError: unknown = null;

	for (const config of configs) {
		const provider = getProvider(config.provider);
		if (!provider) continue;

		try {
			const result = await provider.complete({ turns, systemPrompt, sessionId, config });
			if (result?.content?.trim()) return result;
			console.warn(`[ai] ${config.provider} returned empty content; trying next provider`);
		} catch (error) {
			lastError = error;
			console.error(
				`[ai] ${config.provider} completion failed (chain: ${chainLog(configs)})`,
				error,
			);
		}
	}

	if (lastError) throw lastError;
	return null;
}
