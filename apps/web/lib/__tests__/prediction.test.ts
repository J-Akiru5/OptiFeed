import { describe, expect, it } from "vitest";
import {
	type PredictionInputs,
	clampPredictionGrams,
	computeDeterministicPrediction,
	predictionUpperBound,
} from "../prediction";
import { calculateNextFeeding } from "../volumeCalc";

const baseInputs: PredictionInputs = {
	feedingRatePct: 5,
	feedsPerDay: 3,
	population: 1000,
	avgWeightKg: 0.25,
	latestFcr: null,
	currentGrams: 140,
	hopperCapacityG: 22190,
	lastSampleAt: new Date(),
};

describe("predictionUpperBound", () => {
	it("caps at MAX_FEED_GRAMS_PER_REQUEST", () => {
		expect(predictionUpperBound(1, 1_000_000)).toBe(1000);
	});

	it("limits by the daily ceiling divided by feedsPerDay", () => {
		// 2,000 g default ceiling / 4 feeds = 500 g
		expect(predictionUpperBound(4, null)).toBe(500);
		// 2,000 / 24 = 83.33
		expect(predictionUpperBound(24, null)).toBeCloseTo(83.3, 1);
		// A raised 5,000 g ceiling / 4 feeds = 1,250 → capped by MAX 1000
		expect(predictionUpperBound(4, null, 5000)).toBe(1000);
	});

	it("uses hopper capacity as daily cap when smaller", () => {
		// hopper 500g daily cap → 500/2 = 250
		expect(predictionUpperBound(2, 500)).toBe(250);
	});

	it("returns MAX when feedsPerDay is 0", () => {
		expect(predictionUpperBound(0, null)).toBe(1000);
	});
});

describe("clampPredictionGrams", () => {
	it("clamps candidate above upper bound down to bound", () => {
		const { grams, clamped } = clampPredictionGrams(5000, {
			feedsPerDay: 24,
			hopperCapacityG: null,
			currentGrams: null,
		});
		expect(clamped).toBe(true);
		expect(grams).toBeLessThanOrEqual(1000);
	});

	it("clamps candidate below 1 up to 1", () => {
		const { grams, clamped } = clampPredictionGrams(0, {
			feedsPerDay: 3,
			hopperCapacityG: null,
			currentGrams: null,
		});
		expect(clamped).toBe(true);
		expect(grams).toBe(1);
	});

	it("applies ±50% deviation envelope around current grams", () => {
		const up = clampPredictionGrams(300, {
			feedsPerDay: 3,
			hopperCapacityG: null,
			currentGrams: 100,
		});
		expect(up.clamped).toBe(true);
		expect(up.grams).toBe(150);

		const down = clampPredictionGrams(20, {
			feedsPerDay: 3,
			hopperCapacityG: null,
			currentGrams: 100,
		});
		expect(down.clamped).toBe(true);
		expect(down.grams).toBe(50);
	});

	it("does not clamp when within all bounds", () => {
		const { grams, clamped } = clampPredictionGrams(140, {
			feedsPerDay: 3,
			hopperCapacityG: null,
			currentGrams: 140,
		});
		expect(clamped).toBe(false);
		expect(grams).toBe(140);
	});

	it("ignores deviation envelope when currentGrams is null", () => {
		const { grams, clamped } = clampPredictionGrams(400, {
			feedsPerDay: 3,
			hopperCapacityG: null,
			currentGrams: null,
		});
		expect(clamped).toBe(false);
		expect(grams).toBe(400);
	});

	it("rounds to 1 decimal", () => {
		const { grams } = clampPredictionGrams(140.44, {
			feedsPerDay: 3,
			hopperCapacityG: null,
			currentGrams: null,
		});
		expect(grams).toBe(140.4);
	});
});

