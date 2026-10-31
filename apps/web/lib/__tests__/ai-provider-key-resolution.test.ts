import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { findMany } = vi.hoisted(() => ({ findMany: vi.fn() }));

vi.mock("@/lib/prisma", () => ({
	default: { aiProviderConfig: { findMany: (...args: unknown[]) => findMany(...args) } },
}));

import { invalidateProviderConfigCache, loadProviderConfigs } from "@/lib/ai-providers/config";
import { CURRENT_KEY_VERSION, encryptSecret, secretAad } from "@/lib/ai-providers/secret";

/**
 * Resolution order (issue #432): an authenticated DB ciphertext wins, then the
 * configured environment variable. A key that cannot be read must not take the
 * provider out of the chain when env still has one, and must never log a value.
 */

const MASTER = randomBytes(32).toString("base64");
const DB_KEY = "sk-db-SENTINEL-9876";
const ENV_KEY = "sk-env-SENTINEL-5432";

interface TestRow {
	provider: string;
	enabled: boolean;
	priority: number;
	model: string | null;
	apiKeyEnv: string | null;
	params: unknown;
	keyCiphertext?: Uint8Array;
	keyIv?: Uint8Array;
	keyTag?: Uint8Array;
	keyVersion?: number;
}

function row(overrides: Partial<TestRow> = {}): TestRow {
	return {
		provider: "opencode-go",
		enabled: true,
		priority: 1,
		model: null,
		apiKeyEnv: null,
		params: null,
		...overrides,
	};
}

function encryptedRow(keyVersion = CURRENT_KEY_VERSION) {
	const encrypted = encryptSecret(DB_KEY, secretAad("opencode-go", keyVersion));
	return row({
		keyCiphertext: new Uint8Array(encrypted.keyCiphertext),
		keyIv: new Uint8Array(encrypted.keyIv),
		keyTag: new Uint8Array(encrypted.keyTag),
		keyVersion,
	});
}

beforeEach(() => {
	invalidateProviderConfigCache();
	findMany.mockReset();
	process.env.AI_SECRET_KEY = MASTER;
	process.env.AI_SECRET_KEY_PREVIOUS = "";
	vi.stubEnv("OPENCODE_GO_API_KEY", ENV_KEY);
	vi.stubEnv("GEMINI_API_KEY", "");
});

afterEach(() => {
	vi.unstubAllEnvs();
	process.env.AI_SECRET_KEY = "";
	process.env.AI_SECRET_KEY_PREVIOUS = "";
});

