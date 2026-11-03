import { describe, expect, it } from "vitest";
import { fcrTrendDirection } from "../growth/fcr-trend";

describe("fcrTrendDirection (#752)", () => {
	it("has no direction with no reports", () => {
		expect(fcrTrendDirection([])).toBeNull();
	});

	it("has no direction with a single report", () => {
		expect(fcrTrendDirection([1.4])).toBeNull();
	});

	it("reports a downward trend from two comparable reports", () => {
		expect(fcrTrendDirection([1.8, 1.5])).toBe(-1);
	});

	it("reports an upward trend", () => {
		expect(fcrTrendDirection([1.3, 1.6])).toBe(1);
	});

	it("reports a flat series as steady", () => {
		expect(fcrTrendDirection([1.5, 1.5])).toBe(0);
	});

	it("ignores a non-numeric point instead of claiming a direction", () => {
		expect(fcrTrendDirection([1.5, Number.NaN])).toBeNull();
	});
});
