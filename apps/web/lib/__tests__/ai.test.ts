import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	aiDebugInfo,
	completeAi,
	getAiModelId,
	getReasoningEffort,
	isAiEnabled,
	isAiQuotaError,
	stableSessionId,
	streamAi,
} from "../ai";

beforeEach(() => {
	vi.stubEnv("OPENCODE_GO_API_KEY", "test-key");
	vi.stubEnv("OPENCODE_GO_REASONING_EFFORT", "high");
	vi.stubEnv("OPENCODE_GO_MODEL", undefined);
});

afterEach(() => {
	vi.unstubAllEnvs();
	vi.unstubAllGlobals();
});

describe("isAiEnabled", () => {
	it("returns true when API key is set", () => {
		expect(isAiEnabled()).toBe(true);
	});

	it("returns false when API key is missing", () => {
		vi.stubEnv("OPENCODE_GO_API_KEY", "");
		expect(isAiEnabled()).toBe(false);
	});
});

describe("getAiModelId", () => {
	it("defaults to deepseek v4.1 flash", () => {
		expect(getAiModelId()).toBe("deepseek-v4.1-flash");
	});

	it("uses OPENCODE_GO_MODEL when set", () => {
		vi.stubEnv("OPENCODE_GO_MODEL", "glm-5.3-flash");
		expect(getAiModelId()).toBe("glm-5.3-flash");
	});
});

describe("getReasoningEffort", () => {
	it("defaults to high", () => {
		expect(getReasoningEffort()).toBe("high");
	});

	it("maps none/off/disabled to none", () => {
		for (const v of ["none", "off", "disabled"]) {
			vi.stubEnv("OPENCODE_GO_REASONING_EFFORT", v);
			expect(getReasoningEffort()).toBe("none");
		}
	});

	it("passes through low and medium", () => {
		vi.stubEnv("OPENCODE_GO_REASONING_EFFORT", "low");
		expect(getReasoningEffort()).toBe("low");
		vi.stubEnv("OPENCODE_GO_REASONING_EFFORT", "medium");
		expect(getReasoningEffort()).toBe("medium");
	});

	it("falls back to high for unknown values", () => {
		vi.stubEnv("OPENCODE_GO_REASONING_EFFORT", "extreme");
		expect(getReasoningEffort()).toBe("high");
	});
});

describe("stableSessionId", () => {
	it("is deterministic for the same inputs", () => {
		expect(stableSessionId("chat", "farm-1", "hello")).toBe(
			stableSessionId("chat", "farm-1", "hello"),
		);
	});

	it("differs when any part differs", () => {
		const base = stableSessionId("chat", "farm-1", "hello");
		expect(stableSessionId("chat", "farm-2", "hello")).not.toBe(base);
		expect(stableSessionId("chat", "farm-1", "goodbye")).not.toBe(base);
		expect(stableSessionId("prediction", "farm-1", "hello")).not.toBe(base);
	});

	it("ignores undefined and empty parts", () => {
		expect(stableSessionId("chat", undefined, "farm-1", "", "hello")).toBe(
			stableSessionId("chat", "farm-1", "hello"),
		);
	});

	it("produces a prefixed, header-safe value", () => {
		const id = stableSessionId("chat", "farm-1", "hello");
		expect(id).toMatch(/^optifeed-[0-9a-z]+$/);
	});
});

describe("aiDebugInfo", () => {
	it("reports provider and key presence without exposing the key", () => {
		const info = aiDebugInfo();
		expect(info.provider).toBe("opencode-go");
		expect(info.hasKey).toBe(true);
		expect(info.model).toBe("deepseek-v4.1-flash");
		expect(info.reasoningEffort).toBe("high");
		expect(JSON.stringify(info)).not.toContain("test-key");
	});
});

