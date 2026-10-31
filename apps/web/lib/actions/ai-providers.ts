"use server";

import {
	DEFAULT_PROVIDER_ROWS,
	LEGACY_PROVIDER_ROW_SELECT,
	type ResolvedProviderKey,
	invalidateProviderConfigCache,
	isMissingProviderColumn,
	resolveProviderKey,
} from "@/lib/ai-providers/config";
import { parseReasoningEffort } from "@/lib/ai-providers/reasoning";
import { getProvider, listProviders } from "@/lib/ai-providers/registry";
import {
	CURRENT_KEY_VERSION,
	SECRET_ALGORITHM,
	encryptSecret,
	hasUsableMasterKey,
	secretAad,
} from "@/lib/ai-providers/secret";
import type { AiProviderRuntimeConfig, ReasoningEffort } from "@/lib/ai-providers/types";
import { requirePlatformAdmin } from "@/lib/auth/require-platform-admin";
import { getCurrentUser } from "@/lib/auth/session";
import { isStepUpRequiredError, withStepUp } from "@/lib/auth/step-up";
import prisma from "@/lib/prisma";
import { checkAiProviderTestRateLimit } from "@/lib/rate-limit";
import type { Prisma } from "@prisma/client";

/**
 * Platform-global AI provider chain, managed from /superadmin.
 *
 * A provider key is either encrypted in AiProviderConfig (AES-256-GCM) or named
 * indirectly by `apiKeyEnv`. The console only ever learns the key's source, its
 * last four characters and who/when it was changed — never the value, the
 * ciphertext, the IV or the tag.
 *
 * Every mutation is audited through PlatformAuditLog with a required reason,
 * matching the rest of the platform console. Key writes additionally require a
 * fresh step-up check and a passing live call before they become active.
 */

const MIN_REASON_LENGTH = 10;
const MAX_MODEL_LENGTH = 100;
const MAX_KEY_LENGTH = 8192;
const KEY_TEST_TIMEOUT_MS = 15_000;
const KEY_COLUMNS_MIGRATION = "20261031140000_ai_provider_secret_columns";

const PROVIDER_ACTIONS = {
	update: "platform.ai_provider.update",
	reset: "platform.ai_provider.reset",
	setKey: "ai.provider.key_set",
	clearKey: "ai.provider.key_cleared",
	testKey: "ai.provider.key_tested",
	testFailed: "ai.provider.key_test_failed",
} as const;

export interface AiProviderKeyView {
	/** Where the effective key comes from. */
	source: "db" | "env" | "none";
	/** Last four characters of a DB key; null for env/none. */
	last4: string | null;
	/** ISO timestamp of the last DB key write. */
	updatedAt: string | null;
	/** Platform user id that last wrote the DB key. */
	updatedBy: string | null;
}

export interface AiProviderView {
	provider: string;
	label: string;
	/** True when a row exists; false means the built-in default is in force. */
	configured: boolean;
	enabled: boolean;
	priority: number;
	model: string;
	apiKeyEnv: string;
	/** Presence only — the value is never returned. */
	apiKeyPresent: boolean;
	/** Safe key metadata for the client; no ciphertext, IV or tag. */
	key: AiProviderKeyView;
	reasoningEffort: ReasoningEffort;
}

export interface AiProviderActionResult {
	success?: boolean;
	error?: string;
	code?: "step_up_required" | "rate_limited" | "migration_required";
	latencyMs?: number;
}

/** A row as the console reads it; key columns may be absent pre-migration. */
interface ProviderConfigRow {
	provider: string;
	enabled: boolean;
	priority: number;
	model: string | null;
	apiKeyEnv: string | null;
	params: unknown;
	keyCiphertext?: Uint8Array | null;
	keyIv?: Uint8Array | null;
	keyTag?: Uint8Array | null;
	keyVersion?: number | null;
	keyLast4?: string | null;
	keyUpdatedAt?: Date | null;
	keyUpdatedBy?: string | null;
}

