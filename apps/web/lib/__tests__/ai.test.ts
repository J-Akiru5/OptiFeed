import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	aiDebugInfo,
	completeAi,
	getReasoningEffort,
	isAiEnabled,
	isAiQuotaError,
	stableSessionId,
	streamAi,
} from "../ai";
import type { AiProviderRuntimeConfig } from "../ai-providers/types";

function cfg(
	provider: string,
	overrides: Partial<AiProviderRuntimeConfig> = {},
): AiProviderRuntimeConfig {
	return {
		provider,
		model: `model-${provider}`,
		apiKey: `key-${provider}`,
		reasoningEffort: "high",
		params: {},
		...overrides,
	};
}

const A = cfg("opencode-go");
const B = cfg("gemini");

afterEach(() => {
	vi.unstubAllEnvs();
	vi.unstubAllGlobals();
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
		expect(stableSessionId("chat", "farm-1", "hello")).toMatch(/^optifeed-[0-9a-z]+$/);
	});
});

describe("getReasoningEffort", () => {
	beforeEach(() => vi.stubEnv("OPENCODE_GO_REASONING_EFFORT", ""));

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

describe("isAiEnabled / aiDebugInfo", () => {
	it("is enabled when the chain is non-empty", async () => {
		expect(await isAiEnabled({ configs: [A, B] })).toBe(true);
	});

	it("is disabled when no provider has a key", async () => {
		expect(await isAiEnabled({ configs: [] })).toBe(false);
	});

	it("reports the chain without leaking keys", async () => {
		const info = await aiDebugInfo({ configs: [A, B] });
		expect(info.hasKey).toBe(true);
		expect(info.primary).toBe("opencode-go");
		expect(info.providers).toEqual([
			{ provider: "opencode-go", model: "model-opencode-go" },
			{ provider: "gemini", model: "model-gemini" },
		]);
		expect(JSON.stringify(info)).not.toContain("key-opencode-go");
		expect(JSON.stringify(info)).not.toContain("key-gemini");
	});
});

describe("isAiQuotaError", () => {
	it("detects HTTP 429 via status", () => {
		expect(isAiQuotaError({ status: 429, message: "Too Many Requests" })).toBe(true);
	});

	it("detects quota and rate-limit messages", () => {
		expect(isAiQuotaError(new Error("OpenCode Go HTTP 429"))).toBe(true);
		expect(isAiQuotaError(new Error("rate limit exceeded"))).toBe(true);
		expect(isAiQuotaError(new Error("insufficient credit"))).toBe(true);
		expect(isAiQuotaError(new Error("RESOURCE_EXHAUSTED"))).toBe(true);
	});

	it("returns false for other errors", () => {
		expect(isAiQuotaError({ status: 500, message: "Internal Server Error" })).toBe(false);
	});
});

describe("streamAi failover", () => {
	function stubFetchSequence(steps: (() => Response | Promise<Response>)[]) {
		let i = 0;
		const mock = vi.fn(async (_url: string, _init: RequestInit) => {
			const step = steps[Math.min(i, steps.length - 1)];
			i += 1;
			return step();
		});
		vi.stubGlobal("fetch", mock);
		return mock;
	}

	function sse(text: string): Response {
		const body = [`data: {"choices":[{"delta":{"content":"${text}"}}]}`, "data: [DONE]", ""].join(
			"\n",
		);
		return new Response(body, { status: 200, headers: { "Content-Type": "text/event-stream" } });
	}

	/** Gemini streams `candidates[].content.parts[].text`, not OpenAI deltas. */
	function sseGemini(text: string): Response {
		const body = `data: {"candidates":[{"content":{"parts":[{"text":"${text}"}]}}]}\n\n`;
		return new Response(body, { status: 200, headers: { "Content-Type": "text/event-stream" } });
	}

	async function drain(gen: AsyncGenerator<string>): Promise<string> {
		let out = "";
		for await (const chunk of gen) out += chunk;
		return out;
	}

	it("uses the first provider when it works", async () => {
		const fetchMock = stubFetchSequence([() => sse("from-go")]);
		const out = await drain(
			streamAi([{ role: "user", text: "hi" }], "sys", "s", { configs: [A, B] }),
		);
		expect(out).toBe("from-go");
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it("fails over to the next provider on a 5xx before any token", async () => {
		const fetchMock = stubFetchSequence([
			() => new Response("boom", { status: 500, statusText: "Server Error" }),
			() => sseGemini("from-gemini"),
		]);
		const out = await drain(
			streamAi([{ role: "user", text: "hi" }], "sys", "s", { configs: [A, B] }),
		);
		expect(out).toBe("from-gemini");
		expect(fetchMock).toHaveBeenCalledTimes(2);
	});

	it("fails over on a 401 too — failover is status-agnostic", async () => {
		const fetchMock = stubFetchSequence([
			() => new Response("nope", { status: 401, statusText: "Unauthorized" }),
			() => sseGemini("from-gemini"),
		]);
		const out = await drain(
			streamAi([{ role: "user", text: "hi" }], "sys", "s", { configs: [A, B] }),
		);
		expect(out).toBe("from-gemini");
		expect(fetchMock).toHaveBeenCalledTimes(2);
	});

	it("does NOT fail over once a token has already been emitted", async () => {
		// First provider yields one chunk, then the connection dies mid-stream.
		const encoder = new TextEncoder();
		const failing = new Response(
			new ReadableStream<Uint8Array>({
				async start(controller) {
					controller.enqueue(
						encoder.encode('data: {"choices":[{"delta":{"content":"partial"}}]}\n'),
					);
					// Give the reader a tick to consume the chunk before erroring.
					await new Promise((resolve) => setTimeout(resolve, 10));
					controller.error(new Error("connection reset"));
				},
			}),
			{ status: 200, headers: { "Content-Type": "text/event-stream" } },
		);

		const fetchMock = stubFetchSequence([() => failing, () => sseGemini("from-gemini")]);

		let collected = "";
		await expect(
			(async () => {
				for await (const chunk of streamAi([{ role: "user", text: "hi" }], "sys", "s", {
					configs: [A, B],
				})) {
					collected += chunk;
				}
			})(),
		).rejects.toThrow();

		expect(collected).toBe("partial");
		// Committed to the first provider — the second must never be called.
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it("yields nothing when no provider is configured", async () => {
		const fetchMock = vi.fn();
		vi.stubGlobal("fetch", fetchMock);
		const out = await drain(streamAi([{ role: "user", text: "hi" }], "sys", "s", { configs: [] }));
		expect(out).toBe("");
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("throws the last error when every provider fails", async () => {
		stubFetchSequence([
			() => new Response("a", { status: 500, statusText: "Server Error" }),
			() => new Response("b", { status: 503, statusText: "Unavailable" }),
		]);
		await expect(
			drain(streamAi([{ role: "user", text: "hi" }], "sys", "s", { configs: [A, B] })),
		).rejects.toMatchObject({ status: 503 });
	});
});

describe("completeAi failover", () => {
	function stubJsonSequence(responses: (() => Response)[]) {
		let i = 0;
		const mock = vi.fn(async (_url: string, _init: RequestInit) => {
			const step = responses[Math.min(i, responses.length - 1)];
			i += 1;
			return step();
		});
		vi.stubGlobal("fetch", mock);
		return mock;
	}

	function okGo(content: string): Response {
		return new Response(JSON.stringify({ choices: [{ message: { content } }] }), {
			status: 200,
			headers: { "Content-Type": "application/json" },
		});
	}

	/** Gemini returns `candidates[].content.parts[].text`. */
	function okGemini(content: string): Response {
		return new Response(
			JSON.stringify({ candidates: [{ content: { parts: [{ text: content }] } }] }),
			{ status: 200, headers: { "Content-Type": "application/json" } },
		);
	}

	it("returns the first provider's content", async () => {
		const fetchMock = stubJsonSequence([() => okGo('{"grams": 100}')]);
		const res = await completeAi([{ role: "user", text: "hi" }], "sys", "s", { configs: [A, B] });
		expect(res?.content).toBe('{"grams": 100}');
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it("tries the next provider when the first errors", async () => {
		const fetchMock = stubJsonSequence([
			() => new Response("x", { status: 500, statusText: "Server Error" }),
			() => okGemini('{"grams": 200}'),
		]);
		const res = await completeAi([{ role: "user", text: "hi" }], "sys", "s", { configs: [A, B] });
		expect(res?.content).toBe('{"grams": 200}');
		expect(fetchMock).toHaveBeenCalledTimes(2);
	});

	it("tries the next provider when the first returns empty content", async () => {
		const fetchMock = stubJsonSequence([() => okGo(""), () => okGemini("second")]);
		const res = await completeAi([{ role: "user", text: "hi" }], "sys", "s", { configs: [A, B] });
		expect(res?.content).toBe("second");
		expect(fetchMock).toHaveBeenCalledTimes(2);
	});

	it("returns null when nothing is configured", async () => {
		expect(
			await completeAi([{ role: "user", text: "hi" }], "sys", "s", { configs: [] }),
		).toBeNull();
	});

	it("throws the last error when every provider fails", async () => {
		stubJsonSequence([
			() => new Response("a", { status: 500, statusText: "Server Error" }),
			() => new Response("b", { status: 503, statusText: "Unavailable" }),
		]);
		await expect(
			completeAi([{ role: "user", text: "hi" }], "sys", "s", { configs: [A, B] }),
		).rejects.toMatchObject({ status: 503 });
	});
});
