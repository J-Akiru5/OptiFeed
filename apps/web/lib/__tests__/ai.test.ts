import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { aiDebugInfo, getAiModelId, getReasoningEffort, isAiEnabled, isAiQuotaError } from "../ai";

beforeEach(() => {
	vi.stubEnv("OPENROUTER_API_KEY", "test-key");
	vi.stubEnv("OPENROUTER_REASONING_EFFORT", "high");
	vi.stubEnv("OPENROUTER_MODEL", undefined);
});

afterEach(() => {
	vi.unstubAllEnvs();
});

describe("isAiEnabled", () => {
	it("returns true when API key is set", () => {
		expect(isAiEnabled()).toBe(true);
	});

	it("returns false when API key is missing", () => {
		vi.stubEnv("OPENROUTER_API_KEY", "");
		expect(isAiEnabled()).toBe(false);
	});
});

describe("getAiModelId", () => {
	it("defaults to deepseek flash", () => {
		expect(getAiModelId()).toBe("deepseek/deepseek-v4.1-flash");
	});

	it("uses OPENROUTER_MODEL when set", () => {
		vi.stubEnv("OPENROUTER_MODEL", "openai/gpt-4o");
		expect(getAiModelId()).toBe("openai/gpt-4o");
	});
});

describe("getReasoningEffort", () => {
	it("defaults to high", () => {
		expect(getReasoningEffort()).toBe("high");
	});

	it("maps none/off/disabled to none", () => {
		for (const v of ["none", "off", "disabled"]) {
			vi.stubEnv("OPENROUTER_REASONING_EFFORT", v);
			expect(getReasoningEffort()).toBe("none");
		}
	});

	it("passes through low and medium", () => {
		vi.stubEnv("OPENROUTER_REASONING_EFFORT", "low");
		expect(getReasoningEffort()).toBe("low");
		vi.stubEnv("OPENROUTER_REASONING_EFFORT", "medium");
		expect(getReasoningEffort()).toBe("medium");
	});

	it("falls back to high for unknown values", () => {
		vi.stubEnv("OPENROUTER_REASONING_EFFORT", "extreme");
		expect(getReasoningEffort()).toBe("high");
	});
});

describe("aiDebugInfo", () => {
	it("reports key presence without exposing the key", () => {
		const info = aiDebugInfo();
		expect(info.hasKey).toBe(true);
		expect(info.model).toBe("deepseek/deepseek-v4.1-flash");
		expect(info.reasoningEffort).toBe("high");
		expect(JSON.stringify(info)).not.toContain("test-key");
	});
});

describe("isAiQuotaError", () => {
	it("detects HTTP 429 via status", () => {
		expect(isAiQuotaError({ status: 429, message: "Too Many Requests" })).toBe(true);
	});

	it("detects 429 in message", () => {
		expect(isAiQuotaError(new Error("OpenRouter HTTP 429: Too Many Requests"))).toBe(true);
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
