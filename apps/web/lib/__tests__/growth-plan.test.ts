import { describe, expect, it } from "vitest";
import { type GrowthPlanInput, buildGrowthPlan } from "../growth-plan";

const cycle = {
	id: "cycle-1",
	label: "Batch 2026-A",
	stockingDate: "2026-01-01",
	stockingCount: 1000,
	stockingAvgWeightG: 10,
	growOutDays: 120,
	targetHarvestDate: "2026-05-01",
	targetHarvestWeightG: 330,
	expectedSurvivalPct: 90,
};

function input(overrides: Partial<GrowthPlanInput> = {}): GrowthPlanInput {
	return {
		cycle,
		latestSample: {
			id: "sample-2",
			date: "2026-03-02",
			avgWeightG: 120,
			sampleCount: 30,
		},
		previousSample: {
			id: "sample-1",
			date: "2026-02-01",
			avgWeightG: 100,
			sampleCount: 30,
		},
		population: 1000,
		feedingRatePct: 3,
		feedsPerDay: 3,
		currentGramsPerFeeding: 1000,
		deviceMaxGramsPerFeeding: 1000,
		latestFcr: 1.5,
		lastAdjustmentAt: null,
		today: "2026-03-02",
		pond: { areaM2: 100, averageDepthM: 1.5, feedPricePerKg: 30 },
		...overrides,
	};
}

