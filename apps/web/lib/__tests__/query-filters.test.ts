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

	it("parses date strings into recordedBetween filter", () => {
		const result = parseQueryFilters("2025-07-04");
		expect(result.recordedBetween).toBeDefined();
		expect(result.recordedBetween?.gte.toISOString()).toBe("2025-07-04T00:00:00.000Z");
		expect(result.recordedBetween?.lt.toISOString()).toBe("2025-07-05T00:00:00.000Z");
	});

	it("returns empty object for invalid date string", () => {
		expect(parseQueryFilters("not-a-date")).toEqual({});
	});

	it("normalizes to lowercase before matching", () => {
		expect(parseQueryFilters("SCHEDULED")).toEqual({ source: "scheduled" });
	});
});
