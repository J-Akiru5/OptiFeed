import { describe, expect, it } from "vitest";
import { checkScheduleCaps } from "../feed/commands";

/**
 * The schedule's safety arithmetic, shared by the schedule save and the pond
 * settings save (audit 2026-10-28). Caps may only tighten; the per-meal limit
 * is the server's own 1,000 g ceiling.
 */
const base = {
	gramsPerMeal: 125,
	feedsPerDay: 4,
	hopperCapacityG: null,
	gramsPerSecond: 10,
	maxDispenseMs: 300_000,
	dailyCapFactor: 1,
};

describe("checkScheduleCaps", () => {
	it("accepts a schedule inside every cap", () => {
		expect(checkScheduleCaps(base)).toEqual({ ok: true });
	});

	it("rejects a dose above the 1,000 g per-meal limit", () => {
		const result = checkScheduleCaps({ ...base, gramsPerMeal: 1000.1 });
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error).toContain("1000 g per-meal limit");
	});

	it("rejects a daily total above the 5,000 g cap", () => {
		const result = checkScheduleCaps({ ...base, gramsPerMeal: 300, feedsPerDay: 24 });
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error).toContain("g/day limit");
	});

	it("uses the smaller hopper capacity as the daily cap", () => {
		// 480 g hopper: 125 g × 4 meals = 500 g/day is over.
		const result = checkScheduleCaps({ ...base, hopperCapacityG: 480 });
		expect(result.ok).toBe(false);
	});

	it("honours a tightened platform cap factor", () => {
		// 125 g × 4 = 500 g/day; half of 5,000 is still 2,500, so the hopper
		// must be the binding limit here — use a 900 g hopper instead.
		expect(checkScheduleCaps({ ...base, hopperCapacityG: 900 }).ok).toBe(true);
		// Factor 0.1 → 500 g/day cap: 500 g is exactly at the cap.
		expect(checkScheduleCaps({ ...base, dailyCapFactor: 0.1 }).ok).toBe(true);
		expect(checkScheduleCaps({ ...base, dailyCapFactor: 0.1, gramsPerMeal: 126 }).ok).toBe(false);
	});

	it("rejects a dose that needs more relay time than the cap allows", () => {
		const result = checkScheduleCaps({ ...base, gramsPerMeal: 310, gramsPerSecond: 1 });
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error).toContain("relay time");
	});

	it("rejects an unusable amount instead of writing it", () => {
		expect(checkScheduleCaps({ ...base, gramsPerMeal: 0 }).ok).toBe(false);
		expect(checkScheduleCaps({ ...base, gramsPerMeal: Number.NaN }).ok).toBe(false);
	});
});
