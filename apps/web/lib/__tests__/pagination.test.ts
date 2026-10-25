import {
	DEFAULT_PAGE_SIZE,
	MAX_PAGE_SIZE,
	buildPageHref,
	buildPageWindow,
	getPageCount,
	parseDateParam,
	parsePage,
	parsePageSize,
	resolveDateRange,
} from "@/lib/pagination";
import { describe, expect, it } from "vitest";

describe("parsePage", () => {
	it("defaults to page 1 for missing or invalid input", () => {
		expect(parsePage(undefined)).toBe(1);
		expect(parsePage(null)).toBe(1);
		expect(parsePage("")).toBe(1);
		expect(parsePage("abc")).toBe(1);
		expect(parsePage("0")).toBe(1);
		expect(parsePage("-4")).toBe(1);
	});

	it("accepts positive page numbers", () => {
		expect(parsePage("3")).toBe(3);
		expect(parsePage("42")).toBe(42);
	});
});

describe("parsePageSize", () => {
	it("falls back to the default and clamps the maximum", () => {
		expect(parsePageSize(undefined)).toBe(DEFAULT_PAGE_SIZE);
		expect(parsePageSize("nope")).toBe(DEFAULT_PAGE_SIZE);
		expect(parsePageSize("20")).toBe(20);
		expect(parsePageSize("9999")).toBe(MAX_PAGE_SIZE);
	});
});

describe("parseDateParam", () => {
	it("parses a UTC calendar day", () => {
		expect(parseDateParam("2026-10-21")?.toISOString()).toBe("2026-10-21T00:00:00.000Z");
	});

	it("rejects malformed and overflowing dates", () => {
		expect(parseDateParam("21/10/2026")).toBeNull();
		expect(parseDateParam("2026-10-21T00:00:00Z")).toBeNull();
		expect(parseDateParam("2026-02-31")).toBeNull();
		expect(parseDateParam("")).toBeNull();
	});
});

describe("resolveDateRange", () => {
	it("returns undefined when no dates are provided", () => {
		expect(resolveDateRange(undefined, undefined)).toBeUndefined();
		expect(resolveDateRange("", "")).toBeUndefined();
	});

	it("builds an inclusive start and exclusive end", () => {
		const range = resolveDateRange("2026-10-01", "2026-10-03");
		expect(range?.gte?.toISOString()).toBe("2026-10-01T00:00:00.000Z");
		expect(range?.lt?.toISOString()).toBe("2026-10-04T00:00:00.000Z");
	});

	it("supports one-sided ranges", () => {
		expect(resolveDateRange("2026-10-01", undefined)?.lt).toBeUndefined();
		expect(resolveDateRange(undefined, "2026-10-03")?.gte).toBeUndefined();
	});

	it("swaps a reversed range instead of returning nothing", () => {
		const range = resolveDateRange("2026-10-05", "2026-10-03");
		expect(range?.gte?.toISOString()).toBe("2026-10-03T00:00:00.000Z");
		expect(range?.lt?.toISOString()).toBe("2026-10-06T00:00:00.000Z");
	});
});

describe("getPageCount", () => {
	it("never returns less than one page", () => {
		expect(getPageCount(0, 10)).toBe(1);
		expect(getPageCount(1, 10)).toBe(1);
		expect(getPageCount(10, 10)).toBe(1);
		expect(getPageCount(11, 10)).toBe(2);
		expect(getPageCount(200, 10)).toBe(20);
	});
});

describe("buildPageWindow", () => {
	it("returns every page for short histories", () => {
		expect(buildPageWindow(1, 5)).toEqual([1, 2, 3, 4, 5]);
		expect(buildPageWindow(2, 7)).toEqual([1, 2, 3, 4, 5, 6, 7]);
	});

	it("keeps the first page anchored", () => {
		expect(buildPageWindow(1, 20)).toEqual([1, 2, 3, 4, 5, "ellipsis", 20]);
	});

	it("centres the window in the middle", () => {
		expect(buildPageWindow(10, 20)).toEqual([1, "ellipsis", 8, 9, 10, 11, 12, "ellipsis", 20]);
	});

	it("keeps the last page anchored", () => {
		expect(buildPageWindow(20, 20)).toEqual([1, "ellipsis", 16, 17, 18, 19, 20]);
	});

	it("handles an empty history", () => {
		expect(buildPageWindow(1, 0)).toEqual([]);
	});
});

describe("buildPageHref", () => {
	it("omits page 1 and empty filters", () => {
		expect(buildPageHref("/x", { tab: "feed", q: "", from: undefined }, 1)).toBe("/x?tab=feed");
	});

	it("preserves filters when paging", () => {
		expect(buildPageHref("/x", { tab: "feed", from: "2026-10-01" }, 2)).toBe(
			"/x?tab=feed&from=2026-10-01&page=2",
		);
	});
});
