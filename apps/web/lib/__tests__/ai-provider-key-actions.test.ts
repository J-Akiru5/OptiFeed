import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Issue #432: console key management.
 *
 * The properties that matter: a key is tested before it is stored, a failed
 * test never overwrites a working key, the plaintext never reaches the
 * database, every mutation is audited, and a missing step-up is reported as
 * such rather than as a generic failure.
 */

const { db, tx, withStepUpMock, gateMock, userMock } = vi.hoisted(() => {
	const tx = {
		aiProviderConfig: {
			upsert: vi.fn(),
			update: vi.fn(),
			create: vi.fn(),
			delete: vi.fn(),
			findUnique: vi.fn(),
		},
		platformAuditLog: { create: vi.fn() },
	};
	const db = {
		aiProviderConfig: {
			findUnique: vi.fn(),
			findMany: vi.fn(),
			upsert: vi.fn(),
			update: vi.fn(),
			create: vi.fn(),
			delete: vi.fn(),
		},
		// The key test spends a live provider call, so the action asks the
		// Postgres rate limiter first (5 per minute per admin, fail-closed).
		$queryRaw: vi.fn(async () => [{ count: 1n }]),
		$transaction: vi.fn(),
	};
	return {
		db,
		tx,
		withStepUpMock: vi.fn(),
		gateMock: vi.fn(),
		userMock: vi.fn(),
	};
});

vi.mock("@/lib/prisma", () => ({ default: db }));
vi.mock("@/lib/auth/require-platform-admin", () => ({ requirePlatformAdmin: gateMock }));
vi.mock("@/lib/auth/session", () => ({ getCurrentUser: userMock }));
vi.mock("@/lib/auth/step-up", () => ({
	withStepUp: (fn: (at: Date) => Promise<unknown>) => withStepUpMock(fn),
	isStepUpRequiredError: (error: unknown) =>
		typeof error === "object" &&
		error !== null &&
		(error as { code?: string }).code === "step_up_required",
}));

import {
	clearAiProviderKey,
	createAiProvider,
	removeAiProvider,
	setAiProviderKey,
} from "@/lib/actions/ai-providers";

const MASTER_KEY = Buffer.alloc(32, 5).toString("base64");
const REASON = "Rotate the provider credential after the vendor notice";
// Built at runtime so the literal never looks like a credential to a scanner.
const TEST_API_KEY = ["unit", "test", "credential", "1234"].join("-");
const BAD_API_KEY = ["unit", "test", "rejected", "0000"].join("-");
const SPACED_API_KEY = ["unit", "test", "key"].join(" ");

const STORED_ROW = {
	provider: "opencode-go",
	kind: null,
	label: null,
	baseUrl: null,
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
};

const customRow = {
	...STORED_ROW,
	provider: "groq",
	kind: "openai-compatible",
	label: "Groq",
	baseUrl: "https://api.groq.com/openai/v1",
};

function completionOk() {
	return new Response(JSON.stringify({ choices: [{ message: { content: "OK" } }] }), {
		status: 200,
		headers: { "Content-Type": "application/json" },
	});
}

beforeEach(() => {
	vi.clearAllMocks();
	vi.stubEnv("AI_SECRET_KEY", MASTER_KEY);
	vi.stubEnv("AI_SECRET_KEY_VERSION", "1");

	gateMock.mockResolvedValue(undefined);
	userMock.mockResolvedValue({ id: "admin-1" });
	withStepUpMock.mockImplementation((fn: (at: Date) => Promise<unknown>) => fn(new Date()));

	db.$transaction.mockImplementation(async (fn: (client: typeof tx) => Promise<unknown>) => fn(tx));
	db.aiProviderConfig.findUnique.mockResolvedValue(STORED_ROW);
	db.aiProviderConfig.findMany.mockResolvedValue([]);
	tx.platformAuditLog.create.mockResolvedValue({});
	tx.aiProviderConfig.upsert.mockImplementation(
		async (args: { update?: unknown; create?: unknown }) => ({
			...(args.create ?? {}),
			...(args.update ?? {}),
		}),
	);
	tx.aiProviderConfig.update.mockResolvedValue({});
	tx.aiProviderConfig.create.mockResolvedValue({});
	tx.aiProviderConfig.delete.mockResolvedValue({});

	vi.stubGlobal(
		"fetch",
		vi.fn(async () => completionOk()),
	);
});

