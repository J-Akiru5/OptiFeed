import { elapsedParts, relativeAge } from "@/lib/relative-time";
import { describe, expect, it } from "vitest";

/**
 * #891: the device "last seen" value must switch to a day scale instead of
 * counting hours forever, and the same helper feeds the live tile and the
 * offline duration on the hardware page.
 */

const NOW = new Date("2026-11-07T12:00:00.000Z");

function ago(ms: number): Date {
	return new Date(NOW.getTime() - ms);
}

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

describe("relative age thresholds (#891)", () => {
	it("uses seconds below a minute", () => {
		expect(relativeAge(ago(45 * SECOND), NOW)).toEqual({ unit: "now", count: 0 });
	});

	it("uses minutes below an hour", () => {
		expect(relativeAge(ago(5 * MINUTE), NOW)).toEqual({ unit: "minutes", count: 5 });
	});

	it("uses hours below a day, so two hours reads as 2h", () => {
		expect(relativeAge(ago(2 * HOUR + 30 * MINUTE), NOW)).toEqual({
			unit: "hours",
			count: 2,
		});
		expect(relativeAge(ago(23 * HOUR + 59 * MINUTE), NOW)).toEqual({
			unit: "hours",
			count: 23,
		});
	});

	it("switches to days exactly at a full day, not before", () => {
		expect(relativeAge(ago(DAY - MINUTE), NOW)).toEqual({ unit: "hours", count: 23 });
		expect(relativeAge(ago(DAY), NOW)).toEqual({ unit: "days", count: 1 });
	});

	it("reads a three-day outage as 3d, not 72h", () => {
		expect(relativeAge(ago(3 * DAY + 5 * HOUR), NOW)).toEqual({ unit: "days", count: 3 });
	});

	it("clamps a future timestamp to now instead of a negative age", () => {
		expect(relativeAge(new Date(NOW.getTime() + 5 * MINUTE), NOW)).toEqual({
			unit: "now",
			count: 0,
		});
	});

	it("returns null for a missing or unparseable timestamp", () => {
		expect(relativeAge(null, NOW)).toBeNull();
		expect(relativeAge(undefined, NOW)).toBeNull();
		expect(relativeAge("not a date", NOW)).toBeNull();
	});
});

describe("elapsed parts (#891)", () => {
	it("breaks 75 hours into days, hours and minutes", () => {
		expect(elapsedParts(ago(75 * HOUR + 12 * MINUTE), NOW)).toEqual({
			days: 3,
			hours: 3,
			minutes: 12,
			seconds: 75 * 3600 + 12 * 60,
		});
	});

	it("accepts ISO strings and numeric timestamps", () => {
		const iso = ago(2 * HOUR).toISOString();
		expect(elapsedParts(iso, NOW)?.hours).toBe(2);
		expect(elapsedParts(ago(2 * HOUR).getTime(), NOW.getTime())?.hours).toBe(2);
	});
});