function requireReason(reason: string | undefined): string {
	const trimmed = reason?.trim() ?? "";
	if (trimmed.length < MIN_REASON_LENGTH) {
		throw new Error(`A reason of at least ${MIN_REASON_LENGTH} characters is required.`);
	}
	return trimmed;
}

/** Prisma P2021 / Postgres 42P01 — the migration hasn't been applied yet. */
function isMissingTable(error: unknown): boolean {
	const code = (error as { code?: string }).code;
	const message = String((error as { message?: string }).message ?? "");
	return (
		code === "P2021" ||
		/does not exist in the current database|relation "?AiProviderConfig"? does not exist/i.test(
			message,
		)
	);
}

/**
 * P2022/P2021 while writing or reading the key columns: the table exists but
 * this migration has not landed. Report one actionable sentence instead of a
 * crash; never repeat a raw database message that could include parameters.
 */
function keyColumnsUnavailable(error: unknown): boolean {
	return isMissingTable(error) || isMissingProviderColumn(error);
}

function migrationRequired(): AiProviderActionResult {
	return {
		error: `The encrypted key columns are not deployed yet. Apply migration ${KEY_COLUMNS_MIGRATION}, then try again.`,
		code: "migration_required",
	};
}

async function actorId(): Promise<string> {
	const user = await getCurrentUser();
	if (!user) throw new Error("Not authenticated.");
	return user.id;
}

async function audit(
	data: {
		action: string;
		targetId: string;
		reason: string;
		actorUserId: string;
		stepUpAt?: Date;
		before?: Prisma.InputJsonValue;
		after?: Prisma.InputJsonValue;
	},
	tx: Prisma.TransactionClient,
): Promise<void> {
	await tx.platformAuditLog.create({
		data: {
			actorUserId: data.actorUserId,
			action: data.action,
			targetType: "ai_provider",
			targetId: data.targetId,
			reason: data.reason,
			...(data.stepUpAt ? { stepUpAt: data.stepUpAt } : {}),
			...(data.before !== undefined ? { before: data.before } : {}),
			...(data.after !== undefined ? { after: data.after } : {}),
		},
	});
}

/** Read one row, falling back to legacy columns when key columns are absent. */
async function loadProviderRow(providerId: string): Promise<ProviderConfigRow | null> {
	try {
		return (await prisma.aiProviderConfig.findUnique({
			where: { provider: providerId },
		})) as ProviderConfigRow | null;
	} catch (error) {
		if (!isMissingProviderColumn(error)) throw error;
		return (await prisma.aiProviderConfig.findUnique({
			where: { provider: providerId },
			select: LEGACY_PROVIDER_ROW_SELECT,
		})) as ProviderConfigRow | null;
	}
}

function defaultPriority(providerId: string): number {
	return (
		DEFAULT_PROVIDER_ROWS.find((row) => row.provider === providerId)?.priority ??
		Math.max(...DEFAULT_PROVIDER_ROWS.map((row) => row.priority), 90) + 10
	);
}

function syntheticRow(providerId: string): ProviderConfigRow {
	const provider = getProvider(providerId);
	return {
		provider: providerId,
		enabled: true,
		priority: defaultPriority(providerId),
		model: null,
		apiKeyEnv: provider?.defaultApiKeyEnv ?? null,
		params: null,
	};
}

function keyView(row: ProviderConfigRow | null, resolved: ResolvedProviderKey): AiProviderKeyView {
	return {
		source: resolved.source,
		last4: resolved.source === "db" ? (row?.keyLast4 ?? null) : null,
		updatedAt: row?.keyUpdatedAt ? row.keyUpdatedAt.toISOString() : null,
		updatedBy: row?.keyUpdatedBy ?? null,
	};
}

/**
 * Turn an upstream failure into text that is safe to return and audit. The
 * adapter error may embed a response body; only the status class is kept.
 */