describe("buildGrowthPlan", () => {
	it("returns a no-cycle plan when there is no active cycle", () => {
		const plan = buildGrowthPlan(input({ cycle: null }));
		expect(plan.status).toBe("noCycle");
		expect(plan.targetWeightG).toBeNull();
	});

	it("returns no-target when the cycle has no target weight", () => {
		const plan = buildGrowthPlan(input({ cycle: { ...cycle, targetHarvestWeightG: null } }));
		expect(plan.status).toBe("noTarget");
		expect(plan.adjustmentBlock).toBe("noTarget");
	});

	it("computes the target gap, feed budget, density and device capacity", () => {
		const plan = buildGrowthPlan(input());

		expect(plan.status).toBe("ok");
		expect(plan.growOutDay).toBe(61);
		expect(plan.daysToHarvest).toBe(60);
		expect(plan.expectedWeightG).toBe(170);
		expect(plan.track).toBe("behind");
		expect(plan.trackDeltaG).toBe(-50);
		expect(plan.requiredDailyGainG).toBe(3.5);
		expect(plan.requiredDailyFeedKg).toBe(4.73);
		expect(plan.requiredFeedingRatePct).toBe(4.38);
		expect(plan.recommendedGramsPerFeeding).toBe(1575);
		expect(plan.feed.remainingFeedKg).toBe(283.5);
		expect(plan.feed.totalCycleFeedKg).toBe(432);
		expect(plan.feed.estimatedRemainingCost).toBe(8505);
		expect(plan.feed.estimatedCostPerFish).toBe(9.45);
		expect(plan.density.fishPerM2).toBe(10);
		expect(plan.density.fishPerM3).toBe(6.7);
		expect(plan.density.advisory).toBe("ok");
		expect(plan.device.feasible).toBe(false);
		expect(plan.device.deficitGrams).toBe(575);
		expect(plan.device.extraMealsNeeded).toBe(2);
		expect(plan.adjustmentBlock).toBe("deviceCap");
		expect(plan.confidence).toBe("high");
		expect(plan.hasPriorAdjustment).toBe(false);
	});

	it("caps an allowed adjustment at 10% of the current device value", () => {
		const plan = buildGrowthPlan(
			input({
				latestSample: {
					id: "sample-2",
					date: "2026-03-02",
					avgWeightG: 170,
					sampleCount: 30,
				},
				previousSample: null,
				currentGramsPerFeeding: 1000,
				deviceMaxGramsPerFeeding: 5000,
				lastAdjustmentAt: "2026-02-10",
			}),
		);

		expect(plan.recommendedGramsPerFeeding).toBe(1200);
		expect(plan.applicableGramsPerFeeding).toBe(1100);
		expect(plan.adjustmentPct).toBe(10);
		expect(plan.adjustmentAllowed).toBe(true);
		expect(plan.nextAdjustmentDate).toBe("2026-02-25");
		expect(plan.hasPriorAdjustment).toBe(true);
	});

	it("blocks an adjustment until 15 days after the last one", () => {
		const plan = buildGrowthPlan(
			input({
				latestSample: {
					id: "sample-2",
					date: "2026-03-02",
					avgWeightG: 170,
					sampleCount: 30,
				},
				previousSample: null,
				currentGramsPerFeeding: 1000,
				deviceMaxGramsPerFeeding: 5000,
				lastAdjustmentAt: "2026-02-25",
			}),
		);

		expect(plan.adjustmentAllowed).toBe(false);
		expect(plan.adjustmentBlock).toBe("adjustmentWindow");
		expect(plan.nextAdjustmentDate).toBe("2026-03-12");
		expect(plan.applicableGramsPerFeeding).toBe(1100);
	});

	it("marks a cycle that is ahead of the straight-line target", () => {
		const plan = buildGrowthPlan(
			input({
				latestSample: {
					id: "sample-2",
					date: "2026-03-02",
					avgWeightG: 180,
					sampleCount: 30,
				},
			}),
		);

		expect(plan.track).toBe("ahead");
		expect(plan.trackDeltaPct).toBeGreaterThan(3);
	});

	it("treats a small gap as on track", () => {
		const plan = buildGrowthPlan(
			input({
				latestSample: {
					id: "sample-2",
					date: "2026-03-02",
					avgWeightG: 165,
					sampleCount: 30,
				},
			}),
		);

		expect(plan.track).toBe("onTrack");
	});

	it("projects harvest weight from the observed daily gain", () => {
		const plan = buildGrowthPlan(input());
		// 100g -> 120g over 29 days = 0.6897 g/day; 60 days left.
		expect(plan.projectedHarvestWeightG).toBe(161.4);
	});

	it("does not recommend growth feed once the target is reached", () => {
		const plan = buildGrowthPlan(
			input({
				latestSample: {
					id: "sample-2",
					date: "2026-03-02",
					avgWeightG: 340,
					sampleCount: 30,
				},
			}),
		);

		expect(plan.recommendedGramsPerFeeding).toBeNull();
		expect(plan.requiredDailyFeedKg).toBeNull();
		expect(plan.adjustmentAllowed).toBe(false);
		expect(plan.adjustmentBlock).toBe("noTarget");
		expect(plan.notes).toContain("Target weight reached or exceeded.");
	});

	it("starts from the stocking weight before the first sample", () => {
		const plan = buildGrowthPlan(input({ latestSample: null, previousSample: null }));

		expect(plan.currentWeightG).toBe(10);
		expect(plan.adjustmentBlock).toBe("noSample");
		expect(plan.confidence).toBe("low");
	});

	it("allows the first adjustment when a feeder is linked but has no grams yet", () => {
		const plan = buildGrowthPlan(
			input({
				latestSample: {
					id: "sample-2",
					date: "2026-03-02",
					avgWeightG: 170,
					sampleCount: 30,
				},
				previousSample: null,
				currentGramsPerFeeding: null,
				hasDevice: true,
				deviceMaxGramsPerFeeding: 5000,
			}),
		);

		expect(plan.adjustmentAllowed).toBe(true);
		expect(plan.applicableGramsPerFeeding).toBe(1200);
	});

	it("blocks the adjustment when no feeder is linked", () => {
		const plan = buildGrowthPlan(
			input({
				currentGramsPerFeeding: null,
				hasDevice: false,
			}),
		);

		expect(plan.adjustmentAllowed).toBe(false);
		expect(plan.adjustmentBlock).toBe("noDevice");
	});

	it("flags missing pond area as unknown density", () => {
		const plan = buildGrowthPlan(
			input({ pond: { areaM2: null, averageDepthM: null, feedPricePerKg: null } }),
		);

		expect(plan.density.advisory).toBe("unknown");
		expect(plan.density.fishPerM2).toBeNull();
		expect(plan.notes.join(" ")).toContain("Add pond area");
	});
});

