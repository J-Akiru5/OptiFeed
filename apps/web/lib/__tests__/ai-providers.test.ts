import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const findMany = vi.fn();

vi.mock("@/lib/prisma", () => ({
	default: { aiProviderConfig: { findMany: (...args: unknown[]) => findMany(...args) } },
}));

import {
	DEFAULT_PROVIDER_ROWS,
	invalidateProviderConfigCache,
	loadProviderConfigs,
} from "@/lib/ai-providers/config";
import { geminiProvider } from "@/lib/ai-providers/gemini";
import { openAiCompatibleProvider } from "@/lib/ai-providers/openai-compatible";
import { opencodeGoProvider } from "@/lib/ai-providers/opencode-go";
import { getProvider, listBuiltInProviders, listProviders } from "@/lib/ai-providers/registry";
import { encryptProviderKey, keyMaterialToColumns } from "@/lib/ai-providers/secrets";

function runtime(provider: string, overrides: Record<string, unknown> = {}) {
	return {
		provider,
		model: `model-${provider}`,
		apiKey: `key-${provider}`,
		reasoningEffort: "high" as const,
		params: {},
		...overrides,
	};
}

const baseRequest = {
	turns: [{ role: "user" as const, text: "hi" }],
	systemPrompt: "system prompt",
	sessionId: "sess-1",
};

afterEach(() => {
	vi.unstubAllEnvs();
	vi.unstubAllGlobals();
	vi.clearAllMocks();
});

describe("registry", () => {
	it("exposes every adapter and keeps the generic one out of the built-in cards", () => {
		expect(
			listProviders()
				.map((p) => p.id)
				.sort(),
		).toEqual(["gemini", "openai-compatible", "opencode-go"]);
		expect(
			listBuiltInProviders()
				.map((p) => p.id)
				.sort(),
		).toEqual(["gemini", "opencode-go"]);
		expect(getProvider("opencode-go")).toBe(opencodeGoProvider);
		expect(getProvider("openai-compatible")).toBe(openAiCompatibleProvider);
		expect(getProvider("nope")).toBeUndefined();
	});

	it("declares the expected defaults", () => {
		expect(opencodeGoProvider.defaultModel).toBe("deepseek-v4.1-flash");
		expect(opencodeGoProvider.defaultApiKeyEnv).toBe("OPENCODE_GO_API_KEY");
		expect(geminiProvider.defaultModel).toBe("gemini-2.5-flash");
		expect(geminiProvider.defaultApiKeyEnv).toBe("GEMINI_API_KEY");
	});
});

describe("opencode-go adapter", () => {
	function sse() {
		return new Response(
			[
				'data: {"choices":[{"delta":{"reasoning_content":"thinking"}}]}',
				'data: {"choices":[{"delta":{"content":"Hel"}}]}',
				'data: {"choices":[{"delta":{"content":"lo"}}]}',
				"data: [DONE]",
				"",
			].join("\n"),
			{ status: 200, headers: { "Content-Type": "text/event-stream" } },
		);
	}

	it("sends the session header, model and reasoning, and hides reasoning deltas", async () => {
		const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => sse());
		vi.stubGlobal("fetch", fetchMock);

		let out = "";
		for await (const chunk of opencodeGoProvider.stream({
			...baseRequest,
			config: runtime("opencode-go") as never,
		})) {
			out += chunk;
		}

		expect(out).toBe("Hello");

		const [url, init] = fetchMock.mock.calls[0];
		expect(url).toBe("https://opencode.ai/inference/go/openai/v1/chat/completions");
		const headers = init.headers as Record<string, string>;
		expect(headers["x-opencode-session"]).toBe("sess-1");
		expect(headers["User-Agent"]).toBe("optifeed/1.0");
		expect(headers.Authorization).toBe("Bearer key-opencode-go");

		const body = JSON.parse(String(init.body)) as {
			model: string;
			stream: boolean;
			reasoning?: { effort: string };
			messages: { role: string; content: string }[];
		};
		expect(body.model).toBe("model-opencode-go");
		expect(body.stream).toBe(true);
		expect(body.reasoning).toEqual({ effort: "high" });
		expect(body.messages[0]).toEqual({ role: "system", content: "system prompt" });
	});

	it("omits the reasoning param when effort is none", async () => {
		const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => sse());
		vi.stubGlobal("fetch", fetchMock);

		for await (const _chunk of opencodeGoProvider.stream({
			...baseRequest,
			config: runtime("opencode-go", { reasoningEffort: "none" }) as never,
		})) {
			// drain
		}

		const body = JSON.parse(String(fetchMock.mock.calls[0][1].body)) as { reasoning?: unknown };
		expect(body.reasoning).toBeUndefined();
	});

	it("maps reasoning_content on non-streaming completions", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(
				async () =>
					new Response(
						JSON.stringify({
							choices: [{ message: { content: "answer", reasoning_content: " because " } }],
						}),
						{ status: 200 },
					),
			),
		);

		const res = await opencodeGoProvider.complete({
			...baseRequest,
			config: runtime("opencode-go") as never,
		});
		expect(res).toEqual({ content: "answer", reasoning: "because" });
	});
});

