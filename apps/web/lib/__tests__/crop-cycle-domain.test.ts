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
	FARM_TIME_ZONE,
	addDays,
	dateOnlyEventStart,
	dateOnlyToUtcDate,
	dateRangeUtc,
	daysBetween,
	formatDateOnly,
	isValidDateOnly,
	parseDateOnly,
	todayDateOnly,
	utcDateToDateOnly,
} from "../crop-cycle/dates";
import { computeCropCycleMetrics, computeFinalFcr } from "../crop-cycle/metrics";
import {
	type CycleForPrediction,
	toPredictionCycleContext,
} from "../crop-cycle/prediction-context";
import {
	type PredictionCycleContext,
	type PredictionInputs,
	clearPredictionAiCache,
	computeDeterministicPrediction,
	refinePredictionWithAi,
} from "../prediction";

describe("date-only helpers", () => {
	it("uses the farm timezone instead of the process timezone", () => {
		expect(FARM_TIME_ZONE).toBe("Asia/Manila");
		// Manila is UTC+8: 16:00 UTC is already the next calendar day there.
		expect(todayDateOnly(new Date("2026-10-24T15:59:59.999Z"))).toBe("2026-10-24");
		expect(todayDateOnly(new Date("2026-10-24T16:00:00.000Z"))).toBe("2026-10-25");
		expect(todayDateOnly(new Date("2026-12-31T16:00:00.000Z"))).toBe("2027-01-01");
	});

	it("validates strict YYYY-MM-DD calendar dates", () => {
		expect(isValidDateOnly("2026-10-24")).toBe(true);
		expect(isValidDateOnly("2028-02-29")).toBe(true);
		expect(isValidDateOnly("2026-02-29")).toBe(false);
		expect(isValidDateOnly("2026-02-30")).toBe(false);
		expect(isValidDateOnly("2026-13-01")).toBe(false);
		expect(isValidDateOnly("2026-1-1")).toBe(false);
		expect(isValidDateOnly("24-10-2026")).toBe(false);
		expect(isValidDateOnly("not-a-date")).toBe(false);
		expect(isValidDateOnly(null)).toBe(false);
		expect(isValidDateOnly(20261024)).toBe(false);
	});

	it("parses a date-only value without a time component", () => {
		const parsed = parseDateOnly("2026-10-24");
		expect(parsed.toString()).toBe("2026-10-24");
		expect(parsed.year).toBe(2026);
		expect(parsed.month).toBe(10);
		expect(parsed.day).toBe(24);
	});

	it("adds and subtracts calendar days across boundaries", () => {
		expect(addDays("2026-10-24", 0)).toBe("2026-10-24");
		expect(addDays("2026-10-24", 10)).toBe("2026-11-03");
		expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
		expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
		expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
		expect(addDays("2026-01-01", -1)).toBe("2025-12-31");
	});

	it("counts whole calendar days in both directions", () => {
		expect(daysBetween("2026-10-24", "2026-10-24")).toBe(0);
		expect(daysBetween("2026-10-24", "2026-11-03")).toBe(10);
		expect(daysBetween("2026-11-03", "2026-10-24")).toBe(-10);
		expect(daysBetween("2028-02-28", "2028-03-01")).toBe(2);
		expect(daysBetween("2026-10-24", "2027-10-24")).toBe(365);
	});

	it("converts date-only values to UTC midnight for @db.Date", () => {
		const date = dateOnlyToUtcDate("2026-10-24");
		expect(date.toISOString()).toBe("2026-10-24T00:00:00.000Z");
		expect(date.getUTCHours()).toBe(0);
		expect(date.getUTCMinutes()).toBe(0);
	});

	it("converts a @db.Date value back without timezone drift", () => {
		expect(utcDateToDateOnly(new Date("2026-10-24T00:00:00.000Z"))).toBe("2026-10-24");
		expect(utcDateToDateOnly(new Date("2027-01-01T00:00:00.000Z"))).toBe("2027-01-01");
	});

	it("formats dates and datetime strings to a date-only value", () => {
		expect(formatDateOnly(new Date("2026-10-24T00:00:00.000Z"))).toBe("2026-10-24");
		expect(formatDateOnly("2026-10-24")).toBe("2026-10-24");
		expect(formatDateOnly("2026-10-24T15:30:00.000Z")).toBe("2026-10-24");
		expect(dateOnlyEventStart(new Date("2026-10-24T00:00:00.000Z"))).toBe("2026-10-24");
	});

	it("builds half-open UTC bounds for a date-only range", () => {
		const range = dateRangeUtc("2026-10-01", "2026-10-31");
		expect(range.gte.toISOString()).toBe("2026-10-01T00:00:00.000Z");
		// The upper bound is the next day's midnight so `lt` includes `to`.
		expect(range.lte.toISOString()).toBe("2026-11-01T00:00:00.000Z");
	});
});

