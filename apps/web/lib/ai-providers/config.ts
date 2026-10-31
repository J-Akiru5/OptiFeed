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
import { decryptProviderKey, isSecretStorageConfigured } from "./secrets";
import type { AiProviderRuntimeConfig, ReasoningEffort } from "./types";

export interface AiProviderRow {
	provider: string;
	enabled: boolean;
	priority: number;
	model: string | null;
	apiKeyEnv: string | null;
	params: unknown;
	/** Adapter id for a console-created instance; null for built-ins (#432). */
	kind?: string | null;
	label?: string | null;
	baseUrl?: string | null;
	/** Encrypted key material; decrypted lazily, never returned (#432). */
	keyCiphertext?: Uint8Array | null;
	keyIv?: Uint8Array | null;
	keyTag?: Uint8Array | null;
	keyVersion?: number | null;
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
	const kind = row.kind?.trim() || row.provider;
	const provider = getProvider(kind);
	if (!provider) {
		console.warn(`[ai] unknown provider "${kind}" in configuration; skipping`);
		return null;
	}

	const baseUrl = row.baseUrl?.trim() || undefined;
	if (kind === "openai-compatible" && !baseUrl) {
		console.warn(`[ai] provider "${row.provider}" has no base URL; skipping`);
		return null;
	}

	const envName = row.apiKeyEnv?.trim() || provider.defaultApiKeyEnv;
	// #432: a key saved from the console wins; the environment variable stays a
	// fallback so CI/e2e and deployments without AI_SECRET_KEY keep working.
	const storedKey =
		row.keyCiphertext && row.keyIv && row.keyTag && typeof row.keyVersion === "number"
			? decryptProviderKey({
					provider: row.provider,
					keyCiphertext: row.keyCiphertext,
					keyIv: row.keyIv,
					keyTag: row.keyTag,
					keyVersion: row.keyVersion,
				})
			: null;
	if (row.keyCiphertext && !storedKey && isSecretStorageConfigured()) {
		// The row has a key but this process cannot read it: wrong/missing
		// master-key generation or a tampered ciphertext. Never fatal; the env
		// fallback (if any) keeps the provider usable.
		console.warn(`[ai] stored key for "${row.provider}" could not be decrypted; using fallback`);
	}
	const apiKey = storedKey ?? process.env[envName]?.trim();
	if (!apiKey) {
		// Not an error: a provider with no key configured is simply inactive.
		return null;
	}
	return {
		provider: row.provider,
		kind,
		model: row.model?.trim() || provider.defaultModel,
		apiKey,
		reasoningEffort: resolveReasoningEffort(row.params),
		params:
			row.params && typeof row.params === "object" ? (row.params as Record<string, unknown>) : {},
		...(baseUrl ? { baseUrl } : {}),
	};
}

/**
 * Stored rows are an **overlay** on the built-in defaults, not a replacement.
 *
 * Returning stored rows alone would mean configuring one provider silently drops
 * every other provider from the chain — a superadmin setting a Gemini priority
 * would disable OpenCode Go as a side effect, while the console (which merges)
 * still displayed both. To remove a provider from the chain, disable it.
 */
async function loadRows(): Promise<AiProviderRow[]> {
	let stored: AiProviderRow[] = [];
	try {
		stored = (await prisma.aiProviderConfig.findMany({
			orderBy: { priority: "asc" },
		})) as AiProviderRow[];
	} catch (error) {
		console.error("[ai] provider config unavailable, using built-in defaults:", error);
		return DEFAULT_PROVIDER_ROWS;
	}

	if (stored.length === 0) return DEFAULT_PROVIDER_ROWS;

	const merged = new Map(DEFAULT_PROVIDER_ROWS.map((row) => [row.provider, row]));
	for (const row of stored) merged.set(row.provider, row);
	return [...merged.values()];
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