describe("gemini adapter", () => {
	it("uses systemInstruction/contents and the x-goog-api-key header", async () => {
		const fetchMock = vi.fn(
			async (_url: string, _init: RequestInit) =>
				new Response(
					JSON.stringify({ candidates: [{ content: { parts: [{ text: "gemini says" }] } }] }),
					{ status: 200 },
				),
		);
		vi.stubGlobal("fetch", fetchMock);

		const res = await geminiProvider.complete({
			...baseRequest,
			turns: [
				{ role: "user", text: "hello" },
				{ role: "assistant", text: "previous" },
				{ role: "user", text: "again" },
			],
			config: runtime("gemini") as never,
		});

		expect(res).toEqual({ content: "gemini says", reasoning: null });

		const [url, init] = fetchMock.mock.calls[0];
		expect(url).toContain("generativelanguage.googleapis.com/v1beta/models/model-gemini");
		expect(url).toContain(":generateContent");
		const headers = init.headers as Record<string, string>;
		expect(headers["x-goog-api-key"]).toBe("key-gemini");

		const body = JSON.parse(String(init.body)) as {
			systemInstruction: { parts: { text: string }[] };
			contents: { role: string; parts: { text: string }[] }[];
		};
		expect(body.systemInstruction.parts[0].text).toBe("system prompt");
		// Assistant turns become "model" for Gemini.
		expect(body.contents.map((c) => c.role)).toEqual(["user", "model", "user"]);
	});

	it("streams candidate parts and requests the SSE endpoint", async () => {
		const fetchMock = vi.fn(
			async (_url: string, _init: RequestInit) =>
				new Response(
					[
						'data: {"candidates":[{"content":{"parts":[{"text":"Hel"}]}}]}',
						'data: {"candidates":[{"content":{"parts":[{"text":"lo"}]}}]}',
						"",
					].join("\n"),
					{ status: 200, headers: { "Content-Type": "text/event-stream" } },
				),
		);
		vi.stubGlobal("fetch", fetchMock);

		let out = "";
		for await (const chunk of geminiProvider.stream({
			...baseRequest,
			config: runtime("gemini") as never,
		})) {
			out += chunk;
		}

		expect(out).toBe("Hello");
		expect(fetchMock.mock.calls[0][0]).toContain(":streamGenerateContent?alt=sse");
	});

	it("surfaces the upstream status for failover", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => new Response("quota", { status: 429, statusText: "Too Many Requests" })),
		);

		await expect(
			geminiProvider.complete({ ...baseRequest, config: runtime("gemini") as never }),
		).rejects.toMatchObject({ status: 429 });
	});
});

