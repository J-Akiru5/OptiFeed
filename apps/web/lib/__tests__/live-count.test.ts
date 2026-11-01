import { deriveLiveCount } from "@/lib/growth/live-count";
import { describe, expect, it } from "vitest";

/** Pure part of the issue #452 live count: stocked − dead, clamped, never out of range. */
describe("deriveLiveCount", () => {
	it("subtracts mortality from the stock", () => {
		expect(deriveLiveCount(300, 15)).toEqual({
			stocked: 300,
			dead: 15,
			live: 285,
			source: "crop_cycle",
		});
	});

	it("clamps at zero when mortality exceeds the stock (double-counted logs)", () => {
		expect(deriveLiveCount(300, 500).live).toBe(0);
	});

	it("rounds fractional totals down to whole fish", () => {
		expect(deriveLiveCount(300, 12.7).dead).toBe(12);
		expect(deriveLiveCount(300, 12.7).live).toBe(288);
	});

	it("reports none for a pond without any stock source", () => {
		expect(deriveLiveCount(null, 10)).toEqual({
			stocked: null,
			dead: 10,
			live: null,
			source: "none",
		});
	});
});
