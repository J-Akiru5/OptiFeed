"use server";

import { DEFAULT_PROVIDER_ROWS, invalidateProviderConfigCache } from "@/lib/ai-providers/config";
import { parseReasoningEffort } from "@/lib/ai-providers/reasoning";
import { getProvider, listProviders } from "@/lib/ai-providers/registry";
import type { ReasoningEffort } from "@/lib/ai-providers/types";
import { requirePlatformAdmin } from "@/lib/auth/require-platform-admin";
import { getCurrentUser } from "@/lib/auth/session";
import prisma from "@/lib/prisma";
import type { Prisma } from "@prisma/client";

/**
 * Platform-global AI provider chain, managed from /superadmin.
 *
 * Secrets never pass through this module. A row names the environment variable
 * that holds a key (`apiKeyEnv`); the UI only ever learns whether that variable
 * is populated, never its value.
 *
 * Every mutation is audited through PlatformAuditLog with a required reason,
 * matching the rest of the platform console.
 */

const MIN_REASON_LENGTH = 10;
const MAX_MODEL_LENGTH = 100;

const PROVIDER_ACTIONS = {
	update: "platform.ai_provider.update",
	reset: "platform.ai_provider.reset",
} as const;

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
	reasoningEffort: ReasoningEffort;
}

export interface AiProviderActionResult {
	success?: boolean;
	error?: string;
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
			...(data.before !== undefined ? { before: data.before } : {}),
			...(data.after !== undefined ? { after: data.after } : {}),
		},
	});
}

/**
 * The full chain as the console should render it: every registered provider,
 * in priority order, merged with any stored row and its default fallback.
 *
 * Tolerates the table being absent, which is the normal state until migration
 * 20261022000000_add_ai_provider_config is applied: every provider then renders
 * as "using built-in default" instead of the page failing with a 500.
 */
export async function listAiProviderConfig(): Promise<AiProviderView[]> {
	await requirePlatformAdmin();

	let rows: Awaited<ReturnType<typeof prisma.aiProviderConfig.findMany>> = [];
	try {
		rows = await prisma.aiProviderConfig.findMany({ orderBy: { priority: "asc" } });
	} catch (error) {
		console.warn("[superadmin] AiProviderConfig unavailable; rendering built-in defaults:", error);
	}

	const byProvider = new Map(rows.map((row) => [row.provider, row]));
	// Mirror the runtime's built-in ordering so the console never displays a
	// chain order that differs from what lib/ai-providers/config.ts resolves.
	const defaultPriority = new Map(DEFAULT_PROVIDER_ROWS.map((r) => [r.provider, r.priority]));

	const views = listProviders().map((provider) => {
		const row = byProvider.get(provider.id);
		const params = (row?.params ?? null) as { reasoningEffort?: unknown } | null;
		const apiKeyEnv = row?.apiKeyEnv?.trim() || provider.defaultApiKeyEnv;
		return {
			provider: provider.id,
			label: provider.label,
			configured: Boolean(row),
			enabled: row?.enabled ?? true,
			priority: row?.priority ?? defaultPriority.get(provider.id) ?? 100,
			model: row?.model?.trim() || provider.defaultModel,
			apiKeyEnv,
			apiKeyPresent: Boolean(process.env[apiKeyEnv]?.trim()),
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
		const before = await prisma.aiProviderConfig.findUnique({
			where: { provider: provider.id },
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
		console.error("[superadmin] saveAiProviderConfig error:", e);
		if (isMissingTable(e)) {
			return {
				error:
					"The AI provider table does not exist yet. Apply migration 20261022000000_add_ai_provider_config, then try again.",
			};
		}
		return { error: "Failed to save the provider configuration." };
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
		const rows = await prisma.aiProviderConfig.findMany();

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
		console.error("[superadmin] resetAiProviderConfig error:", e);
		if (isMissingTable(e)) {
			// Nothing stored to reset — the chain is already on defaults.
			invalidateProviderConfigCache();
			return { success: true };
		}
		return { error: "Failed to reset the provider configuration." };
	}
}