function sanitizeProviderError(error: unknown): string {
	const status = (error as { status?: unknown }).status;
	if (typeof status === "number" && status >= 400 && status <= 599) {
		return `The provider rejected the key (HTTP ${status}).`;
	}
	if ((error as { name?: unknown }).name === "TimeoutError") {
		return "The provider did not answer before the 15-second timeout.";
	}
	if ((error as { name?: unknown }).name === "AbortError") {
		return "The provider request was aborted before it answered.";
	}
	return "The provider could not be reached or rejected the key.";
}

interface KeyTestOutcome {
	ok: boolean;
	latencyMs: number;
	error?: string;
}

/**
 * One minimal completion through the provider's own adapter, in memory only.
 * The response body is discarded; only success and latency leave this function.
 */
async function testKeyLive(
	providerId: string,
	model: string,
	apiKey: string,
	keySource: "db" | "env",
): Promise<KeyTestOutcome> {
	const provider = getProvider(providerId);
	if (!provider) {
		return { ok: false, latencyMs: 0, error: `Unknown provider "${providerId}".` };
	}

	const config: AiProviderRuntimeConfig = {
		provider: provider.id,
		model,
		apiKey,
		keySource,
		reasoningEffort: "none",
		params: {},
	};

	const started = Date.now();
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		const timeout = new Promise<never>((_resolve, reject) => {
			timer = setTimeout(
				() => reject(Object.assign(new Error("timeout"), { name: "TimeoutError" })),
				KEY_TEST_TIMEOUT_MS,
			);
		});
		const result = await Promise.race([
			provider.complete({
				turns: [{ role: "user", text: "Reply with OK." }],
				systemPrompt: "Reply with OK.",
				sessionId: `superadmin-key-test-${provider.id}`,
				config,
				timeoutMs: KEY_TEST_TIMEOUT_MS,
			}),
			timeout,
		]);
		const latencyMs = Date.now() - started;
		if (!result) {
			return { ok: false, latencyMs, error: "The provider returned no completion." };
		}
		return { ok: true, latencyMs };
	} catch (error) {
		return {
			ok: false,
			latencyMs: Date.now() - started,
			error: sanitizeProviderError(error),
		};
	} finally {
		if (timer) clearTimeout(timer);
	}
}

/**
 * The full chain as the console should render it: every registered provider,
 * in priority order, merged with any stored row and its default fallback.
 *
 * Tolerates the table being absent, and the key columns not being migrated yet:
 * every provider then renders as "using built-in default" / "no DB key" instead
 * of the page failing with a 500.
 */
export async function listAiProviderConfig(): Promise<AiProviderView[]> {
	await requirePlatformAdmin();

	let rows: ProviderConfigRow[] = [];
	try {
		rows = (await prisma.aiProviderConfig.findMany({
			orderBy: { priority: "asc" },
		})) as ProviderConfigRow[];
	} catch (error) {
		if (isMissingProviderColumn(error)) {
			try {
				rows = (await prisma.aiProviderConfig.findMany({
					orderBy: { priority: "asc" },
					select: LEGACY_PROVIDER_ROW_SELECT,
				})) as ProviderConfigRow[];
			} catch (legacyError) {
				console.warn(
					"[superadmin] AiProviderConfig unavailable; rendering built-in defaults:",
					legacyError,
				);
			}
		} else {
			console.warn(
				"[superadmin] AiProviderConfig unavailable; rendering built-in defaults:",
				error,
			);
		}
	}

	const byProvider = new Map(rows.map((row) => [row.provider, row]));
	// Mirror the runtime's built-in ordering so the console never displays a
	// chain order that differs from what lib/ai-providers/config.ts resolves.
	const defaultPriorityById = new Map(
		DEFAULT_PROVIDER_ROWS.map((r) => [r.provider, r.priority] as const),
	);

	const views = listProviders().map((provider) => {
		const row = byProvider.get(provider.id) ?? null;
		const params = (row?.params ?? null) as { reasoningEffort?: unknown } | null;
		const apiKeyEnv = row?.apiKeyEnv?.trim() || provider.defaultApiKeyEnv;
		const resolved = resolveProviderKey(row ?? syntheticRow(provider.id));
		return {
			provider: provider.id,
			label: provider.label,
			configured: Boolean(row),
			enabled: row?.enabled ?? true,
			priority: row?.priority ?? defaultPriorityById.get(provider.id) ?? 100,
			model: row?.model?.trim() || provider.defaultModel,
			apiKeyEnv,
			apiKeyPresent: resolved.source !== "none",
			key: keyView(row, resolved),
			reasoningEffort: parseReasoningEffort(
				params?.reasoningEffort ? String(params.reasoningEffort) : undefined,
			),
		} satisfies AiProviderView;
	});

	return views.sort((a, b) => a.priority - b.priority || a.provider.localeCompare(b.provider));
}

