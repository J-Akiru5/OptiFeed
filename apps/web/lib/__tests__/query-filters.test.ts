import { describe, expect, it } from "vitest";
import { parseQueryFilters } from "../actions/query-filters";

describe("parseQueryFilters", () => {
	it("returns empty object for empty query", () => {
		expect(parseQueryFilters("")).toEqual({});
	});

	it("returns empty object for whitespace-only query", () => {
		expect(parseQueryFilters("   ")).toEqual({});
	});

	it("parses 'scheduled' source filter", () => {
		expect(parseQueryFilters("scheduled")).toEqual({ source: "scheduled" });
	});

	it("parses 'dashboard' source filter", () => {
		expect(parseQueryFilters("dashboard")).toEqual({ source: "dashboard" });
	});

	it("parses 'button' source filter", () => {
		expect(parseQueryFilters("button")).toEqual({ source: "button" });
	});

	it("returns empty object for unrecognized source", () => {
		expect(parseQueryFilters("unknown")).toEqual({});
	});

	it("parses date strings into a farm-day recordedBetween filter", () => {
		const result = parseQueryFilters("2025-07-04");
		expect(result.recordedBetween).toBeDefined();
		// Asia/Manila midnight, not UTC midnight.
		expect(result.recordedBetween?.gte.toISOString()).toBe("2025-07-03T16:00:00.000Z");
		expect(result.recordedBetween?.lt.toISOString()).toBe("2025-07-04T16:00:00.000Z");
	});

	it("includes records at 00:30 and 23:30 PHT on the searched day (#753)", () => {
		const result = parseQueryFilters("2025-07-04");
		const range = result.recordedBetween;
		if (!range) throw new Error("expected a recordedBetween range");
		const { gte, lt } = range;

		// 00:30 PHT on Jul 4 is still Jul 3 in UTC.
		const early = new Date("2025-07-03T16:30:00.000Z");
		// 23:30 PHT on Jul 4 is 15:30 UTC the same day.
		const late = new Date("2025-07-04T15:30:00.000Z");
		expect(early >= gte && early < lt).toBe(true);
		expect(late >= gte && late < lt).toBe(true);

		// 00:30 PHT on Jul 5 belongs to the next day, not this window.
		const nextDay = new Date("2025-07-04T16:30:00.000Z");
		expect(nextDay >= lt).toBe(true);
	});

	it("returns empty object for invalid date string", () => {
		expect(parseQueryFilters("not-a-date")).toEqual({});
	});

	it("normalizes to lowercase before matching", () => {
		expect(parseQueryFilters("SCHEDULED")).toEqual({ source: "scheduled" });
	});
});
