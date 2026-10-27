import {
	buildDayKeys,
	buildMultiSeries,
	buildStackedSeries,
	computeDelta,
	computePointDelta,
	countSeriesValues,
	fillDailySeries,
	formatAxisDay,
	peakPoint,
	sharePct,
	sumValues,
	summarize,
} from "@/components/charts/chart-data";
import { describe, expect, it } from "vitest";

/**
 * The charts are thin Recharts wrappers; the behaviour worth testing is the
 * shaping they share: deltas, day buckets, stacked sources and totals.
 */

describe("computeDelta", () => {
	it("returns a rounded percentage change and its direction", () => {
		expect(computeDelta(120, 100)).toEqual({ pct: 20, direction: "up" });
		expect(computeDelta(80, 100)).toEqual({ pct: -20, direction: "down" });
		expect(computeDelta(100, 100)).toEqual({ pct: 0, direction: "flat" });
	});

	it("has no percentage from zero, but keeps the direction", () => {
		expect(computeDelta(0, 0)).toEqual({ pct: 0, direction: "flat" });
		expect(computeDelta(5, 0)).toEqual({ pct: null, direction: "up" });
		expect(computeDelta(-1, 0)).toEqual({ pct: null, direction: "down" });
	});

	it("returns a dash when the previous value is unknown", () => {
		expect(computeDelta(5, null)).toEqual({ pct: null, direction: "flat" });
		expect(computeDelta(Number.NaN, 3)).toEqual({ pct: null, direction: "flat" });
	});
});

describe("computePointDelta", () => {
	it("subtracts percentages as percentage points", () => {
		expect(computePointDelta(75, 80)).toEqual({ pct: -5, direction: "down" });
		expect(computePointDelta(82.5, 80)).toEqual({ pct: 2.5, direction: "up" });
	});

	it("is unknown when there is no previous reading", () => {
		expect(computePointDelta(75, null)).toEqual({ pct: null, direction: "flat" });
	});
});

describe("buildDayKeys", () => {
	it("covers the window in the farm timezone, without duplicates", () => {
		const keys = buildDayKeys(
			new Date("2026-10-20T16:00:00.000Z"),
			new Date("2026-10-23T02:00:00.000Z"),
			"Asia/Manila",
		);
		expect(keys).toEqual(["2026-10-21", "2026-10-22", "2026-10-23"]);
	});

	it("keeps a single day for a same-day window", () => {
		const keys = buildDayKeys(
			new Date("2026-10-20T01:00:00.000Z"),
			new Date("2026-10-20T05:00:00.000Z"),
			"Asia/Manila",
		);
		expect(keys).toEqual(["2026-10-20"]);
	});
});

describe("fillDailySeries", () => {
	const keys = ["2026-10-01", "2026-10-02", "2026-10-03"];

	it("adds zero buckets for quiet days", () => {
		expect(fillDailySeries([{ label: "2026-10-02", value: 4 }], keys)).toEqual([
			{ label: "2026-10-01", value: 0 },
			{ label: "2026-10-02", value: 4 },
			{ label: "2026-10-03", value: 0 },
		]);
	});

	it("sums duplicate buckets and ignores unknown days", () => {
		expect(
			fillDailySeries(
				[
					{ label: "2026-10-01", value: 2 },
					{ label: "2026-10-01", value: 3 },
					{ label: "2026-09-30", value: 99 },
				],
				keys,
			),
		).toEqual([
			{ label: "2026-10-01", value: 5 },
			{ label: "2026-10-02", value: 0 },
			{ label: "2026-10-03", value: 0 },
		]);
	});
});