describe("computeCropCycleMetrics", () => {
	const cycle = {
		stockingDate: "2026-10-01",
		growOutDays: 135,
		targetHarvestDate: "2027-02-13",
		stockingCount: 1000,
		targetHarvestWeightG: 250,
		expectedSurvivalPct: 85,
	};

	it("derives day, countdown, progress and stage for an early cycle", () => {
		const metrics = computeCropCycleMetrics(cycle, "2026-10-24");
		expect(metrics.growOutDay).toBe(24);
		expect(metrics.daysToHarvest).toBe(112);
		expect(metrics.progressPct).toBeCloseTo((23 / 135) * 100, 6);
		expect(metrics.stage).toBe("early");
		expect(metrics.projectedHarvestBiomassKg).toBe(212.5);
	});

	it("never reports a day before day 1 when the stocking date is future", () => {
		const metrics = computeCropCycleMetrics(cycle, "2026-09-25");
		expect(metrics.growOutDay).toBe(1);
		expect(metrics.progressPct).toBe(0);
		expect(metrics.daysToHarvest).toBe(141);
		expect(metrics.stage).toBe("early");
	});

	it("moves from early to grow after 30 elapsed days", () => {
		const fixture = {
			stockingDate: "2026-01-01",
			growOutDays: 180,
			targetHarvestDate: "2026-06-30",
			stockingCount: 100,
			targetHarvestWeightG: 250,
		};
		expect(computeCropCycleMetrics(fixture, "2026-01-31").stage).toBe("early");
		const grow = computeCropCycleMetrics(fixture, "2026-02-01");
		expect(grow.stage).toBe("grow");
		expect(grow.growOutDay).toBe(32);
	});

	it("classifies finish at 14 days out and grow at 15", () => {
		const fixture = {
			stockingDate: "2026-01-01",
			growOutDays: 120,
			targetHarvestDate: "2026-05-01",
			stockingCount: 100,
			targetHarvestWeightG: 250,
		};
		expect(computeCropCycleMetrics(fixture, "2026-04-17").daysToHarvest).toBe(14);
		expect(computeCropCycleMetrics(fixture, "2026-04-17").stage).toBe("finish");
		expect(computeCropCycleMetrics(fixture, "2026-04-16").daysToHarvest).toBe(15);
		expect(computeCropCycleMetrics(fixture, "2026-04-16").stage).toBe("grow");
	});

	it("treats the target day as finish, not overdue", () => {
		const metrics = computeCropCycleMetrics(
			{
				stockingDate: "2026-01-01",
				growOutDays: 120,
				targetHarvestDate: "2026-05-01",
				stockingCount: 100,
			},
			"2026-05-01",
		);
		expect(metrics.daysToHarvest).toBe(0);
		expect(metrics.stage).toBe("finish");
		expect(metrics.growOutDay).toBe(120);
		expect(metrics.progressPct).toBe(100);
	});

	it("caps grow-out day and progress once the target date passes", () => {
		const metrics = computeCropCycleMetrics(
			{
				stockingDate: "2026-01-01",
				growOutDays: 120,
				targetHarvestDate: "2026-05-01",
				stockingCount: 100,
			},
			"2026-05-08",
		);
		expect(metrics.daysToHarvest).toBe(-7);
		expect(metrics.stage).toBe("overdue");
		expect(metrics.growOutDay).toBe(120);
		expect(metrics.progressPct).toBe(100);
	});

	it("accepts Date objects from Prisma @db.Date columns", () => {
		const metrics = computeCropCycleMetrics(
			{
				stockingDate: new Date("2026-10-01T00:00:00.000Z"),
				growOutDays: 135,
				targetHarvestDate: new Date("2027-02-13T00:00:00.000Z"),
				stockingCount: 1000,
				targetHarvestWeightG: 250,
				expectedSurvivalPct: 85,
			},
			"2026-10-24",
		);
		expect(metrics).toEqual(computeCropCycleMetrics(cycle, "2026-10-24"));
	});

	it("defaults missing survival to 100% and rounds projected biomass", () => {
		const metrics = computeCropCycleMetrics(
			{
				stockingDate: "2026-10-01",
				growOutDays: 135,
				targetHarvestDate: "2027-02-13",
				stockingCount: 1000,
				targetHarvestWeightG: 250,
			},
			"2026-10-24",
		);
		expect(metrics.projectedHarvestBiomassKg).toBe(250);

		const rounded = computeCropCycleMetrics(
			{
				stockingDate: "2026-10-01",
				growOutDays: 135,
				targetHarvestDate: "2027-02-13",
				stockingCount: 333,
				targetHarvestWeightG: 250,
				expectedSurvivalPct: 85,
			},
			"2026-10-24",
		);
		expect(rounded.projectedHarvestBiomassKg).toBe(70.76);
	});

	it("returns no projected biomass without a positive target weight", () => {
		const missing = computeCropCycleMetrics({ ...cycle, targetHarvestWeightG: null }, "2026-10-24");
		expect(missing.projectedHarvestBiomassKg).toBeNull();

		const zero = computeCropCycleMetrics({ ...cycle, targetHarvestWeightG: 0 }, "2026-10-24");
		expect(zero.projectedHarvestBiomassKg).toBeNull();
	});

	it("clamps a non-positive grow-out period to one day", () => {
		const metrics = computeCropCycleMetrics({ ...cycle, growOutDays: 0 }, "2026-10-24");
		expect(metrics.growOutDay).toBe(1);
		expect(metrics.progressPct).toBe(100);
	});
});

