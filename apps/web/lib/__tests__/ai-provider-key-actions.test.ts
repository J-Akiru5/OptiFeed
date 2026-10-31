import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Key management actions (issue #432).
 *
 * A submitted key must only reach the provider adapter in memory and the
 * encrypted columns at rest. The previous key stays active when the live test
 * fails, step-up is required for writes, and no audit row, log line or client
 * prop may contain the plaintext or the ciphertext.
 */

const SENTINEL = "sk-TEST-SENTINEL-1234";
const PREVIOUS_KEY = "sk-PREVIOUS-SENTINEL-0000";
const STEP_UP_AT = new Date("2026-10-31T12:00:00.000Z");
const REASON = "Rotating the provider key after a vendor incident";

const { db, tx, withStepUpMock, rateLimitMock } = vi.hoisted(() => {
	const tx = {
		aiProviderConfig: { upsert: vi.fn(), updateMany: vi.fn() },
		platformAuditLog: { create: vi.fn() },
	};
	const db = {
		aiProviderConfig: {
			findUnique: vi.fn(),
			findMany: vi.fn(),
			upsert: vi.fn(),
			updateMany: vi.fn(),
		},
		platformAuditLog: { create: vi.fn() },
		$transaction: vi.fn(),
	};
	return {
		db,
		tx,
		withStepUpMock: vi.fn(),
		rateLimitMock: vi.fn(),
	};
});

vi.mock("@/lib/prisma", () => ({ default: db }));
vi.mock("@/lib/auth/require-platform-admin", () => ({
	requirePlatformAdmin: vi.fn(async () => undefined),
}));
vi.mock("@/lib/auth/session", () => ({
	getCurrentUser: vi.fn(async () => ({ id: "admin-1" })),
}));
vi.mock("@/lib/auth/step-up", () => ({
	withStepUp: withStepUpMock,
	isStepUpRequiredError: (error: unknown) =>
		typeof error === "object" &&
		error !== null &&
		(error as { code?: unknown }).code === "step_up_required",
}));
vi.mock("@/lib/rate-limit", () => ({
	checkAiProviderTestRateLimit: rateLimitMock,
}));

import {
	clearProviderKey,
	listAiProviderConfig,
	setProviderKey,
	testProviderKey,
} from "@/lib/actions/ai-providers";
import {
	CURRENT_KEY_VERSION,
	decryptSecret,
	encryptSecret,
	secretAad,
} from "@/lib/ai-providers/secret";

const MASTER = randomBytes(32).toString("base64");

function storedRow(overrides: Record<string, unknown> = {}) {
	return {
		provider: "opencode-go",
		enabled: true,
		priority: 10,
		model: null,
		apiKeyEnv: null,
		params: null,
		keyCiphertext: null,
		keyIv: null,
		keyTag: null,
		keyVersion: null,
		keyLast4: null,
		keyUpdatedAt: null,
		keyUpdatedBy: null,
		...overrides,
	};
}

function rowWithKey(key = PREVIOUS_KEY) {
	const encrypted = encryptSecret(key, secretAad("opencode-go", CURRENT_KEY_VERSION));
	return storedRow({
		keyCiphertext: new Uint8Array(encrypted.keyCiphertext),
		keyIv: new Uint8Array(encrypted.keyIv),
		keyTag: new Uint8Array(encrypted.keyTag),
		keyVersion: encrypted.keyVersion,
		keyLast4: key.slice(-4),
		keyUpdatedAt: new Date("2026-10-30T00:00:00.000Z"),
		keyUpdatedBy: "admin-0",
	});
}

function auditRows() {
	return tx.platformAuditLog.create.mock.calls.map((call) => call[0].data);
}

function serializedAudit() {
	return JSON.stringify(auditRows());
}

function okResponse() {
	return new Response(JSON.stringify({ choices: [{ message: { content: "OK" } }] }), {
		status: 200,
	});
}

beforeEach(() => {
	vi.clearAllMocks();
	process.env.AI_SECRET_KEY = MASTER;
	process.env.AI_SECRET_KEY_PREVIOUS = "";
	vi.stubEnv("OPENCODE_GO_API_KEY", "");
	vi.stubEnv("GEMINI_API_KEY", "");
	withStepUpMock.mockImplementation(async (action: (stepUpAt: Date) => Promise<unknown>) =>
		action(STEP_UP_AT),
	);
	rateLimitMock.mockResolvedValue({ success: true, remaining: 4 });
	db.$transaction.mockImplementation(async (fn: (client: typeof tx) => Promise<unknown>) => fn(tx));
	db.aiProviderConfig.findUnique.mockResolvedValue(storedRow());
	db.aiProviderConfig.findMany.mockResolvedValue([]);
	tx.aiProviderConfig.upsert.mockResolvedValue(storedRow());
	tx.aiProviderConfig.updateMany.mockResolvedValue({ count: 1 });
	tx.platformAuditLog.create.mockResolvedValue({});
});

afterEach(() => {
	vi.unstubAllEnvs();
	vi.unstubAllGlobals();
	process.env.AI_SECRET_KEY = "";
	process.env.AI_SECRET_KEY_PREVIOUS = "";
});

describe("setProviderKey", () => {
	it("live-tests the submitted key, then stores only ciphertext and the last four", async () => {
		const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => okResponse());
		vi.stubGlobal("fetch", fetchMock);
		const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
		const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
		const error = vi.spyOn(console, "error").mockImplementation(() => undefined);

		const result = await setProviderKey({
			provider: "opencode-go",
			key: SENTINEL,
			reason: REASON,
		});

		expect(result).toMatchObject({ success: true });
		expect(fetchMock).toHaveBeenCalledTimes(1);

		const call = tx.aiProviderConfig.upsert.mock.calls[0][0];
		expect(call.create).toMatchObject({
			provider: "opencode-go",
			keyVersion: CURRENT_KEY_VERSION,
			keyLast4: "1234",
			keyUpdatedBy: "admin-1",
		});
		expect(call.update).toMatchObject({ keyVersion: CURRENT_KEY_VERSION, keyLast4: "1234" });
		expect(call.create.keyCiphertext).toBeInstanceOf(Uint8Array);
		expect(call.create.keyCiphertext).not.toEqual(Buffer.from(SENTINEL));

		const decrypted = decryptSecret(
			{
				keyCiphertext: call.create.keyCiphertext,
				keyIv: call.create.keyIv,
				keyTag: call.create.keyTag,
				keyVersion: call.create.keyVersion,
			},
			secretAad("opencode-go", CURRENT_KEY_VERSION),
		);
		expect(decrypted).toEqual({ ok: true, plaintext: SENTINEL });

		expect(serializedAudit()).not.toContain(SENTINEL);
		expect(serializedAudit()).not.toContain(call.create.keyCiphertext.toString());
		expect(JSON.stringify([log.mock.calls, warn.mock.calls, error.mock.calls])).not.toContain(
			SENTINEL,
		);

		const audit = auditRows()[0];
		expect(audit).toMatchObject({
			action: "ai.provider.key_set",
			targetType: "ai_provider",
			targetId: "opencode-go",
			reason: REASON,
			actorUserId: "admin-1",
			stepUpAt: STEP_UP_AT,
		});
		expect(audit.after).toMatchObject({ keySource: "db", keyLast4: "1234" });

		log.mockRestore();
		warn.mockRestore();
		error.mockRestore();
	});

	it("keeps the previous key active and persists nothing when the live test fails", async () => {
		db.aiProviderConfig.findUnique.mockResolvedValue(rowWithKey());
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => new Response("denied", { status: 401, statusText: "Unauthorized" })),
		);

		const result = await setProviderKey({
			provider: "opencode-go",
			key: SENTINEL,
			reason: REASON,
		});

		expect(result.error).toContain("HTTP 401");
		expect(result.error).not.toContain(SENTINEL);
		expect(tx.aiProviderConfig.upsert).not.toHaveBeenCalled();
		expect(serializedAudit()).not.toContain(SENTINEL);
		const audit = auditRows()[0];
		expect(audit).toMatchObject({
			action: "ai.provider.key_test_failed",
			targetId: "opencode-go",
			after: { ok: false },
		});
		expect(audit.after.latencyMs).toEqual(expect.any(Number));
	});

	it("requires step-up before any live test or write", async () => {
		withStepUpMock.mockRejectedValueOnce({
			code: "step_up_required",
			message: "Re-enter your password to continue.",
		});
		const fetchMock = vi.fn(async () => okResponse());
		vi.stubGlobal("fetch", fetchMock);

		const result = await setProviderKey({
			provider: "opencode-go",
			key: SENTINEL,
			reason: REASON,
		});

		expect(result).toMatchObject({ code: "step_up_required" });
		expect(fetchMock).not.toHaveBeenCalled();
		expect(tx.aiProviderConfig.upsert).not.toHaveBeenCalled();
		expect(serializedAudit()).toBe("[]");
	});

	it("refuses to store without a usable master key and never calls the provider", async () => {
		process.env.AI_SECRET_KEY = "";
		const fetchMock = vi.fn(async () => okResponse());
		vi.stubGlobal("fetch", fetchMock);

		const result = await setProviderKey({
			provider: "opencode-go",
			key: SENTINEL,
			reason: REASON,
		});

		expect(result.error).toContain("AI_SECRET_KEY");
		expect(fetchMock).not.toHaveBeenCalled();
		expect(tx.aiProviderConfig.upsert).not.toHaveBeenCalled();
	});

	it("validates the key and the reason before spending a provider call", async () => {
		const fetchMock = vi.fn(async () => okResponse());
		vi.stubGlobal("fetch", fetchMock);

		await expect(
			setProviderKey({ provider: "opencode-go", key: "", reason: REASON }),
		).resolves.toMatchObject({ error: expect.stringContaining("Enter the provider API key") });
		await expect(
			setProviderKey({ provider: "opencode-go", key: "has a space", reason: REASON }),
		).resolves.toMatchObject({ error: expect.stringContaining("spaces") });
		await expect(
			setProviderKey({ provider: "opencode-go", key: SENTINEL, reason: "short" }),
		).resolves.toMatchObject({ error: expect.stringContaining("at least 10 characters") });
		await expect(
			setProviderKey({ provider: "retired-vendor", key: SENTINEL, reason: REASON }),
		).resolves.toMatchObject({ error: expect.stringContaining("Unknown provider") });
		await expect(
			setProviderKey({ provider: "opencode-go", key: "k".repeat(9000), reason: REASON }),
		).resolves.toMatchObject({ error: expect.stringContaining("at most") });
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("copies existing non-secret settings into a first-time row", async () => {
		db.aiProviderConfig.findUnique.mockResolvedValue(
			storedRow({
				enabled: false,
				priority: 3,
				model: "pinned-model",
				apiKeyEnv: "CUSTOM_KEY",
				params: { reasoningEffort: "low" },
			}),
		);
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => okResponse()),
		);

		await setProviderKey({ provider: "opencode-go", key: SENTINEL, reason: REASON });

		expect(tx.aiProviderConfig.upsert.mock.calls[0][0].create).toMatchObject({
			enabled: false,
			priority: 3,
			model: "pinned-model",
			apiKeyEnv: "CUSTOM_KEY",
			params: { reasoningEffort: "low" },
		});
	});

	it("reports a generic failure when the write fails for another reason", async () => {
		const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => okResponse()),
		);
		tx.aiProviderConfig.upsert.mockRejectedValueOnce(new Error("deadlock"));

		await expect(
			setProviderKey({ provider: "opencode-go", key: SENTINEL, reason: REASON }),
		).resolves.toEqual({ error: "Failed to store the provider key." });
		error.mockRestore();
	});

	it("returns an actionable error when the key columns are not migrated", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => okResponse()),
		);
		tx.aiProviderConfig.upsert.mockRejectedValueOnce(
			Object.assign(new Error("column does not exist"), { code: "P2022" }),
		);

		const result = await setProviderKey({
			provider: "opencode-go",
			key: SENTINEL,
			reason: REASON,
		});

		expect(result).toMatchObject({ code: "migration_required" });
		expect(result.error).toContain("20261031140000_ai_provider_secret_columns");
	});
});

