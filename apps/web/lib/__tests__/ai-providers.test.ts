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
import { opencodeGoProvider } from "@/lib/ai-providers/opencode-go";
import { getProvider, listProviders } from "@/lib/ai-providers/registry";

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
	it("exposes both providers", () => {
		expect(
			listProviders()
				.map((p) => p.id)
				.sort(),
		).toEqual(["gemini", "opencode-go"]);
		expect(getProvider("opencode-go")).toBe(opencodeGoProvider);
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

	it("scrubs and bounds an upstream error body before it can reach a log", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(
				async () =>
					new Response(`Authorization: Bearer sk-leaked-123456 ${"x".repeat(400)}`, {
						status: 401,
						statusText: "Unauthorized",
					}),
			),
		);

		try {
			await geminiProvider.complete({ ...baseRequest, config: runtime("gemini") as never });
			throw new Error("complete should have thrown");
		} catch (error) {
			const message = (error as Error).message;
			expect(message).toContain("Gemini HTTP 401");
			expect(message).not.toContain("sk-leaked-123456");
			expect(message.length).toBeLessThan(250);
		}
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
});
