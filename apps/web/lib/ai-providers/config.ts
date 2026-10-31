// Resolves the platform-global provider chain.
//
// Rows live in AiProviderConfig and are managed from /superadmin. A row may
// carry an AES-256-GCM ciphertext of the key (master key AI_SECRET_KEY) or name
// the environment variable that holds it (`apiKeyEnv`). The database key wins;
// the environment remains a fallback so CI, cold environments and deployments
// without AI_SECRET_KEY behave exactly as before.
//
// The table is optional. When it is missing, empty, unreachable, or still on a
// schema without the key columns, the built-in defaults below apply, so the
// pipeline keeps working during a cold deploy or a database incident.

import prisma from "@/lib/prisma";
import { parseReasoningEffort } from "./reasoning";
import { getProvider } from "./registry";
import { type SecretFailureCode, decryptSecret, secretAad } from "./secret";
import type { AiProviderRuntimeConfig, ReasoningEffort } from "./types";

export interface AiProviderRow {
	provider: string;
	enabled: boolean;
	priority: number;
	model: string | null;
	apiKeyEnv: string | null;
	params: unknown;
	/** Secret columns are optional so a pre-migration row still types cleanly. */
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

/**
 * Explicit select used when the key columns have not been migrated yet
 * (Prisma P2022). An unknown `select` property would itself throw, so this list
 * only names columns from the original AiProviderConfig migration.
 */
export const LEGACY_PROVIDER_ROW_SELECT = {
	provider: true,
	enabled: true,
	priority: true,
	model: true,
	apiKeyEnv: true,
	params: true,
} as const;

const CACHE_TTL_MS = 30_000;

let cache: { at: number; configs: AiProviderRuntimeConfig[] } | null = null;

/** Called by the superadmin actions so edits apply without waiting for the TTL. */
export function invalidateProviderConfigCache(): void {
	cache = null;
}

/** Prisma P2022 / Postgres 42703 — a column from a newer migration is absent. */
export function isMissingProviderColumn(error: unknown): boolean {
	const code = (error as { code?: string }).code;
	const message = String((error as { message?: string }).message ?? "");
	return (
		code === "P2022" || /column .* does not exist|unknown column|no such column/i.test(message)
	);
}

export interface ResolvedProviderKey {
	/** Resolved key value. Never log or return this to a client. */
	apiKey: string | null;
	source: "db" | "env" | "none";
	/** Why a stored key was skipped, for diagnostics only. */
	error?: SecretFailureCode;
}

/**
 * Resolve one row's key: an authenticated DB ciphertext first, then the
 * configured environment variable, then nothing. A broken ciphertext is logged
 * by code only — never the value, the AAD or any byte of it.
 */
export function resolveProviderKey(row: AiProviderRow): ResolvedProviderKey {
	const provider = getProvider(row.provider);
	const envName = row.apiKeyEnv?.trim() || provider?.defaultApiKeyEnv;
	let decryptError: SecretFailureCode | undefined;

	const hasStoredKey =
		Boolean(row.keyCiphertext?.length) &&
		Boolean(row.keyIv?.length) &&
		Boolean(row.keyTag?.length) &&
		row.keyVersion !== null &&
		row.keyVersion !== undefined;

	if (hasStoredKey) {
		const version = row.keyVersion as number;
		const result = decryptSecret(
			{
				keyCiphertext: row.keyCiphertext ?? null,
				keyIv: row.keyIv ?? null,
				keyTag: row.keyTag ?? null,
				keyVersion: version,
			},
			secretAad(row.provider, version),
		);
		if (result.ok) return { apiKey: result.plaintext, source: "db" };
		decryptError = result.code;
		console.warn(
			`[ai] stored key for "${row.provider}" is unreadable (${result.code}); using the environment fallback`,
		);
	}

	const envKey = envName ? process.env[envName]?.trim() : "";
	if (envKey) return { apiKey: envKey, source: "env" };
	return { apiKey: null, source: "none", ...(decryptError ? { error: decryptError } : {}) };
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
	const resolved = resolveProviderKey(row);
	if (!resolved.apiKey) {
		// Not an error: a provider with no key configured is simply inactive.
		return null;
	}
	return {
		provider: provider.id,
		model: row.model?.trim() || provider.defaultModel,
		apiKey: resolved.apiKey,
		keySource: resolved.source,
		reasoningEffort: resolveReasoningEffort(row.params),
		params:
			row.params && typeof row.params === "object" ? (row.params as Record<string, unknown>) : {},
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
		if (isMissingProviderColumn(error)) {
			// The key columns are not deployed yet. Read the legacy columns so
			// priorities and models keep working; every row simply has no DB key.
			try {
				stored = (await prisma.aiProviderConfig.findMany({
					orderBy: { priority: "asc" },
					select: LEGACY_PROVIDER_ROW_SELECT,
				})) as AiProviderRow[];
			} catch (legacyError) {
				console.error("[ai] provider config unavailable, using built-in defaults:", legacyError);
				return DEFAULT_PROVIDER_ROWS;
			}
		} else {
			console.error("[ai] provider config unavailable, using built-in defaults:", error);
			return DEFAULT_PROVIDER_ROWS;
		}
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
