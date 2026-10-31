import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { findMany, upsert, findUnique, deleteMany } = vi.hoisted(() => ({
	findMany: vi.fn(),
	upsert: vi.fn(),
	findUnique: vi.fn(),
	deleteMany: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
	default: {
		aiProviderConfig: { findMany, upsert, findUnique, deleteMany },
		platformAuditLog: { create: vi.fn() },
		$transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
			fn({
				aiProviderConfig: { upsert, deleteMany },
				platformAuditLog: { create: vi.fn() },
			}),
		),
	},
}));

vi.mock("@/lib/auth/require-platform-admin", () => ({
	requirePlatformAdmin: vi.fn(async () => undefined),
}));

vi.mock("@/lib/auth/session", () => ({
	getCurrentUser: vi.fn(async () => ({ id: "admin-1" })),
}));

import { listAiProviderConfig, saveAiProviderConfig } from "@/lib/actions/ai-providers";

const missingTableError = Object.assign(
	new Error('relation "AiProviderConfig" does not exist in the current database'),
	{ code: "P2021" },
);

beforeEach(() => {
	vi.stubEnv("OPENCODE_GO_API_KEY", "go-key");
	vi.stubEnv("GEMINI_API_KEY", "");
	findMany.mockReset();
	upsert.mockReset();
	findUnique.mockReset();
	deleteMany.mockReset();
});

afterEach(() => {
	vi.unstubAllEnvs();
});

describe("listAiProviderConfig before the migration is applied", () => {
	it("renders built-in defaults instead of throwing when the table is missing", async () => {
		findMany.mockRejectedValue(missingTableError);

		const providers = await listAiProviderConfig();

		expect(providers.map((p) => p.provider)).toEqual(["opencode-go", "gemini"]);
		expect(providers.every((p) => p.configured === false)).toBe(true);
		expect(providers[0]).toMatchObject({
			provider: "opencode-go",
			enabled: true,
			model: "deepseek-v4.1-flash",
			apiKeyEnv: "OPENCODE_GO_API_KEY",
			apiKeyPresent: true,
		});
		// Gemini has no key in this environment, so the console must say so.
		expect(providers[1].apiKeyPresent).toBe(false);
	});

	it("never exposes a key value", async () => {
		findMany.mockRejectedValue(missingTableError);
		const providers = await listAiProviderConfig();
		expect(JSON.stringify(providers)).not.toContain("go-key");
	});

	it("merges a stored row over the defaults", async () => {
		findMany.mockResolvedValue([
			{
				provider: "opencode-go",
				enabled: false,
				priority: 5,
				model: "custom-model",
				apiKeyEnv: "CUSTOM_KEY",
				params: { reasoningEffort: "low" },
			},
		]);
		vi.stubEnv("CUSTOM_KEY", "x");

		const providers = await listAiProviderConfig();
		const go = providers.find((p) => p.provider === "opencode-go");
		expect(go).toMatchObject({
			configured: true,
			enabled: false,
			priority: 5,
			model: "custom-model",
			apiKeyEnv: "CUSTOM_KEY",
			reasoningEffort: "low",
		});
	});
});

describe("saveAiProviderConfig before the migration is applied", () => {
	it("returns an actionable message instead of a generic failure", async () => {
		findUnique.mockResolvedValue(null);
		upsert.mockRejectedValue(missingTableError);

		const result = await saveAiProviderConfig({
			provider: "opencode-go",
			enabled: true,
			priority: 10,
			reason: "adjusting the primary model",
		});

		expect(result.error).toContain("behind this build");
	});
});

describe("saveAiProviderConfig validation", () => {
	it("rejects an unknown provider", async () => {
		const result = await saveAiProviderConfig({
			provider: "not-a-provider",
			enabled: true,
			priority: 10,
			reason: "trying something unknown",
		});
		expect(result.error).toContain("Unknown provider");
	});

	it("rejects a pasted key where an env var name belongs", async () => {
		const result = await saveAiProviderConfig({
			provider: "opencode-go",
			enabled: true,
			priority: 10,
			apiKeyEnv: "sk-or-v1-abcdef123456",
			reason: "pasting a key by mistake",
		});
		expect(result.error).toContain("upper-case name");
	});

	it("requires a reason of at least 10 characters", async () => {
		const result = await saveAiProviderConfig({
			provider: "opencode-go",
			enabled: true,
			priority: 10,
			reason: "short",
		});
		expect(result.error).toContain("at least 10 characters");
	});

	it("rejects an out-of-range priority", async () => {
		const result = await saveAiProviderConfig({
			provider: "opencode-go",
			enabled: true,
			priority: 5000,
			reason: "checking priority bounds",
		});
		expect(result.error).toContain("Priority");
	});
});