export interface SaveAiProviderInput {
	provider: string;
	enabled: boolean;
	priority: number;
	model?: string;
	apiKeyEnv?: string;
	reasoningEffort?: ReasoningEffort;
	reason: string;
}

export async function saveAiProviderConfig(
	input: SaveAiProviderInput,
): Promise<AiProviderActionResult> {
	await requirePlatformAdmin();

	let reason: string;
	try {
		reason = requireReason(input.reason);
	} catch (e) {
		return { error: e instanceof Error ? e.message : "A reason is required." };
	}

	const provider = getProvider(input.provider);
	if (!provider) return { error: `Unknown provider "${input.provider}".` };

	const priority = Number(input.priority);
	if (!Number.isInteger(priority) || priority < 0 || priority > 1000) {
		return { error: "Priority must be a whole number between 0 and 1000." };
	}

	const model = input.model?.trim() ?? "";
	if (model.length > MAX_MODEL_LENGTH) {
		return { error: `Model must be at most ${MAX_MODEL_LENGTH} characters.` };
	}

	// The env var name is stored, never the value. Constrain it to a NAME so a
	// pasted secret cannot be silently persisted in this column.
	const apiKeyEnv = input.apiKeyEnv?.trim() ?? "";
	if (apiKeyEnv && !/^[A-Z][A-Z0-9_]*$/.test(apiKeyEnv)) {
		return {
			error:
				"Environment variable must be an upper-case name like OPENCODE_GO_API_KEY (not a key value).",
		};
	}

	const reasoningEffort = parseReasoningEffort(input.reasoningEffort ?? "high");

	try {
		const actor = await actorId();
		// Explicit select keeps this action working before the key-column
		// migration: the default select would ask for columns that do not exist.
		const before = await prisma.aiProviderConfig.findUnique({
			where: { provider: provider.id },
			select: LEGACY_PROVIDER_ROW_SELECT,
		});

		await prisma.$transaction(async (tx) => {
			const after = await tx.aiProviderConfig.upsert({
				where: { provider: provider.id },
				create: {
					provider: provider.id,
					enabled: input.enabled,
					priority,
					model: model || null,
					apiKeyEnv: apiKeyEnv || null,
					params: { reasoningEffort },
				},
				update: {
					enabled: input.enabled,
					priority,
					model: model || null,
					apiKeyEnv: apiKeyEnv || null,
					params: { reasoningEffort },
				},
				select: LEGACY_PROVIDER_ROW_SELECT,
			});

			await audit(
				{
					action: PROVIDER_ACTIONS.update,
					targetId: provider.id,
					reason,
					actorUserId: actor,
					before: before
						? {
								enabled: before.enabled,
								priority: before.priority,
								model: before.model,
								apiKeyEnv: before.apiKeyEnv,
								params: before.params as Prisma.InputJsonValue,
							}
						: undefined,
					after: {
						enabled: after.enabled,
						priority: after.priority,
						model: after.model,
						apiKeyEnv: after.apiKeyEnv,
						params: after.params as Prisma.InputJsonValue,
					},
				},
				tx,
			);
		});

		invalidateProviderConfigCache();
		return { success: true };
	} catch (e) {
		console.error(
			"[superadmin] saveAiProviderConfig error:",
			(e as { code?: string }).code ?? (e instanceof Error ? e.name : "unknown"),
		);
		if (isMissingTable(e)) {
			return {
				error:
					"The AI provider table does not exist yet. Apply migration 20261022000000_add_ai_provider_config, then try again.",
			};
		}
		return { error: "Failed to save the provider configuration." };
	}
}