describe("buildStackedSeries", () => {
	const keys = ["2026-10-01", "2026-10-02"];
	const rows = [
		{ label: "2026-10-01", source: "scheduled", count: 3, grams: 300 },
		{ label: "2026-10-01", source: "button", count: 1, grams: 80 },
		{ label: "2026-10-02", source: "dashboard", count: 2, grams: 200 },
	];

	it("builds one row per day with a column per source, in first-seen order", () => {
		const stack = buildStackedSeries(rows, keys);
		expect(stack.sources).toEqual(["scheduled", "button", "dashboard"]);
		expect(stack.rows).toEqual([
			{ label: "2026-10-01", scheduled: 3, button: 1, dashboard: 0 },
			{ label: "2026-10-02", scheduled: 0, button: 0, dashboard: 2 },
		]);
		expect(stack.totalsBySource).toEqual({ scheduled: 3, button: 1, dashboard: 2 });
	});

	it("can stack grams instead of counts", () => {
		const stack = buildStackedSeries(rows, keys, { value: "grams" });
		expect(stack.rows[0]).toEqual({
			label: "2026-10-01",
			scheduled: 300,
			button: 80,
			dashboard: 0,
		});
		expect(stack.totalsBySource.dashboard).toBe(200);
	});

	it("labels a missing source as unknown", () => {
		const stack = buildStackedSeries(
			[{ label: "2026-10-01", source: "", count: 2, grams: 20 }],
			["2026-10-01"],
		);
		expect(stack.sources).toEqual(["unknown"]);
	});
});

describe("series helpers", () => {
	const points = [
		{ label: "2026-10-01", value: 2 },
		{ label: "2026-10-02", value: 9 },
		{ label: "2026-10-03", value: 4 },
	];

	it("summarizes total, peak and point count", () => {
		expect(summarize(points)).toEqual({
			total: 15,
			peak: { label: "2026-10-02", value: 9 },
			points: 3,
		});
		expect(peakPoint([])).toBeNull();
		expect(sumValues([])).toBe(0);
	});

	it("formats axis days and shares", () => {
		expect(formatAxisDay("2026-10-05")).toBe("10-05");
		expect(formatAxisDay("Oct 5")).toBe("Oct 5");
		expect(sharePct(1, 4)).toBe(25);
		expect(sharePct(1, 0)).toBe(0);
	});

	it("shortens an hourly bucket to the hour and keeps the day it belongs to", () => {
		expect(formatAxisDay("2026-10-05 14:00")).toBe("14:00");
		expect(formatAxisDay("2026-10-05 00:00")).toBe("00:00");
		expect(formatAxisDay("2026-10-05 14:30")).toBe("2026-10-05 14:30");
	});
});

describe("buildMultiSeries", () => {
	const keys = ["2026-10-01", "2026-10-02", "2026-10-03"];

	it("puts one line per series and leaves unsampled buckets as gaps", () => {
		const multi = buildMultiSeries(
			[
				{ label: "2026-10-01", series: "Batch A", value: 12 },
				{ label: "2026-10-02", series: "Batch B", value: 20 },
				{ label: "2026-10-03", series: "Batch A", value: 18 },
			],
			keys,
		);

		expect(multi.series).toEqual(["Batch A", "Batch B"]);
		expect(multi.rows).toEqual([
			{ label: "2026-10-01", "Batch A": 12, "Batch B": null },
			{ label: "2026-10-02", "Batch A": null, "Batch B": 20 },
			{ label: "2026-10-03", "Batch A": 18, "Batch B": null },
		]);
	});

	it("keeps series in first-seen order and drops buckets outside the window", () => {
		const multi = buildMultiSeries(
			[
				{ label: "2026-10-03", series: "Late", value: 5 },
				{ label: "2026-09-30", series: "Old", value: 99 },
			],
			keys,
		);

		expect(multi.series).toEqual(["Late", "Old"]);
		expect(multi.rows.map((row) => row.label)).toEqual(keys);
		expect(multi.rows[0].Old).toBeNull();
	});

	it("replaces a duplicate bucket rather than summing averages", () => {
		const multi = buildMultiSeries(
			[
				{ label: "2026-10-01", series: "A", value: 10 },
				{ label: "2026-10-01", series: "A", value: 14 },
			],
			["2026-10-01"],
		);

		expect(multi.rows[0].A).toBe(14);
		expect(countSeriesValues(multi)).toBe(1);
	});

	it("counts only real readings, not gaps", () => {
		const multi = buildMultiSeries(
			[
				{ label: "2026-10-01", series: "A", value: 1 },
				{ label: "2026-10-02", series: "B", value: 2 },
				{ label: "2026-10-03", series: "A", value: 3 },
			],
			keys,
		);

		expect(countSeriesValues(multi)).toBe(3);
		expect(countSeriesValues({ series: [], rows: [] })).toBe(0);
	});
});
