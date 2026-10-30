import {
	buildPondDeviceConstraints,
	buildPondFeedPreview,
	detectPondDeviceConflicts,
} from "@/lib/settings/pond-conflicts";
import { parsePondSettingsDraft } from "@/lib/settings/pond-input";
import { describe, expect, it } from "vitest";

/**
 * #371 arithmetic, pinned at its boundaries.
 *
 * The form, the save action and this test share one implementation, so these
 * cases are the contract: exactly at a limit is allowed (the feeder can do it),
 * a hair over is not, and a missing population or biomass is never guessed.
 */

function constraints(overrides: Partial<Parameters<typeof buildPondDeviceConstraints>[0]> = {}) {
	return buildPondDeviceConstraints({
		deviceId: "device-1",
		configuredDailyCapG: 2000,
		hopperCapacityG: null,
		gramsPerSecond: 4,
		maxDispenseMs: 300_000,
		dailyCapFactor: 1,
		...overrides,
	});
}

function preview(overrides: Partial<Parameters<typeof buildPondFeedPreview>[0]> = {}) {
	return buildPondFeedPreview({
		population: 100,
		avgWeightKg: 1,
		feedingRatePct: 2,
		feedsPerDay: 2,
		...overrides,
	});
}

describe("buildPondFeedPreview", () => {
	it("computes the daily and per-meal grams from biomass and rate", () => {
		// 100 fish x 1 kg = 100,000 g; 2% = 2,000 g/day; 2 meals = 1,000 g/meal.
		expect(preview()).toEqual({
			status: "ready",
			biomassG: 100_000,
			dailyG: 2000,
			perMealG: 1000,
			scheduledDailyG: 2000,
		});
	});

	it("reports a missing population instead of inventing one", () => {
		expect(preview({ population: null }).status).toBe("no-population");
		expect(preview({ population: 0 }).status).toBe("no-population");
		expect(preview({ population: null }).dailyG).toBeNull();
	});

	it("reports a missing biomass sample", () => {
		expect(preview({ avgWeightKg: null }).status).toBe("no-biomass");
		expect(preview({ avgWeightKg: 0 }).status).toBe("no-biomass");
	});

	it("returns no per-meal number when feeds per day is zero", () => {
		const zero = preview({ feedsPerDay: 0 });
		expect(zero.status).toBe("no-biomass");
		expect(zero.perMealG).toBeNull();
		expect(zero.scheduledDailyG).toBeNull();
	});
});

describe("buildPondDeviceConstraints", () => {
	it("uses the stored ceiling when nothing lowers it", () => {
		const caps = constraints();
		expect(caps.effectiveDailyCapG).toBe(2000);
		expect(caps.dailyCapSource).toBe("device");
	});

	it("defaults a missing ceiling to 2,000 g and still calls it a device limit", () => {
		const caps = constraints({ configuredDailyCapG: null });
		expect(caps.effectiveDailyCapG).toBe(2000);
		expect(caps.dailyCapSource).toBe("device");
	});

	it("attributes a lowered platform factor to the platform", () => {
		const caps = constraints({ dailyCapFactor: 0.5 });
		expect(caps.effectiveDailyCapG).toBe(1000);
		expect(caps.dailyCapSource).toBe("platform");
	});

	it("attributes a smaller hopper to the hopper", () => {
		const caps = constraints({ hopperCapacityG: 1200 });
		expect(caps.effectiveDailyCapG).toBe(1200);
		expect(caps.dailyCapSource).toBe("hopper");
	});

	it("ignores a hopper larger than the configured ceiling", () => {
		const caps = constraints({ hopperCapacityG: 5000 });
		expect(caps.effectiveDailyCapG).toBe(2000);
		expect(caps.dailyCapSource).toBe("device");
	});
});

