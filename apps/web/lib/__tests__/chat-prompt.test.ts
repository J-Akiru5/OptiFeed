import { describe, expect, it } from "vitest";
import type { ChatContext } from "../chat/context";
import { buildSystemPrompt, enforcePromptLimit, sanitizeInput } from "../chat/prompt";
import { MAX_PROMPT_LENGTH } from "../constants";

const baseCtx: ChatContext = {
	pondName: "Test Pond",
	feedsPerDay: 3,
	feedingRatePct: 5,
	population: 1000,
	totalBiomassG: 250000,
	scheduleStart: new Date("2026-01-01T00:00:00Z"),
	scheduleEnd: new Date("2026-01-01T12:00:00Z"),
	deviceOnline: true,
	devicePaused: false,
	hopperLevelPct: 80,
	waterTempC: 28,
	waterTempOk: true,
	latestFcr: 1.5,
	latestAbwG: 250,
	sampleCount: 100,
	feedingsToday: 1,
	lastDispensedAt: null,
	lastCommandStatus: "acked",
	currentGramsPerFeeding: 140,
	predictedFeedGrams: 138.5,
	predictedFeedReasoning: "Standard feed math gives 138.5g per meal.",
	lastSampleAt: new Date("2026-01-01T08:00:00Z"),
	isFallow: false,
	cycleLabel: null,
	growOutDay: null,
	daysToHarvest: null,
	targetHarvestDate: null,
	targetHarvestWeightG: null,
	growthPlan: null,
	calibrationDrift: { status: "insufficient_data", dispensedG: 0, observedG: 0, diffPct: null },
};

describe("buildSystemPrompt", () => {
	it("includes the predicted and current grams per feeding", () => {
		const prompt = buildSystemPrompt(baseCtx, "en");
		expect(prompt).toContain("AI predicted grams per feeding: 138.5g");
		expect(prompt).toContain("Current grams per feeding (device): 140g");
		expect(prompt).toContain("Reasoning: Standard feed math gives 138.5g per meal.");
	});

	it("includes grow-out and fallow context", () => {
		const prompt = buildSystemPrompt(
			{
				...baseCtx,
				isFallow: true,
				cycleLabel: "Batch 2026-10",
				growOutDay: 45,
				daysToHarvest: 90,
				targetHarvestDate: "2027-01-20",
				targetHarvestWeightG: 250,
			},
			"en",
		);
		expect(prompt).toContain("Pond fallow after harvest: Yes");
		expect(prompt).toContain("Grow-out cycle: Batch 2026-10");
		expect(prompt).toContain("Grow-out day: Day 45");
		expect(prompt).toContain("Days to harvest: 90 days");
		expect(prompt).toContain("Target harvest: 2027-01-20 at 250g per fish");
		expect(prompt).toContain("do not recommend a feed amount");
	});

	it("shows no-prediction placeholder when prediction is null", () => {
		const prompt = buildSystemPrompt(
			{ ...baseCtx, predictedFeedGrams: null, predictedFeedReasoning: null },
			"en",
		);
		expect(prompt).toContain("AI predicted grams per feeding: No prediction available");
		expect(prompt).not.toContain("Reasoning:");
	});

	it("instructs the model to cite predicted values and never invent amounts", () => {
		const prompt = buildSystemPrompt(baseCtx, "en");
		expect(prompt).toContain("Never invent a feed amount");
		expect(prompt).toContain("AI predicted grams per feeding");
	});

	it("includes last sample date", () => {
		const prompt = buildSystemPrompt(baseCtx, "en");
		expect(prompt).toContain("Last sample date:");
	});

	it("flags calibration drift and stays quiet when data is insufficient", () => {
		const drift = buildSystemPrompt(
			{
				...baseCtx,
				calibrationDrift: {
					status: "drift",
					dispensedG: 600,
					observedG: 900,
					diffPct: 50,
				},
			},
			"en",
		);
		expect(drift).toContain("dispensed 600g vs hopper drop 900g (+50.0%)");
		expect(drift).toContain("suggest re-running the calibration target check");

		const insufficient = buildSystemPrompt(baseCtx, "en");
		expect(insufficient).toContain("Not enough feed and hopper readings to compare");
	});

	it("handles null context", () => {
		const prompt = buildSystemPrompt(null, "en");
		expect(prompt).toContain("No pond data available yet");
	});

	it("requests Hiligaynon when locale is hil", () => {
		const prompt = buildSystemPrompt(baseCtx, "hil");
		expect(prompt).toContain("Hiligaynon");
	});
});

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