export interface SetProviderKeyInput {
	provider: string;
	key: string;
	reason: string;
}

/**
 * Validate a new key with one live call, then encrypt and persist it.
 *
 * The order matters: nothing is written unless the provider accepts the key, so
 * a failed test leaves the previous key active. The submitted value lives in
 * memory for the duration of this action only.
 */
export async function setProviderKey(input: SetProviderKeyInput): Promise<AiProviderActionResult> {
	await requirePlatformAdmin();

	let reason: string;
	try {
		reason = requireReason(input.reason);
	} catch (e) {
		return { error: e instanceof Error ? e.message : "A reason is required." };
	}

	const provider = getProvider(input.provider);
	if (!provider) return { error: `Unknown provider "${input.provider}".` };

	const key = input.key?.trim() ?? "";
	if (!key) return { error: "Enter the provider API key." };
	if (key.length > MAX_KEY_LENGTH) {
		return { error: `The key must be at most ${MAX_KEY_LENGTH} characters.` };
	}
	if (/\s/.test(key)) return { error: "The provider API key must not contain spaces." };
	if (!hasUsableMasterKey()) {
		return {
			error:
				"DB keys are disabled: set AI_SECRET_KEY (base64 of 32 bytes) before storing a key. Environment keys still work.",
		};
	}

	try {
		const actor = await actorId();
		return await withStepUp(async (stepUpAt) => {
			const before = await loadProviderRow(provider.id);
			const model = before?.model?.trim() || provider.defaultModel;
			const outcome = await testKeyLive(provider.id, model, key, "db");

			if (!outcome.ok) {
				await prisma.$transaction(async (tx) => {
					await audit(
						{
							action: PROVIDER_ACTIONS.testFailed,
							targetId: provider.id,
							reason,
							actorUserId: actor,
							stepUpAt,
							after: {
								ok: false,
								latencyMs: outcome.latencyMs,
								error: outcome.error ?? "unknown",
							},
						},
						tx,
					);
				});
				return {
					error:
						outcome.error ?? "The provider rejected the key; the previous key is still active.",
					latencyMs: outcome.latencyMs,
				};
			}

			const encrypted = encryptSecret(key, secretAad(provider.id, CURRENT_KEY_VERSION));
			// Prisma's Bytes input is Uint8Array<ArrayBuffer>; Buffer's generic is
			// wider. Copy into plain byte arrays at the persistence boundary.
			const keyCiphertext = new Uint8Array(encrypted.keyCiphertext);
			const keyIv = new Uint8Array(encrypted.keyIv);
			const keyTag = new Uint8Array(encrypted.keyTag);
			const last4 = key.slice(-4);
			const updatedAt = new Date();

			await prisma.$transaction(async (tx) => {
				await tx.aiProviderConfig.upsert({
					where: { provider: provider.id },
					create: {
						provider: provider.id,
						enabled: before?.enabled ?? true,
						priority: before?.priority ?? defaultPriority(provider.id),
						model: before?.model ?? null,
						apiKeyEnv: before?.apiKeyEnv ?? null,
						...(before?.params ? { params: before.params as Prisma.InputJsonValue } : {}),
						keyCiphertext,
						keyIv,
						keyTag,
						keyVersion: encrypted.keyVersion,
						keyLast4: last4,
						keyUpdatedAt: updatedAt,
						keyUpdatedBy: actor,
					},
					update: {
						keyCiphertext,
						keyIv,
						keyTag,
						keyVersion: encrypted.keyVersion,
						keyLast4: last4,
						keyUpdatedAt: updatedAt,
						keyUpdatedBy: actor,
					},
					select: {
						provider: true,
						enabled: true,
						priority: true,
						model: true,
						apiKeyEnv: true,
						keyLast4: true,
						keyVersion: true,
						keyUpdatedAt: true,
						keyUpdatedBy: true,
					},
				});

				await audit(
					{
						action: PROVIDER_ACTIONS.setKey,
						targetId: provider.id,
						reason,
						actorUserId: actor,
						stepUpAt,
						before: {
							keySource: before?.keyLast4 ? "db" : "env_or_none",
							keyLast4: before?.keyLast4 ?? null,
						},
						after: {
							keySource: "db",
							keyLast4: last4,
							keyVersion: encrypted.keyVersion,
							algorithm: SECRET_ALGORITHM,
							latencyMs: outcome.latencyMs,
						},
					},
					tx,
				);
			});

			invalidateProviderConfigCache();
			return { success: true, latencyMs: outcome.latencyMs };
		});
	} catch (e) {
		if (isStepUpRequiredError(e)) {
			return { error: e.message, code: "step_up_required" };
		}
		if (keyColumnsUnavailable(e)) return migrationRequired();
		console.error(
			"[superadmin] setProviderKey failed:",
			(e as { code?: string }).code ?? (e instanceof Error ? e.name : "unknown"),
		);
		return { error: "Failed to store the provider key." };
	}
}

