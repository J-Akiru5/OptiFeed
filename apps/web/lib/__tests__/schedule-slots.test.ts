import { describe, expect, it } from "vitest";
import { FEEDS_PER_DAY_MAX, FEEDS_PER_DAY_MIN } from "../limits";
import { SLOT_FEEDS_MAX, SLOT_FEEDS_MIN, scheduleSlotTimes } from "../schedule/slots";

/**
 * Guards #431: the dashboard must show one feeding time per requested feed.
 *
 * The firmware spreads meals evenly from the window start to its end, so the
 * preview is a pure function of the window and the current frequency. These
 * tests pin that function independently of the editor state.
 */
describe("scheduleSlotTimes", () => {
	it("shows one time per feed at 1, 2, 3 and 6 feeds per day", () => {
		expect(scheduleSlotTimes("06:00", "18:00", 1)).toEqual(["06:00"]);
		expect(scheduleSlotTimes("06:00", "18:00", 2)).toEqual(["06:00", "18:00"]);
		expect(scheduleSlotTimes("06:00", "18:00", 3)).toEqual(["06:00", "12:00", "18:00"]);
		expect(scheduleSlotTimes("06:00", "18:00", 6)).toEqual([
			"06:00",
			"08:24",
			"10:48",
			"13:12",
			"15:36",
			"18:00",
		]);
	});

	it("handles a window whose start equals its end", () => {
		expect(scheduleSlotTimes("06:00", "06:00", 1)).toEqual(["06:00"]);
		// The device's even-spacing math has no interval to divide in a
		// zero-length window; every meal lands on the same minute.
		expect(scheduleSlotTimes("06:00", "06:00", 3)).toEqual(["06:00", "06:00", "06:00"]);
	});

	it("adds the third slot when the frequency changes from 2 to 3", () => {
		expect(scheduleSlotTimes("06:00", "18:00", 2)).toHaveLength(2);
		expect(scheduleSlotTimes("06:00", "18:00", 3)).toEqual(["06:00", "12:00", "18:00"]);
	});

	it("keeps the after-midnight tail of an overnight window", () => {
		expect(scheduleSlotTimes("22:00", "04:00", 3)).toEqual(["22:00", "01:00", "04:00"]);
	});

	it("returns no slots for an invalid draft instead of a partial schedule", () => {
		expect(scheduleSlotTimes("", "18:00", 3)).toEqual([]);
		expect(scheduleSlotTimes("06:00", "", 3)).toEqual([]);
		expect(scheduleSlotTimes("25:00", "18:00", 3)).toEqual([]);
		expect(scheduleSlotTimes("06:00", "18:00", 0)).toEqual([]);
		expect(scheduleSlotTimes("06:00", "18:00", Number.NaN)).toEqual([]);
	});

	it("caps the preview at the stored maximum of 24 feeds per day", () => {
		expect(scheduleSlotTimes("00:00", "23:00", 100)).toHaveLength(24);
	});
});

describe("slot bounds", () => {
	it("stay in step with the server-side feeds-per-day limits", () => {
		// slots.ts keeps its own copy so the client bundle does not pull in zod.
		expect(SLOT_FEEDS_MIN).toBe(FEEDS_PER_DAY_MIN);
		expect(SLOT_FEEDS_MAX).toBe(FEEDS_PER_DAY_MAX);
	});
});
