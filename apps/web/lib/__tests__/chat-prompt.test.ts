import { describe, expect, it } from "vitest";
import { enforcePromptLimit, sanitizeInput } from "../chat/prompt";
import { MAX_PROMPT_LENGTH } from "../constants";

describe("sanitizeInput", () => {
	it("strips newlines and replaces with space", () => {
		expect(sanitizeInput("hello\nworld\r\nfoo")).toBe("hello world foo");
	});

	it("strips non-breaking whitespace (tabs, etc.)", () => {
		// Tabs and other non-space whitespace are removed entirely
		expect(sanitizeInput("hello\tworld")).toBe("helloworld");
	});

	it("trims leading/trailing whitespace", () => {
		expect(sanitizeInput("  hello  ")).toBe("hello");
	});

	it("truncates to maxLen", () => {
		expect(sanitizeInput("hello world", 5)).toBe("hello");
	});

	it("uses default maxLen of 200", () => {
		const longInput = "a".repeat(300);
		expect(sanitizeInput(longInput)).toHaveLength(200);
	});

	it("returns empty string for empty input", () => {
		expect(sanitizeInput("")).toBe("");
	});
});

describe("enforcePromptLimit", () => {
	it("returns prompt unchanged when under limit", () => {
		const short = "Hello, how are you?";
		expect(enforcePromptLimit(short)).toBe(short);
	});

	it("truncates prompt when over limit", () => {
		const long = "a".repeat(MAX_PROMPT_LENGTH + 100);
		expect(enforcePromptLimit(long)).toHaveLength(MAX_PROMPT_LENGTH);
	});

	it("returns exact prompt at limit boundary", () => {
		const exact = "a".repeat(MAX_PROMPT_LENGTH);
		expect(enforcePromptLimit(exact)).toBe(exact);
	});

	it("returns empty string for empty input", () => {
		expect(enforcePromptLimit("")).toBe("");
	});
});
