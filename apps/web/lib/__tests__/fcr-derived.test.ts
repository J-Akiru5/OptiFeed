import { computeFcr } from "@/lib/analytics/fcr";
import { describe, expect, it } from "vitest";

/**
 * Fixed data set for the in-app FCR (issue #453), tilapia-realistic units
 * (BiomassLog.avgWeightKg is kilograms per fish, FeedEvent grams are feed):
 *
 * Pond cycle: 300 fish stocked at 2 g average (0.002 kg/fish)
 * Mortality:  15 fish logged → live = 285 (derived live count, issue #452)
 * First sampling: 0.002 kg × 300 stocked =   0.6 kg biomass
 * Last sampling:  0.250 kg × 285 live   = 71.25 kg biomass
 * Biomass gain:   71.25 − 0.6           = 70.65 kg
 * Feed given:     70.65 kg × FCR 1.5    = 105.975 kg
 * Expectation:    105.975 / 70.65       = 1.5 exactly
 */

const EXPECT = {
	gainKg: 70.65,
	fcr: 1.5,
};

const FIRST = { avgWeightKg: 0.002, count: 300 };
const LAST = { avgWeightKg: 0.25, count: 285 };

describe("computeFcr (fixed data set)", () => {
	it("returns the hand-computed FCR for the fixed cycle", () => {
		const result = computeFcr(105.975, FIRST, LAST);
		expect(result.feedGivenKg).toBeCloseTo(105.975, 10);
		expect(result.biomassGainKg).toBeCloseTo(EXPECT.gainKg, 10);
		expect(result.fcr).toBeCloseTo(EXPECT.fcr, 10);
	});

	it("is not computable when a side is missing, instead of dividing by nothing", () => {
		expect(computeFcr(105.975, null, LAST).fcr).toBeNull();
		expect(computeFcr(105.975, FIRST, null).fcr).toBeNull();
	});

	it("counts flat biomass as no gain and reports no ratio", () => {
		const result = computeFcr(105.975, LAST, LAST);
		expect(result.biomassGainKg).toBe(0);
		expect(result.fcr).toBeNull();
	});

	it("never produces a negative gain when the pond shrank (mortality on top)", () => {
		const result = computeFcr(105.975, { avgWeightKg: 0.25, count: 300 }, LAST);
		expect(result.biomassGainKg).toBe(0);
		expect(result.fcr).toBeNull();
	});

	it("treats negative feed input as nothing given", () => {
		const result = computeFcr(-5, FIRST, LAST);
		expect(result.feedGivenKg).toBe(0);
		expect(result.fcr).toBeCloseTo(0, 10);
	});
});