describe("computeFinalFcr", () => {
	it("computes feed divided by harvested gain", () => {
		expect(
			computeFinalFcr({
				totalFeedKg: 100,
				harvestWeightKg: 150,
				stockingCount: 1000,
				stockingAvgWeightG: 50,
			}),
		).toBe(1);
	});

	it("rounds to two decimals", () => {
		expect(
			computeFinalFcr({
				totalFeedKg: 100,
				harvestWeightKg: 120,
				stockingCount: 1000,
				stockingAvgWeightG: 50,
			}),
		).toBe(1.43);
	});

	it("returns null when the stocking weight is missing or invalid", () => {
		const base = { totalFeedKg: 100, harvestWeightKg: 150, stockingCount: 1000 };
		expect(computeFinalFcr({ ...base, stockingAvgWeightG: null })).toBeNull();
		expect(computeFinalFcr({ ...base, stockingAvgWeightG: 0 })).toBeNull();
		expect(computeFinalFcr({ ...base, stockingAvgWeightG: -10 })).toBeNull();
	});

	it("returns null when the harvested gain is not positive", () => {
		const base = { totalFeedKg: 100, harvestWeightKg: 50, stockingCount: 1000 };
		expect(computeFinalFcr({ ...base, stockingAvgWeightG: 50 })).toBeNull();
		expect(
			computeFinalFcr({
				totalFeedKg: 100,
				harvestWeightKg: 40,
				stockingCount: 1000,
				stockingAvgWeightG: 50,
			}),
		).toBeNull();
	});

	it("returns null when feed or harvest weight is zero, negative or non-finite", () => {
		const base = { totalFeedKg: 100, harvestWeightKg: 150, stockingCount: 1000 };
		expect(computeFinalFcr({ ...base, totalFeedKg: 0, stockingAvgWeightG: 50 })).toBeNull();
		expect(computeFinalFcr({ ...base, totalFeedKg: -10, stockingAvgWeightG: 50 })).toBeNull();
		expect(computeFinalFcr({ ...base, harvestWeightKg: 0, stockingAvgWeightG: 50 })).toBeNull();
		expect(computeFinalFcr({ ...base, harvestWeightKg: -1, stockingAvgWeightG: 50 })).toBeNull();
		expect(
			computeFinalFcr({
				...base,
				totalFeedKg: Number.NaN,
				stockingAvgWeightG: 50,
			}),
		).toBeNull();
		expect(
			computeFinalFcr({
				...base,
				harvestWeightKg: Number.POSITIVE_INFINITY,
				stockingAvgWeightG: 50,
			}),
		).toBeNull();
	});
});

describe("toPredictionCycleContext", () => {
	const cycle: CycleForPrediction = {
		id: "cycle-1",
		label: "Batch 2026-10",
		stockingDate: new Date("2026-10-01T00:00:00.000Z"),
		stockingCount: 1000,
		growOutDays: 135,
		targetHarvestDate: new Date("2027-02-13T00:00:00.000Z"),
		targetHarvestWeightG: 250,
		expectedSurvivalPct: 85,
	};

	it("maps a cycle row to the shared AI context shape", () => {
		expect(toPredictionCycleContext(cycle, "2026-10-24")).toEqual({
			cycleId: "cycle-1",
			label: "Batch 2026-10",
			growOutDay: 24,
			growOutDays: 135,
			daysToHarvest: 112,
			targetHarvestDate: "2027-02-13",
			targetHarvestWeightG: 250,
			projectedHarvestBiomassKg: 212.5,
			stage: "early",
		});
	});

	it("keeps a null label and defaults projected biomass to full survival", () => {
		const context = toPredictionCycleContext(
			{ ...cycle, label: null, expectedSurvivalPct: null },
			"2026-10-24",
		);
		expect(context.label).toBeNull();
		expect(context.projectedHarvestBiomassKg).toBe(250);
	});

	it("classifies an overdue cycle for the advisor", () => {
		const context = toPredictionCycleContext(cycle, "2027-02-20");
		expect(context.stage).toBe("overdue");
		expect(context.daysToHarvest).toBe(-7);
	});
});

