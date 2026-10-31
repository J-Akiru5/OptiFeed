// Provider-agnostic AI contracts. Every provider adapter normalises its own
// wire format into these shapes so the orchestrator (lib/ai.ts) can treat them
// interchangeably.

export type ReasoningEffort = "none" | "low" | "medium" | "high";

export interface AiTurn {
	role: "user" | "assistant";
	text: string;
}

export interface CompletionResult {
	content: string;
	reasoning: string | null;
}

/** Resolved, ready-to-call configuration for one provider. */
export interface AiProviderRuntimeConfig {
	/** Registry id, e.g. "opencode-go". */
	provider: string;
	/** Provider-specific model id. */
	model: string;
	/** Resolved secret value. Never logged. */
	apiKey: string;
	/** Where the key came from; reported by diagnostics, never the value. */
	keySource: "db" | "env" | "none";
	reasoningEffort: ReasoningEffort;
	/** Free-form provider-specific extras from the config row. */
	params: Record<string, unknown>;
}

export interface ProviderRequest {
	turns: AiTurn[];
	systemPrompt: string;
	/** Stable per-conversation id; used where the provider needs affinity. */
	sessionId: string;
	config: AiProviderRuntimeConfig;
	/** Optional per-call timeout for short validation calls (defaults per adapter). */
	timeoutMs?: number;
}

export interface AiProvider {
	/** Registry id, must match AiProviderConfig.provider. */
	id: string;
	/** Human label for the superadmin console. */
	label: string;
	/** Used when the config row does not pin a model. */
	defaultModel: string;
	/** Used when the config row does not pin an env var name. */
	defaultApiKeyEnv: string;
	stream(request: ProviderRequest): AsyncGenerator<string>;
	complete(request: ProviderRequest): Promise<CompletionResult | null>;
}

/** An error that carries the upstream HTTP status, so failover can classify it. */
export interface AiHttpError extends Error {
	status?: number;
}