describe("provider config resolution", () => {
	beforeEach(() => {
		invalidateProviderConfigCache();
		findMany.mockReset();
	});

	it("falls back to defaults when the table is unreachable", async () => {
		findMany.mockRejectedValue(new Error("db down"));
		vi.stubEnv("OPENCODE_GO_API_KEY", "go-key");
		vi.stubEnv("GEMINI_API_KEY", "");

		const configs = await loadProviderConfigs();
		expect(configs).toHaveLength(1);
		expect(configs[0]).toMatchObject({
			provider: "opencode-go",
			model: "deepseek-v4.1-flash",
			apiKey: "go-key",
		});
	});

	it("uses defaults when the table is empty", async () => {
		findMany.mockResolvedValue([]);
		vi.stubEnv("OPENCODE_GO_API_KEY", "go-key");
		vi.stubEnv("GEMINI_API_KEY", "gem-key");

		const configs = await loadProviderConfigs();
		expect(configs.map((c) => c.provider)).toEqual(["opencode-go", "gemini"]);
	});

	it("keeps unconfigured providers in the chain when only one is stored", async () => {
		// Regression: stored rows are an overlay, not a replacement. Configuring
		// Gemini must not silently drop the OpenCode Go default.
		findMany.mockResolvedValue([{ ...DEFAULT_PROVIDER_ROWS[1], priority: 1 }]);
		vi.stubEnv("OPENCODE_GO_API_KEY", "go-key");
		vi.stubEnv("GEMINI_API_KEY", "gem-key");

		const configs = await loadProviderConfigs();
		expect(configs.map((c) => c.provider)).toEqual(["gemini", "opencode-go"]);
	});

	it("orders by priority, not by insertion or id", async () => {
		findMany.mockResolvedValue([
			{ ...DEFAULT_PROVIDER_ROWS[1], priority: 1 },
			{ ...DEFAULT_PROVIDER_ROWS[0], priority: 9 },
		]);
		vi.stubEnv("OPENCODE_GO_API_KEY", "go-key");
		vi.stubEnv("GEMINI_API_KEY", "gem-key");

		const configs = await loadProviderConfigs();
		expect(configs.map((c) => c.provider)).toEqual(["gemini", "opencode-go"]);
	});

	it("drops disabled providers and providers without a key", async () => {
		findMany.mockResolvedValue([
			{ ...DEFAULT_PROVIDER_ROWS[0], enabled: false, priority: 1 },
			{ ...DEFAULT_PROVIDER_ROWS[1], priority: 2 },
		]);
		vi.stubEnv("OPENCODE_GO_API_KEY", "go-key");
		vi.stubEnv("GEMINI_API_KEY", "");

		expect(await loadProviderConfigs()).toEqual([]);
	});

	it("honours a custom env var name and model from the row", async () => {
		findMany.mockResolvedValue([
			{
				...DEFAULT_PROVIDER_ROWS[0],
				model: "custom-model",
				apiKeyEnv: "MY_CUSTOM_KEY",
				priority: 1,
			},
		]);
		vi.stubEnv("MY_CUSTOM_KEY", "custom-value");
		vi.stubEnv("OPENCODE_GO_API_KEY", "");

		const configs = await loadProviderConfigs();
		expect(configs[0]).toMatchObject({ model: "custom-model", apiKey: "custom-value" });
	});

	it("reads reasoningEffort from row params when present", async () => {
		findMany.mockResolvedValue([
			{ ...DEFAULT_PROVIDER_ROWS[0], params: { reasoningEffort: "low" }, priority: 1 },
		]);
		vi.stubEnv("OPENCODE_GO_API_KEY", "go-key");

		const configs = await loadProviderConfigs();
		expect(configs[0].reasoningEffort).toBe("low");
	});

	it("prefers a key stored in the database over the environment variable (#432)", async () => {
		vi.stubEnv("AI_SECRET_KEY", Buffer.alloc(32, 3).toString("base64"));
		const encrypted = encryptProviderKey("opencode-go", "db-key");
		if (!encrypted) throw new Error("encryption failed");
		findMany.mockResolvedValue([
			{ ...DEFAULT_PROVIDER_ROWS[0], priority: 1, ...keyMaterialToColumns(encrypted) },
		]);
		vi.stubEnv("OPENCODE_GO_API_KEY", "env-key");

		const configs = await loadProviderConfigs();
		expect(configs[0]).toMatchObject({ provider: "opencode-go", apiKey: "db-key" });
	});

	it("falls back to the environment when the stored key cannot be decrypted (#432)", async () => {
		vi.stubEnv("AI_SECRET_KEY", Buffer.alloc(32, 3).toString("base64"));
		const encrypted = encryptProviderKey("opencode-go", "db-key");
		if (!encrypted) throw new Error("encryption failed");
		const columns = keyMaterialToColumns(encrypted);
		findMany.mockResolvedValue([
			{
				...DEFAULT_PROVIDER_ROWS[0],
				priority: 1,
				...columns,
				keyCiphertext: new Uint8Array([1, 2, 3]), // tampered
			},
		]);
		vi.stubEnv("OPENCODE_GO_API_KEY", "env-key");

		const configs = await loadProviderConfigs();
		expect(configs[0]).toMatchObject({ provider: "opencode-go", apiKey: "env-key" });
	});

	it("resolves a console-created OpenAI-compatible instance (#432)", async () => {
		findMany.mockResolvedValue([
			{
				provider: "groq",
				kind: "openai-compatible",
				label: "Groq",
				baseUrl: "https://api.groq.com/openai/v1",
				enabled: true,
				priority: 15,
				model: "llama-3.3-70b-versatile",
				apiKeyEnv: null,
				params: null,
			},
		]);
		vi.stubEnv("OPENAI_API_KEY", "groq-key");
		vi.stubEnv("OPENCODE_GO_API_KEY", "");

		const configs = await loadProviderConfigs();
		const groq = configs.find((config) => config.provider === "groq");
		expect(groq).toMatchObject({
			provider: "groq",
			kind: "openai-compatible",
			model: "llama-3.3-70b-versatile",
			apiKey: "groq-key",
			baseUrl: "https://api.groq.com/openai/v1",
		});
	});

	it("skips a custom provider with no base URL (#432)", async () => {
		findMany.mockResolvedValue([
			{
				provider: "broken",
				kind: "openai-compatible",
				enabled: true,
				priority: 1,
				model: null,
				apiKeyEnv: "OPENAI_API_KEY",
				params: null,
			},
		]);
		vi.stubEnv("OPENAI_API_KEY", "some-key");

		const configs = await loadProviderConfigs();
		expect(configs.some((config) => config.provider === "broken")).toBe(false);
	});
});

