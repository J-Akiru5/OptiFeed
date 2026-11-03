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

	it("parses date strings into the Asia/Manila day window (#753)", () => {
		const result = parseQueryFilters("2025-07-04");
		expect(result.recordedBetween).toBeDefined();
		// 2025-07-04 00:00-24:00 PHT == 2025-07-03T16:00Z .. 2025-07-04T16:00Z.
		expect(result.recordedBetween?.gte.toISOString()).toBe("2025-07-03T16:00:00.000Z");
		expect(result.recordedBetween?.lt.toISOString()).toBe("2025-07-04T16:00:00.000Z");
	});

	it("includes a 00:30 PHT record that the UTC day window used to miss", () => {
		const result = parseQueryFilters("2025-07-04");
		const earlyManila = new Date("2025-07-03T16:30:00.000Z"); // 00:30 on 07-04 PHT
		expect(result.recordedBetween?.gte.getTime()).toBeLessThanOrEqual(earlyManila.getTime());
		expect(result.recordedBetween?.lt.getTime()).toBeGreaterThan(earlyManila.getTime());
	});

	it("returns empty object for invalid date string", () => {
		expect(parseQueryFilters("not-a-date")).toEqual({});
	});

	it("normalizes to lowercase before matching", () => {
		expect(parseQueryFilters("SCHEDULED")).toEqual({ source: "scheduled" });
	});
});
