import { describe, expect, it } from "vitest";

import {
	feedHeatmapRows,
	feedTreemap,
	growthStack,
	rangeAnchor,
	recentActivity,
} from "@/lib/platform/command-center-series";
import type { PlatformFeedBreakdown, PlatformFeedHeatmap } from "@/lib/platform/feed-analytics";
import type { GrowthSeries } from "@/lib/platform/growth";

const DAYS = ["2026-10-25", "2026-10-26", "2026-10-27"];

function growth(over: Partial<GrowthSeries> = {}): GrowthSeries {
	return {
		range: 7,
		window: {
			start: new Date("2026-10-21T00:00:00.000Z"),
			end: new Date("2026-10-27T12:00:00.000Z"),
			previousStart: new Date("2026-10-14T00:00:00.000Z"),
			previousEnd: new Date("2026-10-21T00:00:00.000Z"),
		},
		dayKeys: DAYS,
		series: {
			users: [
				{ label: DAYS[0], value: 4 },
				{ label: DAYS[1], value: 0 },
				{ label: DAYS[2], value: 1 },
			],
			organizations: [
				{ label: DAYS[0], value: 1 },
				{ label: DAYS[1], value: 0 },
				{ label: DAYS[2], value: 2 },
			],
			ponds: [
				{ label: DAYS[0], value: 0 },
				{ label: DAYS[1], value: 3 },
				{ label: DAYS[2], value: 0 },
			],
			devices: [
				{ label: DAYS[0], value: 2 },
				{ label: DAYS[1], value: 0 },
				{ label: DAYS[2], value: 0 },
			],
		},
		totals: { users: 5, organizations: 3, ponds: 3, devices: 2 },
		...over,
	};
}

describe("growthStack", () => {
	it("aligns every day key to one row and keeps users out of the stack", () => {
		const stack = growthStack(growth());

		expect(stack.sources).toEqual(["organizations", "ponds", "devices"]);
		expect(stack.rows).toEqual([
			{ label: DAYS[0], organizations: 1, ponds: 0, devices: 2 },
			{ label: DAYS[1], organizations: 0, ponds: 3, devices: 0 },
			{ label: DAYS[2], organizations: 2, ponds: 0, devices: 0 },
		]);
		expect(stack.totalsBySource).toEqual({ organizations: 3, ponds: 3, devices: 2 });
	});

	it("keeps a quiet day as a real zero from the query, not a shifted column", () => {
		const stack = growthStack(growth());

		expect(stack.rows[1]).toMatchObject({ label: DAYS[1], organizations: 0 });
	});

	it("returns no rows for an empty window", () => {
		const stack = growthStack(growth({ dayKeys: [] }));

		expect(stack.rows).toEqual([]);
		expect(stack.totalsBySource).toEqual({ organizations: 0, ponds: 0, devices: 0 });
	});
});

function breakdown(over: Partial<PlatformFeedBreakdown> = {}): PlatformFeedBreakdown {
	const window = {
		start: new Date("2026-10-21T00:00:00.000Z"),
		end: new Date("2026-10-27T12:00:00.000Z"),
		previousStart: new Date("2026-10-14T00:00:00.000Z"),
		previousEnd: new Date("2026-10-21T00:00:00.000Z"),
	};
	return {
		range: 7,
		window,
		totals: { operations: 10, grams: 2500, kg: 2.5 },
		byOrg: [
			{
				key: "org-1",
				label: "Cebu Farms",
				orgId: "org-1",
				orgName: "Cebu Farms",
				pondId: null,
				pondName: null,
				operations: 6,
				grams: 1500,
				kg: 1.5,
			},
			{
				key: "__unattributed__",
				label: "Unattributed",
				orgId: null,
				orgName: null,
				pondId: null,
				pondName: null,
				operations: 4,
				grams: 1000,
				kg: 1,
			},
		],
		byPond: [
			{
				key: "pond-1",
				label: "Pond One",
				orgId: "org-1",
				orgName: "Cebu Farms",
				pondId: "pond-1",
				pondName: "Pond One",
				operations: 6,
				grams: 1500,
				kg: 1.5,
			},
			{
				key: "pond-2",
				label: "Pond Two",
				orgId: null,
				orgName: null,
				pondId: "pond-2",
				pondName: "Pond Two",
				operations: 4,
				grams: 1000,
				kg: 1,
			},
		],
		unattributed: { operations: 4, grams: 1000, kg: 1 },
		...over,
	};
}