describe("openai-compatible adapter (#432)", () => {
	const config = runtime("openai-compatible", {
		baseUrl: "https://api.groq.com/openai/v1",
		model: "llama-3.3-70b-versatile",
	}) as never;

	it("posts to the configured base URL with the bearer key and streams deltas", async () => {
		const fetchMock = vi.fn(
			async (_url: string, _init: RequestInit) =>
				new Response(
					[
						'data: {"choices":[{"delta":{"content":"Hel"}}]}',
						'data: {"choices":[{"delta":{"content":"lo"}}]}',
						"data: [DONE]",
						"",
					].join("\n"),
					{ status: 200, headers: { "Content-Type": "text/event-stream" } },
				),
		);
		vi.stubGlobal("fetch", fetchMock);

		let out = "";
		for await (const chunk of openAiCompatibleProvider.stream({
			...baseRequest,
			config,
		})) {
			out += chunk;
		}

		expect(out).toBe("Hello");
		expect(fetchMock.mock.calls[0][0]).toBe("https://api.groq.com/openai/v1/chat/completions");
		const init = fetchMock.mock.calls[0][1] as RequestInit;
		expect((init.headers as Record<string, string>).Authorization).toBe(
			"Bearer key-openai-compatible",
		);
		const body = JSON.parse(String(init.body)) as { model: string; stream: boolean };
		expect(body.model).toBe("llama-3.3-70b-versatile");
		expect(body.stream).toBe(true);
	});

	it("completes with the provider's message", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(
				async () =>
					new Response(JSON.stringify({ choices: [{ message: { content: "OK" } }] }), {
						status: 200,
						headers: { "Content-Type": "application/json" },
					}),
			),
		);

		await expect(
			openAiCompatibleProvider.complete({ ...baseRequest, config }),
		).resolves.toMatchObject({ content: "OK" });
	});

	it("refuses to call a provider with no base URL", async () => {
		await expect(
			openAiCompatibleProvider.complete({
				...baseRequest,
				config: runtime("openai-compatible") as never,
			}),
		).rejects.toThrow("no base URL");
	});
});
