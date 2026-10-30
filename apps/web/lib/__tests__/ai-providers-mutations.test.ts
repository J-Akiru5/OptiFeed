import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Saving or resetting the platform AI chain changes which model answers every
 * farm's assistant, so each mutation must be validated, audited with the
 * before/after rows, and must report a failure instead of a false success. The
 * env-var column may only ever hold a NAME.
 */

const { db, tx } = vi.hoisted(() => {
	const tx = {
		aiProviderConfig: { upsert: vi.fn(), deleteMany: vi.fn() },
		platformAuditLog: { create: vi.fn() },
	};
	const db = {
		aiProviderConfig: { findMany: vi.fn(), findUnique: vi.fn(), upsert: vi.fn() },
		$transaction: vi.fn(),
	};
	return { db, tx };
});

vi.mock("@/lib/prisma", () => ({ default: db }));
vi.mock("@/lib/auth/require-platform-admin", () => ({ requirePlatformAdmin: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ getCurrentUser: vi.fn() }));

import { resetAiProviderConfig, saveAiProviderConfig } from "@/lib/actions/ai-providers";
import { requirePlatformAdmin } from "@/lib/auth/require-platform-admin";
import { getCurrentUser } from "@/lib/auth/session";

const mockGate = vi.mocked(requirePlatformAdmin);
const mockUser = vi.mocked(getCurrentUser);
const REASON = "Moving the primary model after a provider outage";

const STORED = {
	provider: "opencode-go",
	enabled: true,
	priority: 10,
	model: "deepseek-v4.1-flash",
	apiKeyEnv: "OPENCODE_GO_API_KEY",
	params: { reasoningEffort: "high" },
};

const INPUT = {
	provider: "opencode-go",
	enabled: false,
	priority: 20,
	model: " custom-model ",
	apiKeyEnv: " CUSTOM_KEY ",
	reason: REASON,
};

beforeEach(() => {
	vi.clearAllMocks();
	mockGate.mockResolvedValue(undefined);
	mockUser.mockResolvedValue({ id: "admin-1" } as Awaited<ReturnType<typeof getCurrentUser>>);
	db.$transaction.mockImplementation(async (fn: (client: typeof tx) => Promise<unknown>) => fn(tx));
	db.aiProviderConfig.findUnique.mockResolvedValue(null);
	db.aiProviderConfig.findMany.mockResolvedValue([]);
	tx.aiProviderConfig.upsert.mockImplementation(async (args: { create: unknown }) => args.create);
	tx.platformAuditLog.create.mockResolvedValue({});
});