describe("detectPondDeviceConflicts", () => {
	it("reports nothing when every value fits exactly on the limit", () => {
		expect(detectPondDeviceConflicts(preview(), constraints())).toEqual([]);
	});

	it("reports the daily ceiling only once the daily feed is over it", () => {
		// 2.001% of 100,000 g = 2,001 g/day; four meals keep the per-meal dose
		// inside the per-request cap, so the daily ceiling is the only conflict.
		const over = detectPondDeviceConflicts(
			preview({ feedingRatePct: 2.001, feedsPerDay: 4 }),
			constraints(),
		);
		expect(over).toHaveLength(1);
		const [conflict] = over;
		expect(conflict?.code).toBe("daily-ceiling");
		expect(conflict?.field).toBe("feedingRatePct");
		expect(conflict?.pondValueG).toBe(2001);
		expect(conflict?.deviceValueG).toBe(2000);
		expect(conflict?.href).toBe("/dashboard/settings/hardware#daily-ceiling");
		expect(conflict?.canUsePondValue).toBe(true);
		expect(conflict?.pondValueToApplyG).toBe(2001);
	});

	it("never offers a pond value above the hard safety maximum", () => {
		const over = detectPondDeviceConflicts(
			preview({ population: 1000, feedingRatePct: 10, feedsPerDay: 20 }),
			constraints(),
		);
		const daily = over.find((conflict) => conflict.code === "daily-ceiling");
		expect(daily?.aboveHardMax).toBe(true);
		expect(daily?.canUsePondValue).toBe(false);
		expect(daily?.pondValueToApplyG).toBeNull();
	});

	it("does not offer a device write when the platform or hopper sets the ceiling", () => {
		for (const caps of [
			constraints({ dailyCapFactor: 0.5 }),
			constraints({ hopperCapacityG: 1200 }),
		]) {
			const over = detectPondDeviceConflicts(preview({ feedingRatePct: 2.001 }), caps);
			const daily = over.find((conflict) => conflict.code === "daily-ceiling");
			expect(daily?.canUsePondValue).toBe(false);
			expect(daily?.pondValueToApplyG).toBeNull();
		}
	});

	it("allows a meal exactly at the relay window", () => {
		// 4 g/s x 300 s = 1,200 g; a 1,000 g meal fits.
		expect(detectPondDeviceConflicts(preview(), constraints())).toEqual([]);
	});

	it("reports a meal over the relay window with the fewest meals that fit", () => {
		const over = detectPondDeviceConflicts(preview({ feedingRatePct: 5 }), constraints());
		const relay = over.find((conflict) => conflict.code === "relay-time");
		expect(relay?.field).toBe("feedsPerDay");
		expect(relay?.pondValueG).toBe(2500);
		expect(relay?.deviceValueG).toBe(1200);
		// 5,000 g/day over a 1,200 g window = 5 meals (4 would still be 1,250).
		expect(relay?.suggestedFeedsPerDay).toBe(5);
		expect(relay?.canUsePondValue).toBe(false);
		expect(relay?.href).toBe("/dashboard/settings/hardware#calibration");
	});

	it("reports nothing when the plan cannot be computed", () => {
		expect(detectPondDeviceConflicts(preview({ population: null }), constraints())).toEqual([]);
	});
});

describe("parsePondSettingsDraft", () => {
	const base = {
		feedingRate: "2",
		feedsPerDay: "2",
		sampleInterval: "15",
		population: "100",
		areaM2: "500",
		averageDepthM: "1.5",
		feedPricePerKg: "30",
	};

	it("parses a complete draft", () => {
		const result = parsePondSettingsDraft(base);
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.values).toEqual({
				feedingRatePct: 2,
				feedsPerDay: 2,
				sampleIntervalDays: 15,
				population: 100,
				areaM2: 500,
				averageDepthM: 1.5,
				feedPricePerKg: 30,
			});
		}
	});

	it("accepts the boundary values", () => {
		const result = parsePondSettingsDraft({
			...base,
			feedingRate: "0.1",
			feedsPerDay: "24",
			sampleInterval: "90",
			population: "1",
			areaM2: "0.1",
			averageDepthM: "0.1",
			feedPricePerKg: "0",
		});
		expect(result.ok).toBe(true);
	});

	it("flags each field that is out of range, not the whole form", () => {
		const result = parsePondSettingsDraft({
			...base,
			feedingRate: "0",
			feedsPerDay: "25",
			sampleInterval: "0",
		});
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.errors.map((error) => error.field)).toEqual([
				"feedingRatePct",
				"feedsPerDay",
				"sampleIntervalDays",
			]);
			expect(result.errors.map((error) => error.code)).toEqual([
				"rate_min",
				"feeds_max",
				"interval_min",
			]);
		}
	});

	it("rejects a non-integer population and a zero-area pond", () => {
		const result = parsePondSettingsDraft({
			...base,
			population: "12.5",
			areaM2: "0",
		});
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.errors.map((error) => error.code)).toContain("invalid_number");
			expect(result.errors.map((error) => error.code)).toContain("area_invalid");
		}
	});

	it("treats an empty optional field as unset", () => {
		const result = parsePondSettingsDraft({
			...base,
			population: "",
			areaM2: "",
			averageDepthM: "",
			feedPricePerKg: "",
		});
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.values.population).toBeNull();
			expect(result.values.areaM2).toBeNull();
			expect(result.values.averageDepthM).toBeNull();
			expect(result.values.feedPricePerKg).toBeNull();
		}
	});

	it("rejects text where a number is required", () => {
		const result = parsePondSettingsDraft({ ...base, feedingRate: "abc" });
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.errors[0]?.code).toBe("invalid_number");
	});
});
