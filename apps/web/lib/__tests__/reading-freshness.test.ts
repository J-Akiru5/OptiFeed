import { describe, expect, it } from "vitest";

import { isReadingStale, readingAge } from "@/lib/feeder/reading-freshness";

/**
 * Reading freshness for the live viewer (#620). The window is the device's own
 * offline window, so a reading that is older than the window is not evidence
 * about the present.
 */

const NOW = new Date("2026-11-03T08:00:00.000Z").getTime();
const MINUTE = 60_000;

describe("readingAge", () => {
	it("returns null for a reading that never happened", () => {
		expect(readingAge(null, NOW)).toBeNull();
		expect(readingAge(undefined, NOW)).toBeNull();
		expect(readingAge("not-a-date", NOW)).toBeNull();
	});

	it("uses seconds, minutes, hours and days at the right boundaries", () => {
		expect(readingAge(new Date(NOW - 30_000), NOW)).toEqual({ unit: "seconds", count: 30 });
		expect(readingAge(new Date(NOW - 90_000), NOW)).toEqual({ unit: "minutes", count: 1 });
		expect(readingAge(new Date(NOW - 2 * 60 * MINUTE), NOW)).toEqual({ unit: "hours", count: 2 });
		expect(readingAge(new Date(NOW - 50 * 60 * MINUTE), NOW)).toEqual({
			unit: "days",
			count: 2,
		});
	});

	it("accepts a Date and an ISO string", () => {
		expect(readingAge(new Date(NOW - 5 * MINUTE), NOW)).toEqual({ unit: "minutes", count: 5 });
		expect(readingAge(new Date(NOW - 5 * MINUTE).toISOString(), NOW)).toEqual({
			unit: "minutes",
			count: 5,
		});
	});

	it("does not run backwards when the clock is skewed", () => {
		expect(readingAge(new Date(NOW + MINUTE), NOW)).toEqual({ unit: "seconds", count: 0 });
	});
});

describe("isReadingStale", () => {
	it("treats a missing or unparseable reading as unknown, not stale", () => {
		expect(isReadingStale(null, 5 * MINUTE, NOW)).toBe(false);
		expect(isReadingStale("nonsense", 5 * MINUTE, NOW)).toBe(false);
	});

	it("stays fresh at the boundary and turns stale after it", () => {
		expect(isReadingStale(new Date(NOW - 5 * MINUTE), 5 * MINUTE, NOW)).toBe(false);
		expect(isReadingStale(new Date(NOW - 5 * MINUTE - 1), 5 * MINUTE, NOW)).toBe(true);
	});

	it("disables the check for a non-positive window", () => {
		expect(isReadingStale(new Date(NOW - 60 * MINUTE), 0, NOW)).toBe(false);
		expect(isReadingStale(new Date(NOW - 60 * MINUTE), Number.NaN, NOW)).toBe(false);
	});
});
