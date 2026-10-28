import { describe, expect, it } from "vitest";
import { resolveLiveFish } from "../population";

/**
 * Live fish = stocked − mortality (reference sheet, 2026-10-28):
 * 300 stocked → 285 live after 15 losses. Every feed figure uses this count.
 */
describe("resolveLiveFish", () => {
	it("uses the sheet's live count when a mortality count is known", () => {
		const result = resolveLiveFish({ stockedCount: 300, mortalityCount: 15 });

		expect(result.liveFish).toBe(285);
		expect(result.stockedCount).toBe(300);
		expect(result.source).toBe("mortality");
		expect(result.survivalPct).toBeNull();
	});

	it("falls back to the cycle's survival assumption", () => {
		// 300 × 95 % = 285 — the same live count the sheet records.
		const result = resolveLiveFish({ stockedCount: 300, expectedSurvivalPct: 95 });

		expect(result.liveFish).toBe(285);
		expect(result.source).toBe("survival");
		expect(result.survivalPct).toBe(95);
	});

	it("prefers an observed mortality count over the survival estimate", () => {
		const result = resolveLiveFish({
			stockedCount: 300,
			mortalityCount: 30,
			expectedSurvivalPct: 95,
		});

		expect(result.liveFish).toBe(270);
		expect(result.source).toBe("mortality");
	});

	it("does not treat 100 % survival as an adjustment", () => {
		const result = resolveLiveFish({ stockedCount: 300, expectedSurvivalPct: 100 });

		expect(result.liveFish).toBe(300);
		expect(result.source).toBe("stocked");
	});

	it("returns the stocked count when nothing else is recorded", () => {
		const result = resolveLiveFish({ stockedCount: 300 });

		expect(result.liveFish).toBe(300);
		expect(result.source).toBe("stocked");
	});

	it("never invents a population", () => {
		expect(resolveLiveFish({}).liveFish).toBeNull();
		expect(resolveLiveFish({ stockedCount: null }).source).toBe("unknown");
		expect(resolveLiveFish({ stockedCount: 0 }).liveFish).toBeNull();
		expect(resolveLiveFish({ stockedCount: -5 }).liveFish).toBeNull();
	});

	it("ignores unusable percentages and handles a total loss", () => {
		expect(resolveLiveFish({ stockedCount: 300, expectedSurvivalPct: 0 }).source).toBe("stocked");
		expect(resolveLiveFish({ stockedCount: 300, expectedSurvivalPct: 150 }).source).toBe("stocked");
		// A total-loss report leaves nothing to feed; it must not divide by zero.
		expect(resolveLiveFish({ stockedCount: 300, mortalityCount: 300 }).liveFish).toBe(0);
		expect(resolveLiveFish({ stockedCount: 300, mortalityCount: 299 }).liveFish).toBe(1);
	});
});