export interface ProviderKeyReasonInput {
	provider: string;
	reason: string;
}

/** Clear the stored key; the provider falls back to its environment variable. */
export async function clearProviderKey(
	input: ProviderKeyReasonInput,
): Promise<AiProviderActionResult> {
	await requirePlatformAdmin();

	let reason: string;
	try {
		reason = requireReason(input.reason);
	} catch (e) {
		return { error: e instanceof Error ? e.message : "A reason is required." };
	}

	const provider = getProvider(input.provider);
	if (!provider) return { error: `Unknown provider "${input.provider}".` };

	try {
		const actor = await actorId();
		return await withStepUp(async (stepUpAt) => {
			const before = await loadProviderRow(provider.id);

			await prisma.$transaction(async (tx) => {
				await tx.aiProviderConfig.updateMany({
					where: { provider: provider.id },
					data: {
						keyCiphertext: null,
						keyIv: null,
						keyTag: null,
						keyVersion: null,
						keyLast4: null,
						keyUpdatedAt: null,
						keyUpdatedBy: null,
					},
				});

				await audit(
					{
						action: PROVIDER_ACTIONS.clearKey,
						targetId: provider.id,
						reason,
						actorUserId: actor,
						stepUpAt,
						before: {
							keySource: before?.keyLast4 ? "db" : "env_or_none",
							keyLast4: before?.keyLast4 ?? null,
						},
						after: { keySource: "none", keyLast4: null },
					},
					tx,
				);
			});

			invalidateProviderConfigCache();
			return { success: true };
		});
	} catch (e) {
		if (isStepUpRequiredError(e)) {
			return { error: e.message, code: "step_up_required" };
		}
		if (keyColumnsUnavailable(e)) {
			// Nothing encrypted can exist on this schema; the chain is already on
			// env/default resolution, so clearing is a no-op rather than an error.
			invalidateProviderConfigCache();
			return { success: true };
		}
		console.error(
			"[superadmin] clearProviderKey failed:",
			(e as { code?: string }).code ?? (e instanceof Error ? e.name : "unknown"),
		);
		return { error: "Failed to clear the provider key." };
	}
}