describe("clearProviderKey", () => {
	it("nulls all six key columns, audits the clear and records step-up", async () => {
		db.aiProviderConfig.findUnique.mockResolvedValue(rowWithKey());

		const result = await clearProviderKey({ provider: "opencode-go", reason: REASON });

		expect(result).toEqual({ success: true });
		expect(tx.aiProviderConfig.updateMany).toHaveBeenCalledWith({
			where: { provider: "opencode-go" },
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
		expect(auditRows()[0]).toMatchObject({
			action: "ai.provider.key_cleared",
			targetId: "opencode-go",
			stepUpAt: STEP_UP_AT,
			after: { keySource: "none", keyLast4: null },
		});
		expect(serializedAudit()).not.toContain(PREVIOUS_KEY);
	});

	it("requires step-up", async () => {
		withStepUpMock.mockRejectedValueOnce({
			code: "step_up_required",
			message: "Re-enter your password to continue.",
		});

		const result = await clearProviderKey({ provider: "opencode-go", reason: REASON });

		expect(result).toMatchObject({ code: "step_up_required" });
		expect(tx.aiProviderConfig.updateMany).not.toHaveBeenCalled();
	});

	it("treats a schema without the key columns as already clear", async () => {
		db.aiProviderConfig.findUnique
			.mockRejectedValueOnce(Object.assign(new Error("column missing"), { code: "P2022" }))
			.mockResolvedValueOnce(storedRow());
		tx.aiProviderConfig.updateMany.mockRejectedValueOnce(
			Object.assign(new Error("column missing"), { code: "P2022" }),
		);

		await expect(clearProviderKey({ provider: "opencode-go", reason: REASON })).resolves.toEqual({
			success: true,
		});
	});

	it("reports a generic failure when the clear fails for another reason", async () => {
		const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
		tx.aiProviderConfig.updateMany.mockRejectedValueOnce(new Error("permission denied"));

		await expect(clearProviderKey({ provider: "opencode-go", reason: REASON })).resolves.toEqual({
			error: "Failed to clear the provider key.",
		});
		error.mockRestore();
	});
});

describe("testProviderKey", () => {
	it("tests the effective DB key and audits ok plus latency only", async () => {
		db.aiProviderConfig.findUnique.mockResolvedValue(rowWithKey());
		const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => okResponse());
		vi.stubGlobal("fetch", fetchMock);

		const result = await testProviderKey({ provider: "opencode-go", reason: REASON });

		expect(result).toMatchObject({ success: true });
		expect(result.latencyMs).toEqual(expect.any(Number));
		const headers = fetchMock.mock.calls[0][1].headers as Record<string, string>;
		expect(headers.Authorization).toBe(`Bearer ${PREVIOUS_KEY}`);

		const audit = auditRows()[0];
		expect(audit).toMatchObject({
			action: "ai.provider.key_tested",
			targetId: "opencode-go",
			after: { ok: true, keySource: "db" },
		});
		expect(JSON.stringify(audit)).not.toContain(PREVIOUS_KEY);
		expect(JSON.stringify(audit)).not.toContain(
			Buffer.from(
				String(db.aiProviderConfig.findUnique.mock.results[0].value.keyCiphertext),
			).toString("base64"),
		);
	});

	it("audits a failed test with ok:false and no response body", async () => {
		db.aiProviderConfig.findUnique.mockResolvedValue(rowWithKey());
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => new Response("provider-secret-body", { status: 500 })),
		);

		const result = await testProviderKey({ provider: "opencode-go", reason: REASON });

		expect(result.error).toContain("HTTP 500");
		expect(result.error).not.toContain("provider-secret-body");
		const audit = auditRows()[0];
		expect(audit.after).toMatchObject({ ok: false });
		expect(JSON.stringify(audit)).not.toContain("provider-secret-body");
	});

	it("is rate limited per actor before any provider call", async () => {
		rateLimitMock.mockResolvedValueOnce({ success: false, remaining: 0 });
		const fetchMock = vi.fn(async () => okResponse());
		vi.stubGlobal("fetch", fetchMock);

		const result = await testProviderKey({ provider: "opencode-go", reason: REASON });

		expect(result).toMatchObject({ code: "rate_limited" });
		expect(fetchMock).not.toHaveBeenCalled();
		expect(tx.platformAuditLog.create).not.toHaveBeenCalled();
	});

	it("reports when no key is configured", async () => {
		db.aiProviderConfig.findUnique.mockResolvedValue(storedRow());
		const fetchMock = vi.fn(async () => okResponse());
		vi.stubGlobal("fetch", fetchMock);

		const result = await testProviderKey({ provider: "opencode-go", reason: REASON });

		expect(result.error).toContain("No key is configured");
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("tests an env key when the row has no stored ciphertext", async () => {
		db.aiProviderConfig.findUnique.mockResolvedValue(storedRow({ model: "custom-model" }));
		vi.stubEnv("OPENCODE_GO_API_KEY", "sk-env-effective");
		const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => okResponse());
		vi.stubGlobal("fetch", fetchMock);

		const result = await testProviderKey({ provider: "opencode-go", reason: REASON });

		expect(result).toMatchObject({ success: true });
		const headers = fetchMock.mock.calls[0][1].headers as Record<string, string>;
		expect(headers.Authorization).toBe("Bearer sk-env-effective");
		expect(auditRows()[0].after).toMatchObject({ keySource: "env" });
	});

	it("returns a generic sanitised error for a network failure", async () => {
		db.aiProviderConfig.findUnique.mockResolvedValue(rowWithKey());
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => {
				throw new TypeError("fetch failed");
			}),
		);

		const result = await testProviderKey({ provider: "opencode-go", reason: REASON });

		expect(result.error).toBe("The provider could not be reached or rejected the key.");
		expect(result.error).not.toContain("fetch failed");
	});

	it("returns an actionable error when the key columns are not migrated", async () => {
		db.aiProviderConfig.findUnique
			.mockRejectedValueOnce(Object.assign(new Error("column missing"), { code: "P2022" }))
			.mockRejectedValueOnce(Object.assign(new Error("relation missing"), { code: "P2021" }));

		const result = await testProviderKey({ provider: "opencode-go", reason: REASON });

		expect(result).toMatchObject({ code: "migration_required" });
		expect(result.error).toContain("20261031140000_ai_provider_secret_columns");
	});

	it("validates the reason and the provider before testing", async () => {
		await expect(
			testProviderKey({ provider: "opencode-go", reason: "short" }),
		).resolves.toMatchObject({ error: expect.stringContaining("at least 10 characters") });
		await expect(
			testProviderKey({ provider: "retired-vendor", reason: REASON }),
		).resolves.toMatchObject({ error: expect.stringContaining("Unknown provider") });
		expect(rateLimitMock).not.toHaveBeenCalled();
	});

	it("reports a generic failure when the limiter or read throws", async () => {
		const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
		rateLimitMock.mockRejectedValueOnce(new Error("limiter down"));

		await expect(testProviderKey({ provider: "opencode-go", reason: REASON })).resolves.toEqual({
			error: "Failed to test the provider key.",
		});
		error.mockRestore();
	});

	it("names a timeout instead of echoing the adapter message", async () => {
		db.aiProviderConfig.findUnique.mockResolvedValue(rowWithKey());
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => {
				throw Object.assign(new Error("secret detail"), { name: "TimeoutError" });
			}),
		);

		const result = await testProviderKey({ provider: "opencode-go", reason: REASON });

		expect(result.error).toContain("15-second timeout");
		expect(result.error).not.toContain("secret detail");
	});

	it("names an aborted request instead of echoing the adapter message", async () => {
		db.aiProviderConfig.findUnique.mockResolvedValue(rowWithKey());
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => {
				throw Object.assign(new Error("secret detail"), { name: "AbortError" });
			}),
		);

		const result = await testProviderKey({ provider: "opencode-go", reason: REASON });

		expect(result.error).toContain("aborted");
		expect(result.error).not.toContain("secret detail");
	});
});

