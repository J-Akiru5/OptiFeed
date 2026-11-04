import {
	type CompletedCycleForSuggestion,
	buildGrowthHistorySuggestions,
	deriveGrowthHistorySample,
} from "@/lib/growth/history";
import { describe, expect, it } from "vitest";

/**
 * #828 acceptance: a suggestion comes from recorded actuals, carries its
 * sample size and range, and is absent when there is no usable history. A
 * cycle with no prior history must never produce an invented number.
 */

const cycles: CompletedCycleForSuggestion[] = [
	{
		id: "cycle-newest",
		label: "Cycle 2026-09",
		pondName: "Pond A",
		stockingDate: "2026-09-01",
		stockingCount: 1000,
		actualHarvestDate: "2027-01-05",
		actualHarvestWeightKg: 210,
		actualHarvestCount: 820,
	},
	{
		id: "cycle-middle",
		label: "Cycle 2026-04",
		pondName: "Pond A",
		stockingDate: "2026-04-01",
		stockingCount: 1000,
		actualHarvestDate: "2026-08-10",
		actualHarvestWeightKg: 225,
		actualHarvestCount: 900,
	},
	{
		id: "cycle-oldest",
		label: null,
		pondName: "Pond B",
		stockingDate: "2026-01-01",
		stockingCount: 500,
		actualHarvestDate: "2026-05-11",
		actualHarvestWeightKg: 110,
		actualHarvestCount: 440,
	},
];

function byField(field: string) {
	return buildGrowthHistorySuggestions(cycles).find((entry) => entry.field === field);
}

describe("growth history suggestions (#828)", () => {
	it("suggests the newest outcome with the sample size and range", () => {
		const survival = byField("expectedSurvivalPct");
		expect(survival).toMatchObject({
			value: 82,
			sampleSize: 3,
			min: 82,
			max: 90,
			sourceCycleId: "cycle-newest",
			sourceLabel: "Cycle 2026-09",
			sourcePondName: "Pond A",
			sourceHarvestDate: "2027-01-05",
		});

		const target = byField("targetHarvestWeightG");
		expect(target).toMatchObject({ value: 256.1, sampleSize: 3, min: 250, max: 256.1 });

		const days = byField("growOutDays");
		expect(days).toMatchObject({ value: 126, sampleSize: 3, min: 126, max: 131 });
	});

	it("derives survival from the harvested count, not the expected value", () => {
		const sample = deriveGrowthHistorySample(cycles[0]);
		expect(sample.expectedSurvivalPct).toBe(82);
		expect(sample.targetHarvestWeightG).toBe(256.1);
		expect(sample.growOutDays).toBe(126);
	});

	it("returns no suggestion when there is no completed history", () => {
		expect(buildGrowthHistorySuggestions([])).toEqual([]);
	});

	it("skips a field with no usable actual instead of inventing one", () => {
		const noActuals = buildGrowthHistorySuggestions([
			{
				...cycles[0],
				actualHarvestWeightKg: null,
				actualHarvestCount: null,
			},
		]);

		expect(noActuals.map((entry) => entry.field)).toEqual(["growOutDays"]);
		expect(noActuals[0].value).toBe(126);
	});

	it("ignores a survival above 100 % and an out-of-rail grow-out period", () => {
		const suggestions = buildGrowthHistorySuggestions([
			{
				...cycles[0],
				stockingCount: 100,
				actualHarvestCount: 120,
				stockingDate: "2026-12-26",
				actualHarvestDate: "2027-01-05",
			},
		]);

		expect(suggestions.map((entry) => entry.field)).toEqual(["targetHarvestWeightG"]);
	});

	it("deduplicates a cycle that appears twice", () => {
		const survival = buildGrowthHistorySuggestions([cycles[0], cycles[0]]).find(
			(entry) => entry.field === "expectedSurvivalPct",
		);
		expect(survival?.sampleSize).toBe(1);
	});
});