/**
 * Test the currently effective key (DB first, then env) with one minimal call.
 * Rate-limited per actor because every test spends provider quota. Never needs
 * step-up: it changes nothing.
 */
export async function testProviderKey(
	input: ProviderKeyReasonInput,
): Promise<AiProviderActionResult> {
	await requirePlatformAdmin();

	let reason: string;
	try {
		reason = requireReason(input.reason);
	} catch (e) {
		return { error: e instanceof Error ? e.message : "A reason is required." };
	}

	const provider = getProvider(input.provider);
	if (!provider) return { error: `Unknown provider "${input.provider}".` };

	try {
		const actor = await actorId();
		const limit = await checkAiProviderTestRateLimit(actor);
		if (!limit.success) {
			return {
				error: "Too many key tests. Wait a minute and try again.",
				code: "rate_limited",
			};
		}

		const row = await loadProviderRow(provider.id);
		const resolved = resolveProviderKey(row ?? syntheticRow(provider.id));
		if (!resolved.apiKey) {
			return { error: "No key is configured for this provider." };
		}

		const model = row?.model?.trim() || provider.defaultModel;
		const outcome = await testKeyLive(
			provider.id,
			model,
			resolved.apiKey,
			resolved.source === "db" ? "db" : "env",
		);

		await prisma.$transaction(async (tx) => {
			await audit(
				{
					action: PROVIDER_ACTIONS.testKey,
					targetId: provider.id,
					reason,
					actorUserId: actor,
					after: {
						ok: outcome.ok,
						latencyMs: outcome.latencyMs,
						keySource: resolved.source,
						...(outcome.error ? { error: outcome.error } : {}),
					},
				},
				tx,
			);
		});

		if (!outcome.ok) {
			return {
				error: outcome.error ?? "The provider rejected the key.",
				latencyMs: outcome.latencyMs,
			};
		}
		return { success: true, latencyMs: outcome.latencyMs };
	} catch (e) {
		if (keyColumnsUnavailable(e)) return migrationRequired();
		console.error(
			"[superadmin] testProviderKey failed:",
			(e as { code?: string }).code ?? (e instanceof Error ? e.name : "unknown"),
		);
		return { error: "Failed to test the provider key." };
	}
}

/** Removes every stored row, returning the chain to its built-in defaults. */
export async function resetAiProviderConfig(reason: string): Promise<AiProviderActionResult> {
	await requirePlatformAdmin();

	let trimmedReason: string;
	try {
		trimmedReason = requireReason(reason);
	} catch (e) {
		return { error: e instanceof Error ? e.message : "A reason is required." };
	}

	try {
		const actor = await actorId();
		// Explicit select keeps reset working before the key-column migration.
		const rows = await prisma.aiProviderConfig.findMany({
			select: LEGACY_PROVIDER_ROW_SELECT,
		});

		await prisma.$transaction(async (tx) => {
			await tx.aiProviderConfig.deleteMany();
			await audit(
				{
					action: PROVIDER_ACTIONS.reset,
					targetId: "ai_provider_chain",
					reason: trimmedReason,
					actorUserId: actor,
					before: rows.map((r) => ({
						provider: r.provider,
						enabled: r.enabled,
						priority: r.priority,
						model: r.model,
						apiKeyEnv: r.apiKeyEnv,
					})) as Prisma.InputJsonValue,
					after: [] as Prisma.InputJsonValue,
				},
				tx,
			);
		});

		invalidateProviderConfigCache();
		return { success: true };
	} catch (e) {
		console.error(
			"[superadmin] resetAiProviderConfig error:",
			(e as { code?: string }).code ?? (e instanceof Error ? e.name : "unknown"),
		);
		if (isMissingTable(e)) {
			// Nothing stored to reset — the chain is already on defaults.
			invalidateProviderConfigCache();
			return { success: true };
		}
		return { error: "Failed to reset the provider configuration." };
	}
}
