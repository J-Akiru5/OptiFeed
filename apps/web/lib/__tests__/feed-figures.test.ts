import {
	MACHINE_FEED_SOURCES,
	formatFeedAmount,
	formatFeedAmountLabel,
	isDailyTotalSource,
	isMachineFeedSource,
	startOfFarmDay,
} from "@/lib/feed-figures";
import { describe, expect, it } from "vitest";

/**
 * Feed-figure rules from issue #236. The History card used to show one number
 * that mixed machine dispenses with imported hand-fed daily totals; these tests
 * pin the unit rule and the machine/daily-total distinction the page relies on.
 */

describe("formatFeedAmount", () => {
	it("keeps grams below 1,000 g", () => {
		expect(formatFeedAmount(0)).toEqual({ value: "0", unit: "g" });
		expect(formatFeedAmount(500)).toEqual({ value: "500", unit: "g" });
		expect(formatFeedAmount(999)).toEqual({ value: "999", unit: "g" });
	});

	it("switches to kilograms with two decimals at 1,000 g", () => {
		expect(formatFeedAmount(1000)).toEqual({ value: "1.00", unit: "kg" });
		expect(formatFeedAmount(1045.53)).toEqual({ value: "1.05", unit: "kg" });
		expect(formatFeedAmount(19_000)).toEqual({ value: "19.00", unit: "kg" });
	});

	it("never renders a negative or non-finite amount as a feed", () => {
		expect(formatFeedAmount(-50)).toEqual({ value: "0", unit: "g" });
		expect(formatFeedAmount(null)).toEqual({ value: "0", unit: "g" });
		expect(formatFeedAmount(undefined)).toEqual({ value: "0", unit: "g" });
		expect(formatFeedAmount(Number.NaN)).toEqual({ value: "0", unit: "g" });
	});

	it("labels an amount with its unit", () => {
		expect(formatFeedAmountLabel(1045.53)).toBe("1.05 kg");
		expect(formatFeedAmountLabel(400)).toBe("400 g");
	});
});

describe("feed sources", () => {
	it("treats only scheduled, dashboard and button as machine dispenses", () => {
		for (const source of MACHINE_FEED_SOURCES) expect(isMachineFeedSource(source)).toBe(true);
		expect(isMachineFeedSource("hand_fed")).toBe(false);
		expect(isMachineFeedSource(null)).toBe(false);
		expect(isMachineFeedSource("unknown")).toBe(false);
	});

	it("marks hand_fed as a daily total, never a dispense", () => {
		expect(isDailyTotalSource("hand_fed")).toBe(true);
		expect(isDailyTotalSource("dashboard")).toBe(false);
	});
});

describe("startOfFarmDay", () => {
	it("uses Asia/Manila midnight, not the server runtime's midnight", () => {
		// 2026-10-27 23:30 UTC is already 2026-10-28 07:30 in Manila.
		const start = startOfFarmDay(new Date("2026-10-27T23:30:00.000Z"));
		expect(start.toISOString()).toBe("2026-10-27T16:00:00.000Z");
	});
});
