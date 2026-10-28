import { beforeEach, describe, expect, it, vi } from "vitest";

const aiMocks = vi.hoisted(() => ({
	completeAi: vi.fn(),
	isAiEnabled: vi.fn(),
}));

vi.mock("@/lib/ai", () => ({
	completeAi: aiMocks.completeAi,
	isAiEnabled: aiMocks.isAiEnabled,
	stableSessionId: (...parts: unknown[]) => parts.join("|"),
}));

import {
	type PredictionInputs,
	capConfidence,
	clampPredictionGrams,
	clearPredictionAiCache,
	computeDeterministicPrediction,
	normalisePredictionInputs,
	parseAiPredictionPayload,
	predictionUpperBound,
	refinePredictionWithAi,
} from "../prediction";

const now = new Date("2026-10-24T12:00:00.000Z");

function inputs(overrides: Partial<PredictionInputs> = {}): PredictionInputs {
	return {
		feedingRatePct: 5,
		feedsPerDay: 3,
		population: 1000,
		avgWeightKg: 0.25,
		latestFcr: null,
		currentGrams: 140,
		hopperCapacityG: 22_190,
		lastSampleAt: new Date(now.getTime() - 5 * 86_400_000),
		...overrides,
	};
}

function baselineFor(overrides: Partial<PredictionInputs> = {}) {
	return computeDeterministicPrediction(inputs(overrides), now);
}

beforeEach(() => {
	aiMocks.completeAi.mockReset();
	aiMocks.isAiEnabled.mockReset();
	clearPredictionAiCache();
});

describe("normalisePredictionInputs", () => {
	it("turns corrupt required values into a no-data state", () => {
		const result = normalisePredictionInputs(
			inputs({
				feedingRatePct: Number.NaN,
				feedsPerDay: Number.POSITIVE_INFINITY,
				avgWeightKg: Number.NaN,
			}),
		);
		expect(result.feedingRatePct).toBe(0);
		expect(result.feedsPerDay).toBe(0);
		expect(result.avgWeightKg).toBeNull();
	});

	it("clamps out-of-range values into the device/schema envelope", () => {
		const result = normalisePredictionInputs(
			inputs({
				feedingRatePct: 99,
				feedsPerDay: 100,
				population: 9_999_999,
				avgWeightKg: 500,
				latestFcr: 99,
				currentGrams: 9_999,
				hopperCapacityG: -10,
			}),
		);
		expect(result.feedingRatePct).toBe(10);
		expect(result.feedsPerDay).toBe(24);
		expect(result.population).toBe(1_000_000);
		expect(result.avgWeightKg).toBe(50);
		expect(result.latestFcr).toBe(10);
		expect(result.currentGrams).toBe(1_000);
		expect(result.hopperCapacityG).toBeNull();
	});

	it("rejects an invalid sample date", () => {
		const result = normalisePredictionInputs(inputs({ lastSampleAt: new Date(Number.NaN) }));
		expect(result.lastSampleAt).toBeNull();
	});
});

describe("clampPredictionGrams safety", () => {
	it("never exceeds the device ceiling when the deviation floor is higher", () => {
		// 24 meals/day gives a 208.3 g per-meal ceiling, but the current value
		// of 1000 g would put the ±50% floor at 500 g. Device safety must win.
		const upper = predictionUpperBound(24, null);
		const result = clampPredictionGrams(500, {
			feedsPerDay: 24,
			hopperCapacityG: null,
			currentGrams: 1000,
		});
		expect(result.grams).toBeLessThanOrEqual(upper);
		expect(result.grams).toBe(83.3);
		expect(result.clamped).toBe(true);
		expect(result.reasons).toContain("deviceLimit");
	});

	it("reports every reason that binds the value", () => {
		const result = clampPredictionGrams(5000, {
			feedsPerDay: 3,
			hopperCapacityG: null,
			currentGrams: 100,
		});
		expect(result.reasons).toContain("deviceLimit");
		expect(result.reasons).toContain("deviationBand");
		expect(result.grams).toBe(150);
	});

	it("handles a non-finite candidate without producing NaN", () => {
		const result = clampPredictionGrams(Number.NaN, {
			feedsPerDay: 3,
			hopperCapacityG: null,
			currentGrams: null,
		});
		expect(Number.isFinite(result.grams)).toBe(true);
		expect(result.grams).toBe(1);
		expect(result.reasons).toContain("minimum");
	});
});

describe("confidence hardening", () => {
	it("never lets AI raise confidence above the data-supported level", () => {
		expect(capConfidence("high", "medium")).toBe("medium");
		expect(capConfidence("high", "low")).toBe("low");
		expect(capConfidence("low", "high")).toBe("low");
		expect(capConfidence("medium", "medium")).toBe("medium");
	});

	it("records why confidence is high, medium or low", () => {
		const high = baselineFor({ latestFcr: 1.5 });
		expect(high.confidence).toBe("high");
		expect(high.confidenceReasons).toEqual(["sampleFresh", "fcrAvailable"]);

		const noFcr = baselineFor({ latestFcr: null });
		expect(noFcr.confidence).toBe("medium");
		expect(noFcr.confidenceReasons).toContain("fcrMissing");

		const aging = baselineFor({
			lastSampleAt: new Date(now.getTime() - 30 * 86_400_000),
			latestFcr: 1.5,
		});
		expect(aging.confidence).toBe("medium");
		expect(aging.confidenceReasons).toContain("sampleAging");

		const stale = baselineFor({
			lastSampleAt: new Date(now.getTime() - 50 * 86_400_000),
			latestFcr: 1.5,
		});
		expect(stale.confidence).toBe("low");
		expect(stale.confidenceReasons).toContain("sampleStale");

		const missing = baselineFor({ lastSampleAt: null });
		expect(missing.confidenceReasons).toContain("sampleMissing");
	});
});