describe("provider key resolution", () => {
	it("uses an authenticated DB key ahead of the environment", async () => {
		findMany.mockResolvedValue([encryptedRow()]);

		const configs = await loadProviderConfigs();

		expect(configs[0]).toMatchObject({ provider: "opencode-go", apiKey: DB_KEY, keySource: "db" });
	});

	it("uses the environment when the row has no stored key", async () => {
		findMany.mockResolvedValue([row()]);

		const configs = await loadProviderConfigs();

		expect(configs[0]).toMatchObject({ apiKey: ENV_KEY, keySource: "env" });
	});

	it("falls back to the environment when the ciphertext cannot be authenticated", async () => {
		const stored = encryptedRow();
		const ciphertext = Buffer.from(stored.keyCiphertext as Uint8Array);
		ciphertext[0] ^= 0xff;
		findMany.mockResolvedValue([{ ...stored, keyCiphertext: ciphertext }]);
		const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

		const configs = await loadProviderConfigs();

		expect(configs[0]).toMatchObject({ apiKey: ENV_KEY, keySource: "env" });
		const logged = warn.mock.calls.flat().join(" ");
		expect(logged).toContain("unreadable");
		expect(logged).not.toContain(DB_KEY);
		expect(logged).not.toContain(ENV_KEY);
		warn.mockRestore();
	});

	it("falls back to the environment when AI_SECRET_KEY is not configured", async () => {
		findMany.mockResolvedValue([encryptedRow()]);
		process.env.AI_SECRET_KEY = "";
		const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

		const configs = await loadProviderConfigs();

		expect(configs[0]).toMatchObject({ apiKey: ENV_KEY, keySource: "env" });
		const logged = warn.mock.calls.flat().join(" ");
		expect(logged).toContain("missing_master_key");
		expect(logged).not.toContain(DB_KEY);
		warn.mockRestore();
	});

	it("skips a provider with neither a readable DB key nor an env key", async () => {
		findMany.mockResolvedValue([encryptedRow()]);
		process.env.AI_SECRET_KEY = "";
		vi.stubEnv("OPENCODE_GO_API_KEY", "");
		const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

		expect(await loadProviderConfigs()).toEqual([]);
		warn.mockRestore();
	});

	it("reads legacy columns when the key migration has not been applied", async () => {
		const missingColumn = Object.assign(
			new Error("The column `AiProviderConfig.keyCiphertext` does not exist"),
			{ code: "P2022" },
		);
		findMany.mockRejectedValueOnce(missingColumn).mockResolvedValueOnce([
			{
				provider: "opencode-go",
				enabled: true,
				priority: 2,
				model: "legacy-model",
				apiKeyEnv: null,
				params: null,
			},
		]);

		const configs = await loadProviderConfigs();

		expect(configs[0]).toMatchObject({
			provider: "opencode-go",
			model: "legacy-model",
			apiKey: ENV_KEY,
			keySource: "env",
		});
		expect(findMany).toHaveBeenCalledTimes(2);
		expect(findMany.mock.calls[1][0]).toMatchObject({
			select: expect.objectContaining({ provider: true, apiKeyEnv: true }),
		});
	});

	it("invalidates the 30-second cache on demand", async () => {
		findMany.mockResolvedValue([row()]);
		expect((await loadProviderConfigs())[0].apiKey).toBe(ENV_KEY);

		vi.stubEnv("OPENCODE_GO_API_KEY", "sk-env-rotated");
		// Still cached: a change to the environment alone must not leak through.
		expect((await loadProviderConfigs())[0].apiKey).toBe(ENV_KEY);

		invalidateProviderConfigCache();
		expect((await loadProviderConfigs())[0].apiKey).toBe("sk-env-rotated");
	});

	it("recognises a missing column from the message when no code is attached", async () => {
		findMany
			.mockRejectedValueOnce(
				new Error(
					"The column `AiProviderConfig.keyCiphertext` does not exist in the current database.",
				),
			)
			.mockResolvedValueOnce([row({ priority: 3 })]);

		const configs = await loadProviderConfigs();

		expect(configs[0]).toMatchObject({ provider: "opencode-go", apiKey: ENV_KEY });
		expect(findMany).toHaveBeenCalledTimes(2);
	});

	it("falls back to defaults when the legacy retry also fails", async () => {
		findMany
			.mockRejectedValueOnce(Object.assign(new Error("column missing"), { code: "P2022" }))
			.mockRejectedValueOnce(new Error("db down"));
		const error = vi.spyOn(console, "error").mockImplementation(() => undefined);

		const configs = await loadProviderConfigs();

		expect(configs.map((config) => config.provider)).toEqual(["opencode-go"]);
		expect(configs[0].keySource).toBe("env");
		error.mockRestore();
	});

	it("skips an unknown provider instead of exposing its row", async () => {
		findMany.mockResolvedValue([row({ provider: "retired-vendor" })]);
		const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

		const configs = await loadProviderConfigs();

		expect(configs.map((config) => config.provider)).not.toContain("retired-vendor");
		expect(warn.mock.calls.flat().join(" ")).toContain('unknown provider "retired-vendor"');
		warn.mockRestore();
	});

	it("reports source and presence in aiDebugInfo, never the value", async () => {
		const { aiDebugInfo } = await import("@/lib/ai");
		const info = await aiDebugInfo({
			configs: [
				{
					provider: "opencode-go",
					model: "m",
					apiKey: DB_KEY,
					keySource: "db",
					reasoningEffort: "high",
					params: {},
				},
			],
		});

		expect(info.providers[0]).toEqual({
			provider: "opencode-go",
			model: "m",
			keySource: "db",
			hasKey: true,
		});
		expect(JSON.stringify(info)).not.toContain(DB_KEY);
	});
});