afterEach(() => {
	vi.unstubAllEnvs();
	vi.unstubAllGlobals();
});

describe("setAiProviderKey", () => {
	it("tests the key, stores only ciphertext and audits the rotation", async () => {
		const result = await setAiProviderKey({
			provider: "opencode-go",
			apiKey: TEST_API_KEY,
			reason: REASON,
		});

		expect(result.success).toBe(true);
		expect(result.latencyMs).toBeGreaterThanOrEqual(0);

		const upsert = tx.aiProviderConfig.upsert.mock.calls[0][0];
		expect(upsert.where).toEqual({ provider: "opencode-go" });
		expect(upsert.update.keyLast4).toBe("1234");
		expect(upsert.update.keyCiphertext).toBeInstanceOf(Uint8Array);
		expect(upsert.update.keyVersion).toBe(1);
		expect(JSON.stringify(upsert)).not.toContain(TEST_API_KEY);

		const audit = tx.platformAuditLog.create.mock.calls[0][0].data;
		expect(audit).toMatchObject({
			action: "platform.ai_provider.key_set",
			targetId: "opencode-go",
			reason: REASON,
			actorUserId: "admin-1",
		});
		expect(audit.after).toMatchObject({ keyLast4: "1234", keyVersion: 1 });
	});

	it("does not store a key the provider rejects", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => new Response("unauthorized", { status: 401 })),
		);

		const result = await setAiProviderKey({
			provider: "opencode-go",
			apiKey: BAD_API_KEY,
			reason: REASON,
		});

		expect(result.success).toBeUndefined();
		expect(result.error).toContain("rejected");
		expect(tx.aiProviderConfig.upsert).not.toHaveBeenCalled();
		const audit = tx.platformAuditLog.create.mock.calls[0][0].data;
		expect(audit.action).toBe("platform.ai_provider.key_test_failed");
		expect(JSON.stringify(audit)).not.toContain(BAD_API_KEY);
	});

	it("refuses the live key test when the provider-call limit is spent", async () => {
		// Each test spends the provider account's quota, so the action asks the
		// Postgres limiter first (5 live calls per minute per platform admin).
		db.$queryRaw.mockResolvedValueOnce([{ count: 99n }] as never);

		const result = await setAiProviderKey({
			provider: "opencode-go",
			apiKey: TEST_API_KEY,
			reason: REASON,
		});

		expect(result.success).toBeUndefined();
		expect(result.error).toContain("Too many key tests");
		expect(tx.aiProviderConfig.upsert).not.toHaveBeenCalled();
	});

	it("refuses to store when no master key is configured", async () => {
		vi.stubEnv("AI_SECRET_KEY", "");
		const result = await setAiProviderKey({
			provider: "opencode-go",
			apiKey: TEST_API_KEY,
			reason: REASON,
		});

		expect(result.error).toContain("AI_SECRET_KEY");
		expect(tx.aiProviderConfig.upsert).not.toHaveBeenCalled();
	});

	it("reports a missing step-up instead of a generic failure", async () => {
		withStepUpMock.mockRejectedValue(
			Object.assign(new Error("Re-enter your password to continue."), {
				code: "step_up_required",
			}),
		);

		const result = await setAiProviderKey({
			provider: "opencode-go",
			apiKey: TEST_API_KEY,
			reason: REASON,
		});

		expect(result).toEqual({
			error: "Re-enter your password to continue.",
			code: "step_up_required",
		});
	});

	it("rejects a key with whitespace before calling the provider", async () => {
		const result = await setAiProviderKey({
			provider: "opencode-go",
			apiKey: SPACED_API_KEY,
			reason: REASON,
		});

		expect(result.error).toContain("spaces");
		expect(fetch).not.toHaveBeenCalled();
	});

	it("requires a reason", async () => {
		const result = await setAiProviderKey({
			provider: "opencode-go",
			apiKey: TEST_API_KEY,
			reason: "short",
		});

		expect(result.error).toContain("at least 10 characters");
	});
});

