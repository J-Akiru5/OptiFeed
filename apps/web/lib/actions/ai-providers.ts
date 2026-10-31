"use server";

import { DEFAULT_PROVIDER_ROWS, invalidateProviderConfigCache } from "@/lib/ai-providers/config";
import { parseReasoningEffort } from "@/lib/ai-providers/reasoning";
import {
	CUSTOM_PROVIDER_KIND,
	getProvider,
	isBuiltInProvider,
	listBuiltInProviders,
} from "@/lib/ai-providers/registry";
import {
	decryptProviderKey,
	encryptProviderKey,
	isSecretStorageConfigured,
	keyHint,
	keyMaterialToColumns,
} from "@/lib/ai-providers/secrets";
import type {
	AiProvider,
	AiProviderRuntimeConfig,
	ReasoningEffort,
} from "@/lib/ai-providers/types";
import { checkProviderBaseUrl } from "@/lib/ai-providers/url-safety";
import { requirePlatformAdmin } from "@/lib/auth/require-platform-admin";
import { getCurrentUser } from "@/lib/auth/session";
import { isStepUpRequiredError, withStepUp } from "@/lib/auth/step-up";
import prisma from "@/lib/prisma";
import type { Prisma } from "@prisma/client";

/**
 * Platform-global AI provider chain, managed from /superadmin.
 *
 * Issue #432: a provider key can be set, rotated and cleared from the console.
 * The value is encrypted with AES-256-GCM (`lib/ai-providers/secrets.ts`) and
 * never returned by any action or page; the console only learns whether a key
 * exists, its last four characters, and when/by whom it was written.
 *
 * A key is validated with a live test call *before* it is stored, so a bad key
 * never replaces a working one. Key writes require a fresh step-up
 * (password re-entry) and every mutation is audited through PlatformAuditLog
 * with a required reason.
 *
 * Custom providers are `openai-compatible` instances created here with their own
 * slug, label and base URL; the built-in adapters keep their cards.
 */

const MIN_REASON_LENGTH = 10;
const MAX_MODEL_LENGTH = 100;
const MAX_LABEL_LENGTH = 60;
const MAX_KEY_LENGTH = 512;
const MIN_KEY_LENGTH = 8;
const KEY_TEST_TIMEOUT_MS = 15_000;
const PROVIDER_SLUG_PATTERN = /^[a-z][a-z0-9-]{1,30}$/;

const PROVIDER_ACTIONS = {
	update: "platform.ai_provider.update",
	reset: "platform.ai_provider.reset",
	create: "platform.ai_provider.create",
	remove: "platform.ai_provider.remove",
	setKey: "platform.ai_provider.key_set",
	clearKey: "platform.ai_provider.key_cleared",
	keyTestFailed: "platform.ai_provider.key_test_failed",
} as const;

export type KeySource = "db" | "env" | "none";

export interface AiProviderView {
	/** Instance slug: a built-in id or a console-created provider. */
	provider: string;
	/** Adapter id that serves this instance. */
	kind: string;
	label: string;
	/** True for the two adapters that get a card without a stored row. */
	builtIn: boolean;
	/** True when a row exists; false means the built-in default is in force. */
	configured: boolean;
	enabled: boolean;
	priority: number;
	model: string;
	apiKeyEnv: string;
	/** Presence only — the value is never returned. */
	apiKeyPresent: boolean;
	keySource: KeySource;
	keyLast4: string | null;
	keyUpdatedAt: string | null;
	keyUpdatedBy: string | null;
	/** A ciphertext exists but this process cannot decrypt it. */
	keyUnreadable: boolean;
	baseUrl: string | null;
	reasoningEffort: ReasoningEffort;
}

export interface AiProviderActionResult {
	success?: boolean;
	error?: string;
	code?: "step_up_required";
}

export interface SetKeyResult extends AiProviderActionResult {
	testedAt?: string;
	latencyMs?: number;
}

function requireReason(reason: string | undefined): string {
	const trimmed = reason?.trim() ?? "";
	if (trimmed.length < MIN_REASON_LENGTH) {
		throw new Error(`A reason of at least ${MIN_REASON_LENGTH} characters is required.`);
	}
	return trimmed;
}

/** Prisma P2021/P2022 / Postgres 42P01/42703 — schema is behind the code. */
function isSchemaOutOfDate(error: unknown): boolean {
	const code = (error as { code?: string }).code;
	const message = String((error as { message?: string }).message ?? "");
	return (
		code === "P2021" ||
		code === "P2022" ||
		/migration|column .* does not exist|relation "?AiProviderConfig"? does not exist/i.test(message)
	);
}