describe("computeDeterministicPrediction", () => {
	it("returns null grams when no biomass sample", () => {
		const result = computeDeterministicPrediction({ ...baseInputs, avgWeightKg: null });
		expect(result.grams).toBeNull();
		expect(result.baselineGrams).toBeNull();
		expect(result.source).toBe("deterministic");
		expect(result.confidence).toBe("low");
	});

	it("returns null grams when feedingRatePct is 0", () => {
		const result = computeDeterministicPrediction({ ...baseInputs, feedingRatePct: 0 });
		expect(result.grams).toBeNull();
	});

	it("baseline matches calculateNextFeeding with same inputs", () => {
		const result = computeDeterministicPrediction({ ...baseInputs, latestFcr: null });
		const expected = calculateNextFeeding(0.25, 5, 3, 1000) ?? 0;
		expect(result.baselineGrams).toBe(Math.round(expected * 10) / 10);
	});

	it("nudges rate up when FCR is better than reference", () => {
		const good = computeDeterministicPrediction({ ...baseInputs, latestFcr: 1.2 });
		const neutral = computeDeterministicPrediction({ ...baseInputs, latestFcr: null });
		expect(good.grams).not.toBeNull();
		expect(neutral.grams).not.toBeNull();
		// Better FCR → more feed recommended (within clamp)
		expect(good.grams).not.toBeLessThan(neutral.grams ?? 0);
		expect(good.reasoning).toContain("better");
	});

	it("trims rate when FCR is worse than reference", () => {
		const bad = computeDeterministicPrediction({ ...baseInputs, latestFcr: 2.0 });
		const neutral = computeDeterministicPrediction({ ...baseInputs, latestFcr: null });
		expect(bad.grams).not.toBeNull();
		expect(bad.reasoning).toContain("above");
		// Worse FCR → less or equal feed
		expect(bad.grams ?? Number.POSITIVE_INFINITY).not.toBeGreaterThan(neutral.grams ?? 0);
	});

	it("FCR adjustment factor is bounded to ±15%", () => {
		// Small pond so no device caps interfere: 10 fish × 0.05kg = 500g biomass,
		// 5% rate → 25g/day ÷ 2 meals = 12.5g/meal baseline (no current-grams clamp).
		const small = {
			...baseInputs,
			population: 10,
			avgWeightKg: 0.05,
			feedsPerDay: 2,
			currentGrams: null as number | null,
		};
		const neutral = computeDeterministicPrediction({ ...small, latestFcr: null });
		expect(neutral.grams).toBe(12.5);

		// FCR 1.0 → factor 1.5 clamped to 1.15 → 14.375 → rounded 14.4
		const best = computeDeterministicPrediction({ ...small, latestFcr: 1.0 });
		expect(best.grams).toBe(14.4);

		// FCR 2.0 → factor 1.5/2.0 = 0.75 clamped up to 0.85 → 10.625 → rounded 10.6
		const worst = computeDeterministicPrediction({ ...small, latestFcr: 2.0 });
		expect(worst.grams).toBe(10.6);
	});

	it("high confidence when FCR present and sample is fresh (≤21d)", () => {
		const now = new Date();
		const recent = new Date(now.getTime() - 5 * 86_400_000);
		const result = computeDeterministicPrediction(
			{ ...baseInputs, latestFcr: 1.5, lastSampleAt: recent },
			now,
		);
		expect(result.confidence).toBe("high");
	});

	it("medium confidence when sample is 22–42 days old", () => {
		const now = new Date();
		const sample = new Date(now.getTime() - 30 * 86_400_000);
		const result = computeDeterministicPrediction({ ...baseInputs, lastSampleAt: sample }, now);
		expect(result.confidence).toBe("medium");
	});

	it("low confidence when sample is older than 42 days", () => {
		const now = new Date();
		const sample = new Date(now.getTime() - 50 * 86_400_000);
		const result = computeDeterministicPrediction({ ...baseInputs, lastSampleAt: sample }, now);
		expect(result.confidence).toBe("low");
	});

	it("medium confidence when FCR missing and sample fresh", () => {
		// Fresh sample alone gets medium; high requires FCR too.
		const now = new Date();
		const result = computeDeterministicPrediction(
			{ ...baseInputs, latestFcr: null, lastSampleAt: now },
			now,
		);
		expect(result.confidence).toBe("medium");
	});

	it("result stays within ±50% of current grams when current is set", () => {
		const result = computeDeterministicPrediction(baseInputs);
		const current = baseInputs.currentGrams as number;
		expect(result.grams).not.toBeNull();
		expect(result.grams).not.toBeLessThan(current * 0.5 - 0.1);
		expect(result.grams).not.toBeGreaterThan(current * 1.5 + 0.1);
	});

	it("includes current device value in reasoning", () => {
		const result = computeDeterministicPrediction(baseInputs);
		expect(result.reasoning).toContain("140g");
	});
});
