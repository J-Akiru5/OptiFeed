import { describe, expect, it } from "vitest";
import { looksLikeAssistantRequest, looksLikeNavigation } from "../chat/agent-intent";

describe("looksLikeNavigation", () => {
	it.each([
		"Take me to calibration",
		"Open the members list",
		"Where do I change the schedule?",
		"How do I get to the device registry?",
	])("recognises %s", (message) => {
		expect(looksLikeNavigation(message)).toBe(true);
	});

	it("leaves ordinary questions on the chat path", () => {
		expect(looksLikeNavigation("What is my FCR?")).toBe(false);
		expect(looksLikeNavigation("How much should I feed?")).toBe(false);
	});
});

describe("looksLikeAssistantRequest", () => {
	it("recognises the action vocabulary added in #194", () => {
		expect(looksLikeAssistantRequest("Pause feeding for today")).toBe(true);
		expect(looksLikeAssistantRequest("Feed them now")).toBe(true);
		expect(looksLikeAssistantRequest("Invite Karl as an operator")).toBe(true);
		expect(looksLikeAssistantRequest("Suspend the CICT organization")).toBe(true);
		expect(looksLikeAssistantRequest("Mark the net cleaning task done")).toBe(true);
		expect(looksLikeAssistantRequest("Take me to the pond settings")).toBe(true);
	});

	it("does not intercept ordinary pond questions", () => {
		expect(looksLikeAssistantRequest("What is my FCR?")).toBe(false);
		expect(looksLikeAssistantRequest("When is the next feeding time?")).toBe(false);
		expect(looksLikeAssistantRequest("Are we on track for 330g?")).toBe(false);
	});
});
