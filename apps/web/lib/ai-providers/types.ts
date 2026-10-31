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
	/** Instance slug: the built-in id or a console-created provider (#432). */
	provider: string;
	/** Adapter id. Defaults to `provider` when absent. */
	kind?: string;
	/** Provider-specific model id. */
	model: string;
	/** Resolved secret value. Never logged. */
	apiKey: string;
	reasoningEffort: ReasoningEffort;
	/** Free-form provider-specific extras from the config row. */
	params: Record<string, unknown>;
	/** Base URL for the generic OpenAI-compatible adapter (#432). */
	baseUrl?: string;
}

export interface ProviderRequest {
	turns: AiTurn[];
	systemPrompt: string;
	/** Stable per-conversation id; used where the provider needs affinity. */
	sessionId: string;
	config: AiProviderRuntimeConfig;
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