describe("buildGrowthPlan biomass target", () => {
	it("reports target, current, expected and projected biomass with the gap", () => {
		const plan = buildGrowthPlan(input());

		expect(plan.targetSource).toBe("cycle");
		// 330 g x 1,000 fish x 90% survival.
		expect(plan.targetBiomassKg).toBe(297);
		expect(plan.currentBiomassKg).toBe(108);
		expect(plan.expectedBiomassKg).toBe(153);
		expect(plan.projectedBiomassKg).toBe(145.26);
		expect(plan.biomassGapKg).toBe(189);
		expect(plan.projectedBiomassGapKg).toBe(151.74);
	});

	it("uses a saved calculator target instead of the cycle target", () => {
		const plan = buildGrowthPlan(
			input({
				savedTarget: { targetWeightG: 400, cycleId: "cycle-1", population: 1000 },
			}),
		);

		expect(plan.status).toBe("ok");
		expect(plan.targetSource).toBe("saved");
		expect(plan.targetWeightG).toBe(400);
		// The target is a weight goal at the cycle's harvest, so the date is kept.
		expect(plan.targetDate).toBe("2026-05-01");
		expect(plan.targetBiomassKg).toBe(360);
		expect(plan.currentBiomassKg).toBe(108);
		expect(plan.biomassGapKg).toBe(252);
		expect(plan.expectedBiomassKg).toBe(184.5);
		expect(plan.projectedBiomassGapKg).toBe(214.74);
	});

	it("derives the feed recommendation from the saved target", () => {
		const plan = buildGrowthPlan(
			input({
				savedTarget: { targetWeightG: 400, cycleId: "cycle-1", population: 1000 },
			}),
		);

		// 280 g gap x 1,000 fish x 90% survival x FCR 1.5 over 60 days.
		expect(plan.requiredDailyGainG).toBe(4.7);
		expect(plan.requiredDailyFeedKg).toBe(6.3);
		expect(plan.requiredFeedingRatePct).toBe(5.83);
		expect(plan.recommendedGramsPerFeeding).toBe(2100);
		// 2,100 g/meal is above the 1,000 g device limit, so the plan blocks.
		expect(plan.adjustmentBlock).toBe("deviceCap");
		expect(plan.adjustmentAllowed).toBe(false);
	});

	it("keeps the 10% envelope around a recommendation driven by the saved target", () => {
		const plan = buildGrowthPlan(
			input({
				latestSample: {
					id: "sample-2",
					date: "2026-03-02",
					avgWeightG: 170,
					sampleCount: 30,
				},
				previousSample: null,
				deviceMaxGramsPerFeeding: 5000,
				savedTarget: { targetWeightG: 400, cycleId: "cycle-1", population: 1000 },
			}),
		);

		expect(plan.recommendedGramsPerFeeding).toBe(1725);
		expect(plan.applicableGramsPerFeeding).toBe(1100);
		expect(plan.adjustmentPct).toBe(10);
		expect(plan.adjustmentAllowed).toBe(true);
	});

	it("still blocks a saved-target adjustment inside the 15-day window", () => {
		const plan = buildGrowthPlan(
			input({
				latestSample: {
					id: "sample-2",
					date: "2026-03-02",
					avgWeightG: 170,
					sampleCount: 30,
				},
				previousSample: null,
				deviceMaxGramsPerFeeding: 5000,
				lastAdjustmentAt: "2026-02-25",
				savedTarget: { targetWeightG: 400, cycleId: "cycle-1", population: 1000 },
			}),
		);

		expect(plan.adjustmentAllowed).toBe(false);
		expect(plan.adjustmentBlock).toBe("adjustmentWindow");
		expect(plan.nextAdjustmentDate).toBe("2026-03-12");
	});

	it("ignores a saved target that belongs to a different cycle", () => {
		const plan = buildGrowthPlan(
			input({
				savedTarget: { targetWeightG: 400, cycleId: "cycle-old", population: 1000 },
			}),
		);

		expect(plan.targetSource).toBe("cycle");
		expect(plan.targetWeightG).toBe(330);
		expect(plan.targetBiomassKg).toBe(297);
	});

	it("activates a cycle that has no target when a saved target exists", () => {
		const plan = buildGrowthPlan(
			input({
				cycle: { ...cycle, targetHarvestWeightG: null },
				savedTarget: { targetWeightG: 350, cycleId: "cycle-1", population: 1000 },
			}),
		);

		expect(plan.status).toBe("ok");
		expect(plan.targetSource).toBe("saved");
		expect(plan.targetWeightG).toBe(350);
	});

	it("falls back to the saved population when the pond count is missing", () => {
		const plan = buildGrowthPlan(
			input({
				population: null,
				savedTarget: { targetWeightG: 400, cycleId: "cycle-1", population: 500 },
			}),
		);

		expect(plan.targetBiomassKg).toBe(180);
		expect(plan.currentBiomassKg).toBe(54);
		expect(plan.biomassGapKg).toBe(126);
	});

	it("ignores an invalid saved target", () => {
		const plan = buildGrowthPlan(
			input({
				savedTarget: { targetWeightG: 0, cycleId: "cycle-1", population: 1000 },
			}),
		);

		expect(plan.targetSource).toBe("cycle");
		expect(plan.targetWeightG).toBe(330);
	});

	it("has no target source when neither the cycle nor the calculator sets one", () => {
		const plan = buildGrowthPlan(
			input({ cycle: { ...cycle, targetHarvestWeightG: null }, savedTarget: null }),
		);

		expect(plan.status).toBe("noTarget");
		expect(plan.targetSource).toBeNull();
		expect(plan.targetBiomassKg).toBeNull();
	});
});
