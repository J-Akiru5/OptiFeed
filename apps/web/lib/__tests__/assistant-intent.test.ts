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

	it("recognises the write surface added for #344", () => {
		expect(looksLikeAssistantRequest("Rotate the token for feeder 3")).toBe(true);
		expect(looksLikeAssistantRequest("Revoke Ana's access")).toBe(true);
		expect(looksLikeAssistantRequest("Delete the net cleaning event")).toBe(true);
		expect(looksLikeAssistantRequest("Archive Pond B")).toBe(true);
		expect(looksLikeAssistantRequest("Move the feeder to Pond B")).toBe(true);
		expect(looksLikeAssistantRequest("Disable Karl's account")).toBe(true);
		expect(looksLikeAssistantRequest("Stop view-as")).toBe(true);
	});

	it("treats a follow-up answer to the assistant's own question as the same action", () => {
		const history = [
			{ role: "user" as const, content: "Add a pond sampling task for Nov 6" },
			{
				role: "assistant" as const,
				content: "Should the deadline be the same day, and should it repeat?",
			},
		];

		expect(
			looksLikeAssistantRequest("deadline same day and it does not repeat. Now go", history),
		).toBe(true);
		expect(looksLikeAssistantRequest("3 meals", history)).toBe(true);
		expect(looksLikeAssistantRequest("What is my FCR?", history)).toBe(false);

		expect(
			looksLikeAssistantRequest("same day", [
				{ role: "assistant", content: "I need the event date and whether it repeats." },
			]),
		).toBe(true);
	});

	it("does not intercept ordinary pond questions", () => {
		expect(looksLikeAssistantRequest("What is my FCR?")).toBe(false);
		expect(looksLikeAssistantRequest("When is the next feeding time?")).toBe(false);
		expect(looksLikeAssistantRequest("Are we on track for 330g?")).toBe(false);
	});
});