describe("listAiProviderConfig key boundary", () => {
	it("returns only source, last four and update metadata", async () => {
		db.aiProviderConfig.findMany.mockResolvedValue([rowWithKey()]);

		const providers = await listAiProviderConfig();
		const go = providers.find((provider) => provider.provider === "opencode-go");

		expect(go?.key).toEqual({
			source: "db",
			last4: "0000",
			updatedAt: "2026-10-30T00:00:00.000Z",
			updatedBy: "admin-0",
		});
		const serialized = JSON.stringify(providers);
		expect(serialized).not.toContain(PREVIOUS_KEY);
		expect(serialized).not.toContain("keyCiphertext");
		expect(serialized).not.toContain("keyIv");
		expect(serialized).not.toContain("keyTag");
	});

	it("degrades to no DB key when the key columns are missing", async () => {
		vi.stubEnv("OPENCODE_GO_API_KEY", "sk-env-sentinel");
		db.aiProviderConfig.findMany
			.mockRejectedValueOnce(Object.assign(new Error("column does not exist"), { code: "P2022" }))
			.mockResolvedValueOnce([
				{
					provider: "opencode-go",
					enabled: true,
					priority: 1,
					model: "legacy-model",
					apiKeyEnv: null,
					params: null,
				},
			]);

		const providers = await listAiProviderConfig();
		const go = providers.find((provider) => provider.provider === "opencode-go");

		expect(go).toMatchObject({
			model: "legacy-model",
			apiKeyPresent: true,
			key: { source: "env", last4: null, updatedAt: null, updatedBy: null },
		});
	});

	it("renders defaults when the legacy fallback query also fails", async () => {
		vi.stubEnv("OPENCODE_GO_API_KEY", "sk-env-sentinel");
		const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
		db.aiProviderConfig.findMany
			.mockRejectedValueOnce(Object.assign(new Error("column missing"), { code: "P2022" }))
			.mockRejectedValueOnce(new Error("db down"));

		const providers = await listAiProviderConfig();
		const go = providers.find((provider) => provider.provider === "opencode-go");

		expect(go).toMatchObject({
			configured: false,
			key: { source: "env", last4: null },
		});
		expect(warn.mock.calls.flat().join(" ")).toContain("rendering built-in defaults");
		warn.mockRestore();
	});
});
