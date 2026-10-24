import { describe, expect, it } from "vitest";
import { looksLikeAction } from "../chat/agent-intent";

describe("looksLikeAction", () => {
	it("recognises cycle and target commands", () => {
		expect(looksLikeAction("Set our grow-out cycle from May 1 to August 29")).toBe(true);
		expect(looksLikeAction("Start a cycle with 330g target")).toBe(true);
		expect(looksLikeAction("Change the harvest date to December 15")).toBe(true);
		expect(looksLikeAction("Apply the feeding plan")).toBe(true);
	});

	it("leaves ordinary questions on the streaming path", () => {
		expect(looksLikeAction("Are we on track for 330g?")).toBe(false);
		expect(looksLikeAction("What is my current FCR?")).toBe(false);
		expect(looksLikeAction("When is the next feeding time?")).toBe(false);
		expect(looksLikeAction("How many grams should I feed?")).toBe(false);
	});

	it("ignores empty input", () => {
		expect(looksLikeAction("   ")).toBe(false);
	});
});