describe("parseAiPredictionPayload", () => {
	it("accepts a fenced JSON object and sanitises the reasoning", () => {
		const parsed = parseAiPredictionPayload(
			'```json\n{"grams": 138.5, "confidence": "high", "reasoning": "Line one\\nLine two\\u0000"}\n```',
		);
		expect(parsed?.grams).toBe(138.5);
		expect(parsed?.confidence).toBe("high");
		expect(parsed?.reasoning).toBe("Line one Line two");
	});

	it("rejects non-numeric, zero and negative grams", () => {
		expect(parseAiPredictionPayload('{"grams": "138"}')).toBeNull();
		expect(parseAiPredictionPayload('{"grams": 0}')).toBeNull();
		expect(parseAiPredictionPayload('{"grams": -5}')).toBeNull();
	});

	it("rejects malformed output instead of throwing", () => {
		expect(parseAiPredictionPayload("not json at all")).toBeNull();
		expect(parseAiPredictionPayload("")).toBeNull();
	});

	it("caps reasoning length", () => {
		const parsed = parseAiPredictionPayload(
			JSON.stringify({ grams: 12, reasoning: "x".repeat(1_000) }),
		);
		expect(parsed?.reasoning?.length).toBeLessThanOrEqual(240);
	});
});

describe("refinePredictionWithAi", () => {
	it("returns the deterministic baseline when AI is disabled", async () => {
		aiMocks.isAiEnabled.mockResolvedValue(false);
		const baseline = baselineFor();
		const result = await refinePredictionWithAi(inputs(), baseline);
		expect(result).toBe(baseline);
		expect(aiMocks.completeAi).not.toHaveBeenCalled();
	});

	it("clamps AI output and caps an inflated confidence claim", async () => {
		aiMocks.isAiEnabled.mockResolvedValue(true);
		aiMocks.completeAi.mockResolvedValue({
			content: JSON.stringify({
				grams: 500,
				confidence: "high",
				reasoning: "Push the feed rate for faster growth.",
			}),
		});
		const baseline = baselineFor({
			population: 10,
			avgWeightKg: 0.05,
			feedsPerDay: 2,
			currentGrams: 100,
			lastSampleAt: new Date(now.getTime() - 50 * 86_400_000),
			latestFcr: null,
		});

		const result = await refinePredictionWithAi(
			inputs({
				population: 10,
				avgWeightKg: 0.05,
				feedsPerDay: 2,
				currentGrams: 100,
				lastSampleAt: new Date(now.getTime() - 50 * 86_400_000),
				latestFcr: null,
			}),
			baseline,
		);

		expect(result.source).toBe("ai");
		// Baseline is clamped to the 50 g deviation floor; the AI may only
		// refine within ±20% of that baseline, so 500 g becomes 60 g.
		expect(result.grams).toBe(60);
		expect(result.confidence).toBe("low");
		expect(result.confidenceReasons).toContain("aiConfidenceCapped");
		expect(result.safety.clamped).toBe(true);
		expect(result.safety.clampReasons).toContain("baselineBand");
		expect(result.reasoning).toContain("safe feeding envelope");
	});

	it("falls back to the baseline on malformed AI output", async () => {
		aiMocks.isAiEnabled.mockResolvedValue(true);
		aiMocks.completeAi.mockResolvedValue({ content: "I recommend 200 grams." });
		const baseline = baselineFor();
		const result = await refinePredictionWithAi(inputs(), baseline);
		expect(result).toBe(baseline);
	});

	it("falls back to the baseline when the provider throws", async () => {
		aiMocks.isAiEnabled.mockResolvedValue(true);
		aiMocks.completeAi.mockRejectedValue(new Error("quota exhausted"));
		const baseline = baselineFor();
		const result = await refinePredictionWithAi(inputs(), baseline);
		expect(result).toBe(baseline);
	});

	it("caches an identical refinement instead of calling the provider again", async () => {
		aiMocks.isAiEnabled.mockResolvedValue(true);
		aiMocks.completeAi.mockResolvedValue({
			content: JSON.stringify({ grams: 145, confidence: "medium", reasoning: "Slight increase." }),
		});
		const baseline = baselineFor();
		const first = await refinePredictionWithAi(inputs(), baseline);
		const second = await refinePredictionWithAi(inputs(), baseline);

		expect(aiMocks.completeAi).toHaveBeenCalledTimes(1);
		expect(first.cached).toBe(false);
		expect(second.cached).toBe(true);
		expect(second.grams).toBe(first.grams);
	});
});