function stepUpFailure(error: unknown): AiProviderActionResult | null {
	if (!isStepUpRequiredError(error)) return null;
	return { error: error.message, code: "step_up_required" };
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

type StoredProviderRow = {
	provider: string;
	enabled: boolean;
	priority: number;
	model: string | null;
	apiKeyEnv: string | null;
	params: unknown;
	kind: string | null;
	label: string | null;
	baseUrl: string | null;
	keyCiphertext: Uint8Array | null;
	keyIv: Uint8Array | null;
	keyTag: Uint8Array | null;
	keyVersion: number | null;
	keyLast4: string | null;
	keyUpdatedAt: Date | null;
	keyUpdatedBy: string | null;
};

function viewFromRow(
	adapter: AiProvider,
	slug: string,
	row: StoredProviderRow | undefined,
	builtIn: boolean,
): AiProviderView {
	const apiKeyEnv = row?.apiKeyEnv?.trim() || adapter.defaultApiKeyEnv;
	const decrypted = row
		? decryptProviderKey({
				provider: row.provider,
				keyCiphertext: row.keyCiphertext,
				keyIv: row.keyIv,
				keyTag: row.keyTag,
				keyVersion: row.keyVersion,
			})
		: null;
	const envPresent = Boolean(process.env[apiKeyEnv]?.trim());
	const keySource: KeySource = decrypted ? "db" : envPresent ? "env" : "none";
	const hasCiphertext = Boolean(row?.keyCiphertext);

	return {
		provider: slug,
		kind: adapter.id,
		label: row?.label?.trim() || adapter.label,
		builtIn,
		configured: Boolean(row),
		enabled: row?.enabled ?? true,
		priority: row?.priority ?? 100,
		model: row?.model?.trim() || adapter.defaultModel,
		apiKeyEnv,
		apiKeyPresent: keySource !== "none",
		keySource,
		keyLast4: row?.keyLast4 ?? null,
		keyUpdatedAt: row?.keyUpdatedAt?.toISOString() ?? null,
		keyUpdatedBy: row?.keyUpdatedBy ?? null,
		keyUnreadable: hasCiphertext && !decrypted,
		baseUrl: row?.baseUrl?.trim() || null,
		reasoningEffort: parseReasoningEffort(
			(row?.params as { reasoningEffort?: unknown } | null)?.reasoningEffort
				? String((row?.params as { reasoningEffort?: unknown }).reasoningEffort)
				: undefined,
		),
	};
}

/**
 * The full chain as the console should render it: every built-in adapter in
 * priority order plus every console-created provider, merged with its stored
 * row and its default fallback.
 *
 * Tolerates the table (or the #432 columns) being absent, which is the normal
 * state until the migrations are applied: every provider then renders as
 * "using built-in default" instead of the page failing with a 500.
 */
export async function listAiProviderConfig(): Promise<AiProviderView[]> {
	await requirePlatformAdmin();

	let rows: StoredProviderRow[] = [];
	try {
		rows = (await prisma.aiProviderConfig.findMany({
			orderBy: { priority: "asc" },
		})) as unknown as StoredProviderRow[];
	} catch (error) {
		console.warn("[superadmin] AiProviderConfig unavailable; rendering built-in defaults:", error);
	}

	const byProvider = new Map(rows.map((row) => [row.provider, row]));
	const defaultPriority = new Map(DEFAULT_PROVIDER_ROWS.map((r) => [r.provider, r.priority]));

	const builtInViews = listBuiltInProviders().map((adapter) => {
		const row = byProvider.get(adapter.id);
		const view = viewFromRow(adapter, adapter.id, row, true);
		return { ...view, priority: row?.priority ?? defaultPriority.get(adapter.id) ?? view.priority };
	});

	const customViews = rows
		.filter((row) => !isBuiltInProvider(row.provider))
		.map((row) => {
			const kind = row.kind?.trim() || row.provider;
			const adapter = getProvider(kind);
			if (!adapter) return null;
			return viewFromRow(adapter, row.provider, row, false);
		})
		.filter((view): view is AiProviderView => view !== null);

	return [...builtInViews, ...customViews].sort(
		(a, b) => a.priority - b.priority || a.provider.localeCompare(b.provider),
	);
}

export interface SaveAiProviderInput {
	provider: string;
	enabled: boolean;
	priority: number;
	model?: string;
	apiKeyEnv?: string;
	reasoningEffort?: ReasoningEffort;
	label?: string;
	baseUrl?: string;
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

	// The row's own kind decides the adapter; a built-in falls back to its id.
	let existing: StoredProviderRow | null = null;
	try {
		existing = (await prisma.aiProviderConfig.findUnique({
			where: { provider: input.provider },
		})) as unknown as StoredProviderRow | null;
	} catch (e) {
		if (isSchemaOutOfDate(e)) {
			return {
				error:
					"The AI provider table is behind this build. Apply the pending migrations, then try again.",
			};
		}
		throw e;
	}

	const kind = existing?.kind?.trim() || input.provider;
	const provider = getProvider(kind);
	if (!provider) return { error: `Unknown provider "${input.provider}".` };

	const priority = Number(input.priority);
	if (!Number.isInteger(priority) || priority < 0 || priority > 1000) {
		return { error: "Priority must be a whole number between 0 and 1000." };
	}

	const model = input.model?.trim() ?? "";
	if (model.length > MAX_MODEL_LENGTH) {
		return { error: `Model must be at most ${MAX_MODEL_LENGTH} characters.` };
	}

	const label = input.label?.trim() ?? "";
	if (label.length > MAX_LABEL_LENGTH) {
		return { error: `Label must be at most ${MAX_LABEL_LENGTH} characters.` };
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

	// A custom instance needs a valid base URL; built-in adapters ignore it.
	let baseUrl: string | null = existing?.baseUrl ?? null;
	if (kind === CUSTOM_PROVIDER_KIND) {
		const checked = checkProviderBaseUrl(input.baseUrl ?? existing?.baseUrl ?? "");
		if (!checked.ok) return { error: checked.error };
		baseUrl = checked.url;
	} else if (input.baseUrl !== undefined) {
		return { error: "Only OpenAI-compatible providers take a base URL." };
	}

	const reasoningEffort = parseReasoningEffort(input.reasoningEffort ?? "high");

	try {
		const actor = await actorId();
		const before = existing;

		await prisma.$transaction(async (tx) => {
			const after = await tx.aiProviderConfig.upsert({
				where: { provider: input.provider },
				create: {
					provider: input.provider,
					kind: existing?.kind ?? null,
					enabled: input.enabled,
					priority,
					model: model || null,
					apiKeyEnv: apiKeyEnv || null,
					label: label || null,
					baseUrl,
					params: { reasoningEffort },
				},
				update: {
					enabled: input.enabled,
					priority,
					model: model || null,
					apiKeyEnv: apiKeyEnv || null,
					label: label || null,
					baseUrl,
					params: { reasoningEffort },
				},
			});

			await audit(
				{
					action: PROVIDER_ACTIONS.update,
					targetId: input.provider,
					reason,
					actorUserId: actor,
					before: before
						? {
								enabled: before.enabled,
								priority: before.priority,
								model: before.model,
								apiKeyEnv: before.apiKeyEnv,
								label: before.label,
								baseUrl: before.baseUrl,
								params: before.params as Prisma.InputJsonValue,
							}
						: undefined,
					after: {
						enabled: after.enabled,
						priority: after.priority,
						model: after.model,
						apiKeyEnv: after.apiKeyEnv,
						label: after.label,
						baseUrl: after.baseUrl,
						params: after.params as Prisma.InputJsonValue,
					},
				},
				tx,
			);
		});

		invalidateProviderConfigCache();
		return { success: true };
	} catch (e) {
		console.error("[superadmin] saveAiProviderConfig error:", e);
		if (isSchemaOutOfDate(e)) {
			return {
				error:
					"The AI provider table is behind this build. Apply the pending migrations, then try again.",
			};
		}
		return { error: "Failed to save the provider configuration." };
	}
}

export interface CreateAiProviderInput {
	provider: string;
	label: string;
	baseUrl: string;
	model?: string;
	priority: number;
	reason: string;
}

/** Adds an OpenAI-compatible provider instance (#432). */
export async function createAiProvider(
	input: CreateAiProviderInput,
): Promise<AiProviderActionResult> {
	await requirePlatformAdmin();

	let reason: string;
	try {
		reason = requireReason(input.reason);
	} catch (e) {
		return { error: e instanceof Error ? e.message : "A reason is required." };
	}

	const slug = input.provider.trim().toLowerCase();
	if (!PROVIDER_SLUG_PATTERN.test(slug)) {
		return {
			error:
				"Provider id must be 2-31 characters: lower-case letters, digits and dashes, starting with a letter.",
		};
	}
	if (isBuiltInProvider(slug) || slug === CUSTOM_PROVIDER_KIND) {
		return { error: "That provider id is reserved." };
	}

	const label = input.label.trim();
	if (label.length < 2 || label.length > MAX_LABEL_LENGTH) {
		return { error: `Label must be between 2 and ${MAX_LABEL_LENGTH} characters.` };
	}

	const checked = checkProviderBaseUrl(input.baseUrl);
	if (!checked.ok) return { error: checked.error };

	const model = input.model?.trim() ?? "";
	if (model.length > MAX_MODEL_LENGTH) {
		return { error: `Model must be at most ${MAX_MODEL_LENGTH} characters.` };
	}

	const priority = Number(input.priority);
	if (!Number.isInteger(priority) || priority < 0 || priority > 1000) {
		return { error: "Priority must be a whole number between 0 and 1000." };
	}

	try {
		const existing = await prisma.aiProviderConfig.findUnique({ where: { provider: slug } });
		if (existing) return { error: `A provider with the id "${slug}" already exists.` };

		const actor = await actorId();
		await prisma.$transaction(async (tx) => {
			await tx.aiProviderConfig.create({
				data: {
					provider: slug,
					kind: CUSTOM_PROVIDER_KIND,
					label,
					baseUrl: checked.url,
					enabled: true,
					priority,
					model: model || null,
					params: { reasoningEffort: "none" },
				},
			});
			await audit(
				{
					action: PROVIDER_ACTIONS.create,
					targetId: slug,
					reason,
					actorUserId: actor,
					after: {
						kind: CUSTOM_PROVIDER_KIND,
						label,
						baseUrl: checked.url,
						priority,
						model: model || null,
					},
				},
				tx,
			);
		});

		invalidateProviderConfigCache();
		return { success: true };
	} catch (e) {
		console.error("[superadmin] createAiProvider error:", e);
		if (isSchemaOutOfDate(e)) {
			return {
				error:
					"The AI provider table is behind this build. Apply the pending migrations, then try again.",
			};
		}
		return { error: "Failed to add the provider." };
	}
}

/** Removes a console-created provider (built-ins can only be disabled). */
export async function removeAiProvider(
	provider: string,
	reason: string,
): Promise<AiProviderActionResult> {
	await requirePlatformAdmin();
	if (isBuiltInProvider(provider)) {
		return { error: "Built-in providers cannot be removed. Disable the provider instead." };
	}

	let trimmedReason: string;
	try {
		trimmedReason = requireReason(reason);
	} catch (e) {
		return { error: e instanceof Error ? e.message : "A reason is required." };
	}

	try {
		const actor = await actorId();
		await withStepUp(async (stepUpAt) => {
			const before = await prisma.aiProviderConfig.findUnique({ where: { provider } });
			if (!before) throw new Error("NOT_FOUND");

			await prisma.$transaction(async (tx) => {
				await tx.aiProviderConfig.delete({ where: { provider } });
				await audit(
					{
						action: PROVIDER_ACTIONS.remove,
						targetId: provider,
						reason: trimmedReason,
						actorUserId: actor,
						stepUpAt,
						before: {
							label: before.label,
							baseUrl: before.baseUrl,
							priority: before.priority,
							model: before.model,
							keyPresent: Boolean(before.keyCiphertext),
						},
					},
					tx,
				);
			});
		});

		invalidateProviderConfigCache();
		return { success: true };
	} catch (e) {
		if (e instanceof Error && e.message === "NOT_FOUND") {
			return { error: "That provider does not exist." };
		}
		const stepUp = stepUpFailure(e);
		if (stepUp) return stepUp;
		console.error("[superadmin] removeAiProvider error:", e);
		return { error: "Failed to remove the provider." };
	}
}

function sanitizeProviderError(error: unknown, apiKey: string): string {
	const raw = error instanceof Error ? error.message : String(error);
	const withoutKey = apiKey ? raw.split(apiKey).join("[redacted]") : raw;
	return withoutKey.replace(/\s+/g, " ").trim().slice(0, 300) || "The provider rejected the key.";
}

function runtimeConfigFor(
	adapter: AiProvider,
	slug: string,
	row: {
		model: string | null;
		params: unknown;
		baseUrl: string | null;
	},
	apiKey: string,
): AiProviderRuntimeConfig {
	return {
		provider: slug,
		kind: adapter.id,
		model: row.model?.trim() || adapter.defaultModel,
		apiKey,
		reasoningEffort: parseReasoningEffort(
			(row.params as { reasoningEffort?: unknown } | null)?.reasoningEffort
				? String((row.params as { reasoningEffort?: unknown }).reasoningEffort)
				: "none",
		),
		params:
			row.params && typeof row.params === "object" ? (row.params as Record<string, unknown>) : {},
		...(row.baseUrl ? { baseUrl: row.baseUrl } : {}),
	};
}

async function testProviderKey(
	adapter: AiProvider,
	config: AiProviderRuntimeConfig,
): Promise<{ ok: true; latencyMs: number } | { ok: false; error: string }> {
	const started = Date.now();
	try {
		const result = await Promise.race([
			adapter.complete({
				turns: [{ role: "user", text: "ping" }],
				systemPrompt: "Reply with the single word OK.",
				sessionId: "provider-key-test",
				config,
			}),
			new Promise<never>((_, reject) => {
				setTimeout(
					() => reject(new Error("The provider did not answer within 15 seconds.")),
					KEY_TEST_TIMEOUT_MS,
				);
			}),
		]);
		if (!result) return { ok: false, error: "The provider returned no response." };
		return { ok: true, latencyMs: Date.now() - started };
	} catch (error) {
		return { ok: false, error: sanitizeProviderError(error, config.apiKey) };
	}
}

export interface SetAiProviderKeyInput {
	provider: string;
	apiKey: string;
	reason: string;
}

/**
 * Set or rotate a provider key (#432).
 *
 * The key is tested against the real provider first; only a passing key is
 * encrypted and stored, so a typo or an expired credential never replaces the
 * working one. Requires a fresh step-up.
 */
export async function setAiProviderKey(input: SetAiProviderKeyInput): Promise<SetKeyResult> {
	await requirePlatformAdmin();

	let reason: string;
	try {
		reason = requireReason(input.reason);
	} catch (e) {
		return { error: e instanceof Error ? e.message : "A reason is required." };
	}

	const apiKey = input.apiKey?.trim() ?? "";
	if (apiKey.length < MIN_KEY_LENGTH || apiKey.length > MAX_KEY_LENGTH) {
		return { error: `The key must be between ${MIN_KEY_LENGTH} and ${MAX_KEY_LENGTH} characters.` };
	}
	if (/\s/.test(apiKey)) {
		return { error: "The key must not contain spaces or line breaks." };
	}

	try {
		const actor = await actorId();
		return await withStepUp(async (stepUpAt) => {
			const existing = (await prisma.aiProviderConfig.findUnique({
				where: { provider: input.provider },
			})) as unknown as StoredProviderRow | null;

			const kind = existing?.kind?.trim() || input.provider;
			const adapter = getProvider(kind);
			if (!adapter) return { error: `Unknown provider "${input.provider}".` };

			if (kind === CUSTOM_PROVIDER_KIND && !existing?.baseUrl) {
				return { error: "Save the provider base URL before adding a key." };
			}

			// Check the store before spending a live provider call.
			if (!isSecretStorageConfigured()) {
				return {
					error:
						"AI_SECRET_KEY is not configured, so the key cannot be stored. Add it to the environment, then try again.",
				};
			}

			const test = await testProviderKey(
				adapter,
				runtimeConfigFor(
					adapter,
					input.provider,
					{
						model: existing?.model ?? null,
						params: existing?.params ?? null,
						baseUrl: existing?.baseUrl ?? null,
					},
					apiKey,
				),
			);

			if (!test.ok) {
				await prisma.$transaction(async (tx) => {
					await audit(
						{
							action: PROVIDER_ACTIONS.keyTestFailed,
							targetId: input.provider,
							reason,
							actorUserId: actor,
							stepUpAt,
							after: { error: test.error },
						},
						tx,
					);
				});
				return { error: `The provider rejected this key: ${test.error}` };
			}

			const encrypted = encryptProviderKey(input.provider, apiKey);
			if (!encrypted) {
				return { error: "The key could not be encrypted. Check AI_SECRET_KEY and try again." };
			}

			const testedAt = new Date();
			const defaultPriority =
				DEFAULT_PROVIDER_ROWS.find((row) => row.provider === input.provider)?.priority ?? 100;
			await prisma.$transaction(async (tx) => {
				await tx.aiProviderConfig.upsert({
					where: { provider: input.provider },
					create: {
						provider: input.provider,
						kind: existing?.kind ?? null,
						enabled: true,
						priority: existing?.priority ?? defaultPriority,
						model: existing?.model ?? null,
						apiKeyEnv: existing?.apiKeyEnv ?? null,
						label: existing?.label ?? null,
						baseUrl: existing?.baseUrl ?? null,
						params: (existing?.params ?? null) as Prisma.InputJsonValue,
						...keyMaterialToColumns(encrypted),
						keyLast4: keyHint(apiKey),
						keyUpdatedAt: testedAt,
						keyUpdatedBy: actor,
					},
					update: {
						...keyMaterialToColumns(encrypted),
						keyLast4: keyHint(apiKey),
						keyUpdatedAt: testedAt,
						keyUpdatedBy: actor,
					},
				});

				await audit(
					{
						action: PROVIDER_ACTIONS.setKey,
						targetId: input.provider,
						reason,
						actorUserId: actor,
						stepUpAt,
						before: existing?.keyLast4 ? { keyLast4: existing.keyLast4 } : undefined,
						after: {
							keyLast4: keyHint(apiKey),
							keyVersion: encrypted.keyVersion,
							testedAt: testedAt.toISOString(),
							latencyMs: test.latencyMs,
						},
					},
					tx,
				);
			});

			invalidateProviderConfigCache();
			return {
				success: true,
				testedAt: testedAt.toISOString(),
				latencyMs: test.latencyMs,
			} satisfies SetKeyResult;
		});
	} catch (e) {
		const stepUp = stepUpFailure(e);
		if (stepUp) return stepUp;
		console.error("[superadmin] setAiProviderKey error:", e);
		if (isSchemaOutOfDate(e)) {
			return {
				error:
					"The AI provider table is behind this build. Apply the pending migrations, then try again.",
			};
		}
		return { error: "Failed to save the key." };
	}
}

/** Clear a stored key, returning the provider to its environment fallback. */
export async function clearAiProviderKey(
	provider: string,
	reason: string,
): Promise<AiProviderActionResult> {
	await requirePlatformAdmin();

	let trimmedReason: string;
	try {
		trimmedReason = requireReason(reason);
	} catch (e) {
		return { error: e instanceof Error ? e.message : "A reason is required." };
	}

	try {
		const actor = await actorId();
		return await withStepUp(async (stepUpAt) => {
			const existing = await prisma.aiProviderConfig.findUnique({ where: { provider } });
			if (!existing) return { error: "That provider has no stored configuration." };

			await prisma.$transaction(async (tx) => {
				await tx.aiProviderConfig.update({
					where: { provider },
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
						targetId: provider,
						reason: trimmedReason,
						actorUserId: actor,
						stepUpAt,
						before: existing.keyLast4 ? { keyLast4: existing.keyLast4 } : undefined,
						after: { keySource: "env" },
					},
					tx,
				);
			});

			invalidateProviderConfigCache();
			return { success: true };
		});
	} catch (e) {
		const stepUp = stepUpFailure(e);
		if (stepUp) return stepUp;
		console.error("[superadmin] clearAiProviderKey error:", e);
		return { error: "Failed to clear the key." };
	}
}

/** Removes every stored row (including keys), returning to built-in defaults. */
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
		return await withStepUp(async (stepUpAt) => {
			const rows = await prisma.aiProviderConfig.findMany();

			await prisma.$transaction(async (tx) => {
				await tx.aiProviderConfig.deleteMany();
				await audit(
					{
						action: PROVIDER_ACTIONS.reset,
						targetId: "ai_provider_chain",
						reason: trimmedReason,
						actorUserId: actor,
						stepUpAt,
						before: rows.map((r) => ({
							provider: r.provider,
							enabled: r.enabled,
							priority: r.priority,
							model: r.model,
							apiKeyEnv: r.apiKeyEnv,
							kind: r.kind,
							keyPresent: Boolean(r.keyCiphertext),
						})) as Prisma.InputJsonValue,
						after: [] as Prisma.InputJsonValue,
					},
					tx,
				);
			});

			invalidateProviderConfigCache();
			return { success: true };
		});
	} catch (e) {
		const stepUp = stepUpFailure(e);
		if (stepUp) return stepUp;
		console.error("[superadmin] resetAiProviderConfig error:", e);
		if (isSchemaOutOfDate(e)) {
			// Nothing stored to reset — the chain is already on defaults.
			invalidateProviderConfigCache();
			return { success: true };
		}
		return { error: "Failed to reset the provider configuration." };
	}
}