describe("prediction cycle context", () => {
	const now = new Date("2026-10-24T12:00:00.000Z");
	const cycle = {
		id: "cycle-1",
		label: "Batch 2026-10",
		stockingDate: "2026-10-01",
		stockingCount: 1000,
		growOutDays: 135,
		targetHarvestDate: "2027-02-13",
		targetHarvestWeightG: 250,
		expectedSurvivalPct: 85,
	};
	const context = toPredictionCycleContext(cycle, "2026-10-24");

	function inputs(overrides: Partial<PredictionInputs> = {}): PredictionInputs {
		return {
			feedingRatePct: 5,
			feedsPerDay: 3,
			population: 1000,
			avgWeightKg: 0.25,
			latestFcr: 1.5,
			currentGrams: 140,
			hopperCapacityG: 22_190,
			lastSampleAt: new Date(now.getTime() - 5 * 86_400_000),
			cycle: context,
			...overrides,
		};
	}

	beforeEach(() => {
		aiMocks.completeAi.mockReset();
		aiMocks.isAiEnabled.mockReset();
		clearPredictionAiCache();
	});

	it("returns the cycle on the prediction and in the reasoning", () => {
		const result = computeDeterministicPrediction(inputs(), now);
		expect(result.cycle).toEqual(context);
		expect(result.reasoning).toContain("Grow-out day 24 of 135; harvest in 112 days");
		expect(result.reasoning).toContain("at a 250g target");
	});

	it("warns about an overdue cycle rather than a countdown", () => {
		const overdue: PredictionCycleContext = {
			...context,
			daysToHarvest: -3,
			stage: "overdue",
		};
		const result = computeDeterministicPrediction(inputs({ cycle: overdue }), now);
		expect(result.cycle).toEqual(overdue);
		expect(result.reasoning).toContain("3 days past its target harvest date");
		expect(result.reasoning).toContain("verify the harvest plan");
	});

	it("omits the target weight note when no target is set", () => {
		const noTarget: PredictionCycleContext = { ...context, targetHarvestWeightG: null };
		const result = computeDeterministicPrediction(inputs({ cycle: noTarget }), now);
		expect(result.reasoning).toContain("harvest in 112 days.");
		expect(result.reasoning).not.toContain("target");
	});

	it("returns no grams with a fallow reason and no cycle", () => {
		const result = computeDeterministicPrediction(inputs({ isFallow: true }), now);
		expect(result.grams).toBeNull();
		expect(result.confidence).toBe("low");
		expect(result.confidenceReasons).toEqual(["fallow"]);
		expect(result.cycle).toBeNull();
		expect(result.reasoning).toContain("fallow");
	});

	it("preserves the cycle on a no-data result", () => {
		const result = computeDeterministicPrediction(inputs({ avgWeightKg: null }), now);
		expect(result.grams).toBeNull();
		expect(result.confidenceReasons).toEqual(["noData"]);
		expect(result.cycle).toEqual(context);
	});

	it("keeps the cycle when the AI refinement succeeds and prompts with cycle fields", async () => {
		aiMocks.isAiEnabled.mockResolvedValue(true);
		aiMocks.completeAi.mockResolvedValue({
			content: JSON.stringify({
				grams: 140,
				confidence: "medium",
				reasoning: "Hold the current rate until harvest.",
			}),
		});
		const baseline = computeDeterministicPrediction(inputs(), now);
		const result = await refinePredictionWithAi(inputs(), baseline);

		expect(result.source).toBe("ai");
		expect(result.cycle).toEqual(context);
		// The deterministic baseline is clamped to 210g (current 140g + 50%),
		// so the AI may only refine within its ±20% band: 168g floor.
		expect(result.grams).toBe(168);

		const [messages] = aiMocks.completeAi.mock.calls[0] as [Array<{ text: string }>];
		const prompt = messages[0].text;
		expect(prompt).toContain('"daysToHarvest": 112');
		expect(prompt).toContain('"targetHarvestWeightG": 250');
		expect(prompt).toContain('"growOutDay": 24');
		expect(prompt).toContain("CYCLE CONTEXT");
	});

	it("keeps a fallow baseline without calling the provider", async () => {
		aiMocks.isAiEnabled.mockResolvedValue(true);
		const baseline = computeDeterministicPrediction(inputs({ isFallow: true }), now);
		const result = await refinePredictionWithAi(inputs({ isFallow: true }), baseline);
		expect(result).toBe(baseline);
		expect(aiMocks.completeAi).not.toHaveBeenCalled();
	});
});
