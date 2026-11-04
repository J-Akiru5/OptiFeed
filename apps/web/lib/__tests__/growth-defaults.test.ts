import {
	SYSTEM_GROWTH_DEFAULTS,
	resolveGrowthDefaults,
	sanitizeGrowthDefaults,
} from "@/lib/growth/defaults";
import { describe, expect, it } from "vitest";

/**
 * #828 acceptance: resolution order is pond override → farm default →
 * documented constant, and a malformed stored value must never invent a
 * number. These are pure tests of the same helper the loader, the cycle form
 * and the two settings surfaces use.
 */

const farm = {
	growOutDays: 120,
	targetHarvestWeightG: 300,
	expectedSurvivalPct: 90,
	stockingAvgWeightG: 8,
	densityAdvisoryPerM2: 25,
};

describe("growth-default resolution (#828)", () => {
	it("prefers a pond override over the farm default", () => {
		const resolved = resolveGrowthDefaults(farm, {
			growOutDays: 150,
			targetHarvestWeightG: null,
			expectedSurvivalPct: null,
			stockingAvgWeightG: null,
			densityAdvisoryPerM2: null,
		});

		expect(resolved.growOutDays).toEqual({ value: 150, source: "pond" });
		expect(resolved.targetHarvestWeightG).toEqual({ value: 300, source: "farm" });
		expect(resolved.expectedSurvivalPct).toEqual({ value: 90, source: "farm" });
		expect(resolved.stockingAvgWeightG).toEqual({ value: 8, source: "farm" });
		expect(resolved.densityAdvisoryPerM2).toEqual({ value: 25, source: "farm" });
	});

	it("falls back to the documented constants with no farm or pond value", () => {
		const resolved = resolveGrowthDefaults(null, null);

		expect(resolved.growOutDays).toEqual({
			value: SYSTEM_GROWTH_DEFAULTS.growOutDays,
			source: "system",
		});
		expect(resolved.targetHarvestWeightG).toEqual({
			value: SYSTEM_GROWTH_DEFAULTS.targetHarvestWeightG,
			source: "system",
		});
		expect(resolved.expectedSurvivalPct).toEqual({
			value: SYSTEM_GROWTH_DEFAULTS.expectedSurvivalPct,
			source: "system",
		});
		expect(resolved.densityAdvisoryPerM2).toEqual({
			value: SYSTEM_GROWTH_DEFAULTS.densityAdvisoryPerM2,
			source: "system",
		});
		// Stocking weight has no historical constant: it stays empty.
		expect(resolved.stockingAvgWeightG).toEqual({ value: null, source: "system" });
	});

	it("uses the constant for a malformed stored value instead of clamping it", () => {
		const resolved = resolveGrowthDefaults(
			{ growOutDays: 20, targetHarvestWeightG: Number.NaN },
			{ expectedSurvivalPct: 120, stockingAvgWeightG: 0 },
		);

		expect(resolved.growOutDays).toEqual({
			value: SYSTEM_GROWTH_DEFAULTS.growOutDays,
			source: "system",
		});
		expect(resolved.targetHarvestWeightG.source).toBe("system");
		expect(resolved.expectedSurvivalPct.source).toBe("system");
		expect(resolved.stockingAvgWeightG.source).toBe("system");
	});

	it("treats a cleared override as inherit", () => {
		const resolved = resolveGrowthDefaults(farm, {
			growOutDays: null,
			targetHarvestWeightG: null,
			expectedSurvivalPct: null,
			stockingAvgWeightG: null,
			densityAdvisoryPerM2: null,
		});

		expect(resolved.growOutDays.source).toBe("farm");
		expect(resolved.targetHarvestWeightG.source).toBe("farm");
	});

	it("sanitizes a stored row to nulls when values are malformed", () => {
		expect(
			sanitizeGrowthDefaults({
				growOutDays: "120",
				targetHarvestWeightG: 300,
				expectedSurvivalPct: 90,
				stockingAvgWeightG: 8,
				densityAdvisoryPerM2: 25,
			}),
		).toEqual({
			growOutDays: null,
			targetHarvestWeightG: 300,
			expectedSurvivalPct: 90,
			stockingAvgWeightG: 8,
			densityAdvisoryPerM2: 25,
		});
	});
});
