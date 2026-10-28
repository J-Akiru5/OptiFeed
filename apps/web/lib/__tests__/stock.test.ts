import { describe, expect, it } from "vitest";
import { DEFAULT_FISH_COUNT } from "../constants";
import { liveFishCount, liveFishCountOrDefault, resolveLiveFishCount } from "../stock";

describe("resolveLiveFishCount", () => {
	it("uses the pond's live count over the stocked count (data sheet: 300 → 285)", () => {
		expect(
			resolveLiveFishCount({ population: 285, stockingCount: 300, expectedSurvivalPct: 95 }),
		).toEqual({ count: 285, source: "pond" });
	});

	it("estimates live fish from stocked × expected survival when the pond count is missing", () => {
		expect(resolveLiveFishCount({ stockingCount: 300, expectedSurvivalPct: 95 })).toEqual({
			count: 285,
			source: "stocking-estimate",
		});
	});

	it("treats a missing survival as 100% and clamps out-of-range values", () => {
		expect(resolveLiveFishCount({ stockingCount: 300 })).toEqual({
			count: 300,
			source: "stocking-estimate",
		});
		expect(resolveLiveFishCount({ stockingCount: 300, expectedSurvivalPct: 0 })?.count).toBe(3);
		expect(resolveLiveFishCount({ stockingCount: 300, expectedSurvivalPct: 250 })?.count).toBe(300);
	});

	it("rounds to whole fish", () => {
		expect(liveFishCount({ population: 284.6 })).toBe(285);
	});

	it("never trusts zero, negative, NaN or Infinity", () => {
		expect(liveFishCount({ population: 0, stockingCount: 300 })).toBe(300);
		expect(liveFishCount({ population: -10, stockingCount: 300 })).toBe(300);
		expect(liveFishCount({ population: Number.NaN, stockingCount: 300 })).toBe(300);
		expect(liveFishCount({ population: Number.POSITIVE_INFINITY, stockingCount: 300 })).toBe(300);
	});

	it("returns null when nothing is known, or the labelled fallback", () => {
		expect(resolveLiveFishCount({})).toBeNull();
		expect(resolveLiveFishCount({ fallbackCount: DEFAULT_FISH_COUNT })).toEqual({
			count: DEFAULT_FISH_COUNT,
			source: "default",
		});
	});

	it("defaults to DEFAULT_FISH_COUNT only when asked explicitly", () => {
		expect(liveFishCountOrDefault({})).toEqual({
			count: DEFAULT_FISH_COUNT,
			source: "default",
		});
	});
});