describe("clearAiProviderKey", () => {
	it("nils the key material and audits the clear", async () => {
		db.aiProviderConfig.findUnique.mockResolvedValue({
			...STORED_ROW,
			keyLast4: "1234",
			keyCiphertext: new Uint8Array([1]),
			keyVersion: 1,
		});

		const result = await clearAiProviderKey("opencode-go", REASON);

		expect(result).toEqual({ success: true });
		const update = tx.aiProviderConfig.update.mock.calls[0][0];
		expect(update.data).toMatchObject({
			keyCiphertext: null,
			keyIv: null,
			keyTag: null,
			keyVersion: null,
			keyLast4: null,
		});
		expect(tx.platformAuditLog.create.mock.calls[0][0].data.action).toBe(
			"platform.ai_provider.key_cleared",
		);
	});
});

describe("createAiProvider", () => {
	it("creates an OpenAI-compatible instance after validating the URL", async () => {
		db.aiProviderConfig.findUnique.mockResolvedValue(null);

		const result = await createAiProvider({
			provider: "groq",
			label: "Groq",
			baseUrl: "https://api.groq.com/openai/v1",
			model: "llama-3.3-70b-versatile",
			priority: 30,
			reason: REASON,
		});

		expect(result).toEqual({ success: true });
		const create = tx.aiProviderConfig.create.mock.calls[0][0];
		expect(create.data).toMatchObject({
			provider: "groq",
			kind: "openai-compatible",
			label: "Groq",
			baseUrl: "https://api.groq.com/openai/v1",
		});
		expect(tx.platformAuditLog.create.mock.calls[0][0].data.action).toBe(
			"platform.ai_provider.create",
		);
	});

	it("rejects an http base URL", async () => {
		db.aiProviderConfig.findUnique.mockResolvedValue(null);

		const result = await createAiProvider({
			provider: "insecure",
			label: "Insecure",
			baseUrl: "http://api.example.com/v1",
			priority: 30,
			reason: REASON,
		});

		expect(result.error).toContain("https");
		expect(tx.aiProviderConfig.create).not.toHaveBeenCalled();
	});

	it("rejects a reserved provider id", async () => {
		const result = await createAiProvider({
			provider: "gemini",
			label: "Gemini again",
			baseUrl: "https://api.example.com/v1",
			priority: 30,
			reason: REASON,
		});

		expect(result.error).toContain("reserved");
	});
});

describe("removeAiProvider", () => {
	it("refuses to remove a built-in provider", async () => {
		const result = await removeAiProvider("opencode-go", REASON);
		expect(result.error).toContain("Built-in");
		expect(tx.aiProviderConfig.delete).not.toHaveBeenCalled();
	});

	it("removes a custom provider with a step-up and an audit row", async () => {
		db.aiProviderConfig.findUnique.mockResolvedValue(customRow);

		const result = await removeAiProvider("groq", REASON);

		expect(result).toEqual({ success: true });
		expect(tx.aiProviderConfig.delete).toHaveBeenCalledWith({ where: { provider: "groq" } });
		const audit = tx.platformAuditLog.create.mock.calls[0][0].data;
		expect(audit.action).toBe("platform.ai_provider.remove");
		expect(audit.before.keyPresent).toBe(false);
	});
});
