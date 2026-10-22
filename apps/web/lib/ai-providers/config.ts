// Resolves the platform-global provider chain.
//
// Rows live in AiProviderConfig and are managed from /superadmin. Secrets are
// never stored there: a row names the environment variable that holds the key,
// and this module reads the value at call time.
//
// The table is optional. When it is missing, empty, or unreachable the built-in
// defaults below apply, so the pipeline keeps working during a cold deploy or a
// database incident.

import prisma from "@/lib/prisma";
import { parseReasoningEffort } from "./reasoning";
import { getProvider } from "./registry";
import type { AiProviderRuntimeConfig, ReasoningEffort } from "./types";

export interface AiProviderRow {
	provider: string;
	enabled: boolean;
	priority: number;
	model: string | null;
	apiKeyEnv: string | null;
	params: unknown;
}

/** Chain used when the database has no rows yet. */
export const DEFAULT_PROVIDER_ROWS: AiProviderRow[] = [
	{
		provider: "opencode-go",
		enabled: true,
		priority: 10,
		model: null,
		apiKeyEnv: null,
		params: null,
	},
	{ provider: "gemini", enabled: true, priority: 20, model: null, apiKeyEnv: null, params: null },
];

const CACHE_TTL_MS = 30_000;

let cache: { at: number; configs: AiProviderRuntimeConfig[] } | null = null;

/** Called by the superadmin actions so edits apply without waiting for the TTL. */
export function invalidateProviderConfigCache(): void {
	cache = null;
}

function resolveReasoningEffort(params: unknown): ReasoningEffort {
	const fromParams =
		params && typeof params === "object" && "reasoningEffort" in params
			? String((params as { reasoningEffort?: unknown }).reasoningEffort ?? "")
			: "";
	return parseReasoningEffort(fromParams || process.env.OPENCODE_GO_REASONING_EFFORT);
}

function toRuntimeConfig(row: AiProviderRow): AiProviderRuntimeConfig | null {
	const provider = getProvider(row.provider);
	if (!provider) {
		console.warn(`[ai] unknown provider "${row.provider}" in configuration; skipping`);
		return null;
	}
	const envName = row.apiKeyEnv?.trim() || provider.defaultApiKeyEnv;
	const apiKey = process.env[envName]?.trim();
	if (!apiKey) {
		// Not an error: a provider with no key configured is simply inactive.
		return null;
	}
	return {
		provider: provider.id,
		model: row.model?.trim() || provider.defaultModel,
		apiKey,
		reasoningEffort: resolveReasoningEffort(row.params),
		params:
			row.params && typeof row.params === "object" ? (row.params as Record<string, unknown>) : {},
	};
}

async function loadRows(): Promise<AiProviderRow[]> {
	try {
		const rows = await prisma.aiProviderConfig.findMany({ orderBy: { priority: "asc" } });
		if (rows.length > 0) return rows as AiProviderRow[];
	} catch (error) {
		console.error("[ai] provider config unavailable, using built-in defaults:", error);
	}
	return DEFAULT_PROVIDER_ROWS;
}

/**
 * Providers that are enabled and hold a key, ordered by priority (lowest first).
 * Returns an empty array when nothing is usable — callers then fall back to the
 * keyword assistant and deterministic predictions.
 */
export async function loadProviderConfigs(): Promise<AiProviderRuntimeConfig[]> {
	const now = Date.now();
	if (cache && now - cache.at < CACHE_TTL_MS) return cache.configs;

	const rows = await loadRows();
	const configs = [...rows]
		.filter((row) => row.enabled)
		.sort((a, b) => a.priority - b.priority)
		.map(toRuntimeConfig)
		.filter((c): c is AiProviderRuntimeConfig => c !== null);

	cache = { at: now, configs };
	return configs;
}