describe("isAiQuotaError", () => {
	it("detects HTTP 429 via status", () => {
		expect(isAiQuotaError({ status: 429, message: "Too Many Requests" })).toBe(true);
	});

	it("detects 429 in message", () => {
		expect(isAiQuotaError(new Error("OpenCode Go HTTP 429: Too Many Requests"))).toBe(true);
	});

	it("detects rate limit in message", () => {
		expect(isAiQuotaError(new Error("rate limit exceeded"))).toBe(true);
	});

	it("detects insufficient credit", () => {
		expect(isAiQuotaError(new Error("insufficient credit"))).toBe(true);
	});

	it("detects quota in message", () => {
		expect(isAiQuotaError(new Error("You exceeded your current quota"))).toBe(true);
	});

	it("returns false for other errors", () => {
		expect(isAiQuotaError(new Error("Connection reset"))).toBe(false);
		expect(isAiQuotaError({ status: 500, message: "Internal Server Error" })).toBe(false);
	});
});

describe("request shaping", () => {
	function stubFetch(body: string) {
		const fetchMock = vi.fn(
			async (_url: string, _init: RequestInit) =>
				new Response(body, { status: 200, headers: { "Content-Type": "application/json" } }),
		);
		vi.stubGlobal("fetch", fetchMock);
		return fetchMock;
	}

	it("streamAi sends the required session header and model", async () => {
		const sse = [
			'data: {"choices":[{"delta":{"reasoning_content":"thinking"}}]}',
			'data: {"choices":[{"delta":{"content":"Hel"}}]}',
			'data: {"choices":[{"delta":{"content":"lo"}}]}',
			"data: [DONE]",
			"",
		].join("\n");
		const fetchMock = stubFetch(sse);

		const chunks: string[] = [];
		for await (const chunk of streamAi([{ role: "user", text: "hi" }], "sys", "sess-123")) {
			chunks.push(chunk);
		}

		// Reasoning deltas must never leak into the user-visible answer.
		expect(chunks.join("")).toBe("Hello");

		const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
		expect(url).toContain("/inference/go/openai/v1/chat/completions");
		const headers = init.headers as Record<string, string>;
		expect(headers["x-opencode-session"]).toBe("sess-123");
		expect(headers["User-Agent"]).toBe("optifeed/1.0");
		expect(headers.Authorization).toBe("Bearer test-key");

		const payload = JSON.parse(String(init.body)) as {
			model: string;
			stream: boolean;
			reasoning?: { effort: string };
		};
		expect(payload.model).toBe("deepseek-v4.1-flash");
		expect(payload.stream).toBe(true);
		expect(payload.reasoning).toEqual({ effort: "high" });
	});

	it("completeAi reads reasoning_content from the OpenCode Go payload", async () => {
		const body = JSON.stringify({
			choices: [
				{
					message: {
						content: '{"grams": 120}',
						reasoning_content: "step one",
					},
				},
			],
		});
		stubFetch(body);

		const result = await completeAi([{ role: "user", text: "hi" }], "sys", "sess-123");
		expect(result?.content).toBe('{"grams": 120}');
		expect(result?.reasoning).toBe("step one");
	});

	it("omits the reasoning param when effort is none", async () => {
		vi.stubEnv("OPENCODE_GO_REASONING_EFFORT", "none");
		const body = JSON.stringify({ choices: [{ message: { content: "ok" } }] });
		const fetchMock = stubFetch(body);

		await completeAi([{ role: "user", text: "hi" }], "sys", "sess-123");

		const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
		const payload = JSON.parse(String(init.body)) as { reasoning?: unknown };
		expect(payload.reasoning).toBeUndefined();
	});

	it("throws a status-bearing error on a failed response", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => new Response("nope", { status: 401, statusText: "Unauthorized" })),
		);

		// streamAi is an async generator, so drain it before asserting.
		const drain = async () => {
			for await (const _chunk of streamAi([{ role: "user", text: "hi" }], "sys", "s")) {
				// no-op
			}
		};

		await expect(drain()).rejects.toMatchObject({
			status: 401,
			message: expect.stringContaining("OpenCode Go HTTP 401"),
		});
	});
});