describe("feedTreemap", () => {
	it("nests each pond under its organization and keeps the unattributed slice", () => {
		const nodes = feedTreemap(breakdown());

		expect(nodes).toEqual([
			{ name: "Cebu Farms", value: 1.5, children: [{ name: "Pond One", value: 1.5 }] },
			{ name: "Unattributed", value: 1, children: [{ name: "Pond Two", value: 1 }] },
		]);
	});

	it("sizes a parent by its children so the tiles cannot overflow", () => {
		const nodes = feedTreemap(
			breakdown({
				byPond: [
					{
						key: "pond-1",
						label: "Pond One",
						orgId: "org-1",
						orgName: "Cebu Farms",
						pondId: "pond-1",
						pondName: "Pond One",
						operations: 2,
						grams: 333.33,
						kg: 0.33,
					},
					{
						key: "pond-3",
						label: "Pond Three",
						orgId: "org-1",
						orgName: "Cebu Farms",
						pondId: "pond-3",
						pondName: "Pond Three",
						operations: 4,
						grams: 1166.67,
						kg: 1.17,
					},
				],
			}),
		);

		// 0.33 + 1.17 = 1.5, matching the organization total after rounding.
		expect(nodes[0]).toMatchObject({ name: "Cebu Farms", value: 1.5 });
	});

	it("returns an empty hierarchy when nothing was dispensed", () => {
		expect(feedTreemap(breakdown({ byOrg: [], byPond: [] }))).toEqual([]);
	});
});

function heatmap(over: Partial<PlatformFeedHeatmap> = {}): PlatformFeedHeatmap {
	return {
		range: 7,
		window: breakdown().window,
		cells: [
			{ day: DAYS[1], hour: 8, operations: 5, grams: 500 },
			{ day: DAYS[2], hour: 17, operations: 2, grams: 200 },
			{ day: DAYS[2], hour: 17, operations: 1, grams: 100 },
		],
		dayKeys: DAYS,
		maxOperations: 5,
		...over,
	};
}

describe("feedHeatmapRows", () => {
	it("fills a 24-hour row for every day key from the sparse cells", () => {
		const rows = feedHeatmapRows(heatmap());

		expect(rows.map((row) => row.date)).toEqual(DAYS);
		expect(rows[0].values.every((value) => value === 0)).toBe(true);
		expect(rows[1].values[8]).toBe(5);
		// Two cells in the same hour are summed, not overwritten.
		expect(rows[2].values[17]).toBe(3);
		expect(rows.every((row) => row.values.length === 24)).toBe(true);
	});

	it("drops cells outside the returned day keys and impossible hours", () => {
		const rows = feedHeatmapRows(
			heatmap({
				cells: [
					{ day: "2026-10-01", hour: 8, operations: 4, grams: 10 },
					{ day: DAYS[0], hour: 24, operations: 4, grams: 10 },
					{ day: DAYS[0], hour: -1, operations: 4, grams: 10 },
				],
			}),
		);

		expect(rows.every((row) => row.values.every((value) => value === 0))).toBe(true);
	});

	it("returns no rows for an empty window", () => {
		expect(feedHeatmapRows(heatmap({ dayKeys: [], cells: [] }))).toEqual([]);
	});
});

describe("recentActivity", () => {
	const job = {
		id: "job-1",
		type: "export_csv",
		error: "timeout",
		at: new Date("2026-10-27T01:00:00.000Z"),
	};
	const pending = {
		id: "device-1",
		label: "Feeder C",
		mac: "CC:DD",
		createdAt: new Date("2026-10-26T00:00:00.000Z"),
	};

	it("merges both sources newest first", () => {
		const events = recentActivity({ failedJobs: [job], pendingDevices: [pending] });

		expect(events.map((event) => event.id)).toEqual(["job-job-1", "device-device-1"]);
		expect(events[0]).toMatchObject({ kind: "failedJob", jobType: "export_csv", error: "timeout" });
		expect(events[1]).toMatchObject({ kind: "pendingDevice", label: "Feeder C", mac: "CC:DD" });
	});

	it("keeps the newest events only", () => {
		const older = { ...job, id: "job-0", at: new Date("2026-10-20T00:00:00.000Z") };
		const events = recentActivity({ failedJobs: [older, job], pendingDevices: [pending] }, 1);

		expect(events).toHaveLength(1);
		expect(events[0].id).toBe("job-job-1");
	});

	it("drops a row whose timestamp cannot be read instead of dating it now", () => {
		const events = recentActivity({
			failedJobs: [{ ...job, at: new Date("not a date") }],
			pendingDevices: [],
		});

		expect(events).toEqual([]);
	});

	it("returns nothing when there is no activity", () => {
		expect(recentActivity({ failedJobs: [], pendingDevices: [] })).toEqual([]);
	});
});

describe("rangeAnchor", () => {
	it("anchors the presets at noon of the newest bucket", () => {
		const anchor = rangeAnchor(DAYS);

		expect(anchor).toBeInstanceOf(Date);
		expect(anchor?.getFullYear()).toBe(2026);
		expect(anchor?.getMonth()).toBe(9);
		expect(anchor?.getDate()).toBe(27);
		expect(anchor?.getHours()).toBe(12);
	});

	it("falls back to the chart layer's own clock when there is no day", () => {
		expect(rangeAnchor([])).toBeUndefined();
		expect(rangeAnchor(["not-a-day"])).toBeUndefined();
	});
});
