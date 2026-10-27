import { describe, expect, it } from "vitest";
import {
	averageDailyGain,
	computeSgr,
	elapsedFarmDays,
	overallSgr,
	sgrSeries,
	sgrUnavailableReason,
} from "../sgr";

// Noon in Asia/Manila, so the UTC instant still falls on the same farm date.
const day = (isoDate: string) => new Date(`${isoDate}T12:00:00+08:00`);

describe("computeSgr", () => {
	it("matches the worked example: 10 g → 20 g over 30 days", () => {
		const sgr = computeSgr(10, day("2026-01-01"), 20, day("2026-01-31"));
		expect(sgr).toBeCloseTo(2.31, 3);
	});

	it("returns zero when the weight is unchanged", () => {
		expect(computeSgr(10, day("2026-01-01"), 10, day("2026-01-31"))).toBe(0);
	});

	it("returns a negative value for weight loss instead of clamping", () => {
		const sgr = computeSgr(20, day("2026-01-01"), 10, day("2026-01-31"));
		expect(sgr).toBeLessThan(0);
		expect(sgr).toBeCloseTo(-2.31, 3);
	});

	it("returns null for a non-positive weight", () => {
		expect(computeSgr(0, day("2026-01-01"), 20, day("2026-01-31"))).toBeNull();
		expect(computeSgr(10, day("2026-01-01"), -5, day("2026-01-31"))).toBeNull();
	});

	it("returns null for a same-instant interval", () => {
		expect(computeSgr(10, day("2026-01-01"), 20, day("2026-01-01"))).toBeNull();
	});

	it("counts calendar days in Asia/Manila, not UTC", () => {
		// 23:00 on Jan 1 and 01:00 on Jan 2 in Manila is 1 calendar day, even
		// though only two hours elapsed.
		const from = new Date("2026-01-01T23:00:00+08:00");
		const to = new Date("2026-01-02T01:00:00+08:00");
		expect(elapsedFarmDays(from, to)).toBe(1);
		expect(computeSgr(10, from, 20, to)).toBeCloseTo(69.31, 2);
	});

	it("returns null for samplings less than one farm day apart", () => {
		// Both fall on Jan 1 in Manila, so the fractional interval is under a day.
		const from = new Date("2026-01-01T08:00:00+08:00");
		const to = new Date("2026-01-01T20:00:00+08:00");
		expect(elapsedFarmDays(from, to)).toBeLessThan(1);
		expect(computeSgr(10, from, 20, to)).toBeNull();
	});
});

describe("sgrSeries", () => {
	it("sorts unsorted input oldest first and returns one point per interval", () => {
		const samples = [
			{ recordedAt: day("2026-01-31"), avgWeightKg: 20 },
			{ recordedAt: day("2026-01-01"), avgWeightKg: 10 },
			{ recordedAt: day("2026-01-16"), avgWeightKg: 14 },
		];

		const points = sgrSeries(samples);

		expect(points).toHaveLength(2);
		expect(points[0].from).toEqual(day("2026-01-01"));
		expect(points[0].to).toEqual(day("2026-01-16"));
		expect(points[1].from).toEqual(day("2026-01-16"));
		expect(points[1].to).toEqual(day("2026-01-31"));
		expect(points[0].sgrPctPerDay).toBeCloseTo(2.243, 3);
	});
});

describe("overallSgr", () => {
	it("uses the first and latest sampling", () => {
		const sgr = overallSgr([
			{ recordedAt: day("2026-01-31"), avgWeightKg: 20 },
			{ recordedAt: day("2026-01-01"), avgWeightKg: 10 },
		]);
		expect(sgr).toBeCloseTo(2.31, 3);
	});

	it("returns null with fewer than two samplings", () => {
		expect(overallSgr([{ recordedAt: day("2026-01-01"), avgWeightKg: 10 }])).toBeNull();
		expect(overallSgr([])).toBeNull();
	});
});

describe("averageDailyGain", () => {
	it("returns grams per fish per day", () => {
		const gain = averageDailyGain([
			{ recordedAt: day("2026-01-01"), avgWeightKg: 0.01 },
			{ recordedAt: day("2026-01-31"), avgWeightKg: 0.02 },
		]);
		expect(gain).toBeCloseTo(0.3333, 4);
	});
});

describe("sgrUnavailableReason", () => {
	it("explains each null case", () => {
		expect(sgrUnavailableReason([])).toBe("insufficientSamples");
		expect(
			sgrUnavailableReason([
				{ recordedAt: day("2026-01-01"), avgWeightKg: 0 },
				{ recordedAt: day("2026-01-31"), avgWeightKg: 20 },
			]),
		).toBe("invalidWeight");
		expect(
			sgrUnavailableReason([
				{ recordedAt: new Date("2026-01-01T08:00:00+08:00"), avgWeightKg: 10 },
				{ recordedAt: new Date("2026-01-01T20:00:00+08:00"), avgWeightKg: 20 },
			]),
		).toBe("intervalTooShort");
	});

	it("returns null when SGR is available", () => {
		expect(
			sgrUnavailableReason([
				{ recordedAt: day("2026-01-01"), avgWeightKg: 10 },
				{ recordedAt: day("2026-01-31"), avgWeightKg: 20 },
			]),
		).toBeNull();
	});
});