describe("saveAiProviderConfig", () => {
	it("denies a caller who is not a platform admin before any read", async () => {
		mockGate.mockRejectedValue(new Error("NEXT_REDIRECT"));

		await expect(saveAiProviderConfig(INPUT)).rejects.toThrow("NEXT_REDIRECT");
		expect(db.aiProviderConfig.findUnique).not.toHaveBeenCalled();
	});

	it("rejects a model name longer than 100 characters", async () => {
		const result = await saveAiProviderConfig({ ...INPUT, model: "m".repeat(101) });

		expect(result).toEqual({ error: "Model must be at most 100 characters." });
		expect(db.$transaction).not.toHaveBeenCalled();
	});

	it("rejects a fractional priority", async () => {
		const result = await saveAiProviderConfig({ ...INPUT, priority: 1.5 });

		expect(result).toEqual({ error: "Priority must be a whole number between 0 and 1000." });
	});

	it("stores trimmed values and audits the new row as the after state", async () => {
		const result = await saveAiProviderConfig({ ...INPUT, reasoningEffort: "low" });

		expect(result).toEqual({ success: true });
		expect(tx.aiProviderConfig.upsert).toHaveBeenCalledWith({
			where: { provider: "opencode-go" },
			create: {
				provider: "opencode-go",
				enabled: false,
				priority: 20,
				model: "custom-model",
				apiKeyEnv: "CUSTOM_KEY",
				params: { reasoningEffort: "low" },
			},
			update: {
				enabled: false,
				priority: 20,
				model: "custom-model",
				apiKeyEnv: "CUSTOM_KEY",
				params: { reasoningEffort: "low" },
			},
		});

		const row = tx.platformAuditLog.create.mock.calls[0][0].data;
		expect(row).toMatchObject({
			action: "platform.ai_provider.update",
			targetType: "ai_provider",
			targetId: "opencode-go",
			reason: REASON,
			actorUserId: "admin-1",
			after: {
				enabled: false,
				priority: 20,
				model: "custom-model",
				apiKeyEnv: "CUSTOM_KEY",
				params: { reasoningEffort: "low" },
			},
		});
		// No previous row means there is no before state to diff against.
		expect(row).not.toHaveProperty("before");
	});

	it("records the previous row as the before state", async () => {
		db.aiProviderConfig.findUnique.mockResolvedValue(STORED);

		await saveAiProviderConfig(INPUT);

		expect(tx.platformAuditLog.create.mock.calls[0][0].data.before).toEqual({
			enabled: true,
			priority: 10,
			model: "deepseek-v4.1-flash",
			apiKeyEnv: "OPENCODE_GO_API_KEY",
			params: { reasoningEffort: "high" },
		});
	});

	it("stores nulls for an empty model and env name", async () => {
		await saveAiProviderConfig({ ...INPUT, model: "", apiKeyEnv: "" });

		expect(tx.aiProviderConfig.upsert.mock.calls[0][0].create).toMatchObject({
			model: null,
			apiKeyEnv: null,
		});
	});

	it("reports a generic failure when the transaction throws", async () => {
		const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
		db.$transaction.mockRejectedValueOnce(new Error("deadlock"));

		await expect(saveAiProviderConfig(INPUT)).resolves.toEqual({
			error: "Failed to save the provider configuration.",
		});
		spy.mockRestore();
	});

	it("reports a generic failure when the actor is not authenticated", async () => {
		const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
		mockUser.mockResolvedValueOnce(null);

		await expect(saveAiProviderConfig(INPUT)).resolves.toEqual({
			error: "Failed to save the provider configuration.",
		});
		expect(db.$transaction).not.toHaveBeenCalled();
		spy.mockRestore();
	});
});

describe("resetAiProviderConfig", () => {
	it("requires a reason", async () => {
		await expect(resetAiProviderConfig("short")).resolves.toEqual({
			error: expect.stringContaining("at least 10 characters"),
		});
		expect(db.$transaction).not.toHaveBeenCalled();
	});

	it("deletes every row and audits the removed chain", async () => {
		db.aiProviderConfig.findMany.mockResolvedValue([STORED]);

		await expect(resetAiProviderConfig(REASON)).resolves.toEqual({ success: true });

		expect(tx.aiProviderConfig.deleteMany).toHaveBeenCalledTimes(1);
		const row = tx.platformAuditLog.create.mock.calls[0][0].data;
		expect(row).toMatchObject({
			action: "platform.ai_provider.reset",
			targetType: "ai_provider",
			targetId: "ai_provider_chain",
			reason: REASON,
			after: [],
		});
		expect(row.before).toEqual([
			{
				provider: "opencode-go",
				enabled: true,
				priority: 10,
				model: "deepseek-v4.1-flash",
				apiKeyEnv: "OPENCODE_GO_API_KEY",
			},
		]);
	});

	it("treats a missing table as already reset", async () => {
		const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
		db.$transaction.mockRejectedValueOnce(
			Object.assign(new Error("relation does not exist"), { code: "P2021" }),
		);

		await expect(resetAiProviderConfig(REASON)).resolves.toEqual({ success: true });
		spy.mockRestore();
	});

	it("reports a failure when the delete fails for another reason", async () => {
		const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
		db.$transaction.mockRejectedValueOnce(new Error("permission denied"));

		await expect(resetAiProviderConfig(REASON)).resolves.toEqual({
			error: "Failed to reset the provider configuration.",
		});
		spy.mockRestore();
	});
});
