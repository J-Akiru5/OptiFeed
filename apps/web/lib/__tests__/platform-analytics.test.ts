import { beforeEach, describe, expect, it, vi } from "vitest";

const { db } = vi.hoisted(() => ({
	db: {
		user: { count: vi.fn() },
		organization: { count: vi.fn() },
		pond: { count: vi.fn() },
		energyDevice: { count: vi.fn(), findMany: vi.fn() },
		notification: { count: vi.fn() },
		feedEvent: { aggregate: vi.fn() },
		deviceStateEvent: { groupBy: vi.fn() },
		fcrReport: { findMany: vi.fn() },
		backgroundJob: { findMany: vi.fn() },
		$queryRaw: vi.fn(),
	},
}));

vi.mock("@/lib/prisma", () => ({ default: db }));
vi.mock("@/lib/auth/require-platform-admin", () => ({ requirePlatformAdmin: vi.fn() }));

import { requirePlatformAdmin } from "@/lib/auth/require-platform-admin";
import {
	ALERT_EVENT_TYPES,
	getPlatformAnalytics,
	parseAnalyticsRange,
	resolveAnalyticsWindow,
} from "@/lib/platform/analytics";

const mockGate = vi.mocked(requirePlatformAdmin);
const NOW = new Date("2026-10-27T12:00:00.000Z");
const TODAY = "2026-10-27";

function primeQueries() {
	db.user.count
		.mockResolvedValueOnce(140) // total
		.mockResolvedValueOnce(5) // new in window
		.mockResolvedValueOnce(4); // previous window
	db.organization.count.mockResolvedValueOnce(12).mockResolvedValueOnce(1).mockResolvedValueOnce(2);
	db.pond.count.mockResolvedValueOnce(30).mockResolvedValueOnce(2).mockResolvedValueOnce(1);
	db.energyDevice.count
		.mockResolvedValueOnce(4) // total
		.mockResolvedValueOnce(3) // online
		.mockResolvedValueOnce(1) // pending total
		.mockResolvedValueOnce(1) // pending new
		.mockResolvedValueOnce(0); // pending previous

	db.notification.count.mockResolvedValueOnce(3).mockResolvedValueOnce(2).mockResolvedValueOnce(1);

	db.feedEvent.aggregate
		.mockResolvedValueOnce({ _count: { _all: 5 }, _sum: { grams: 2500 } })
		.mockResolvedValueOnce({ _count: { _all: 4 }, _sum: { grams: 1000 } });

	db.$queryRaw.mockImplementation(async (strings: TemplateStringsArray) => {
		const sql = strings.join(" ");
		if (sql.includes('FROM "User"')) {
			return [
				{ day: "2026-10-25", total: 3 },
				{ day: TODAY, total: 2 },
			];
		}
		if (sql.includes('FROM "FeedEvent"')) {
			return [
				{ day: TODAY, source: "scheduled", total: 3, grams: 1500 },
				{ day: TODAY, source: "button", total: 2, grams: 1000 },
				{ day: "2026-10-26", source: "dashboard", total: 1, grams: 500 },
				// An imported hand-fed daily total is charted by source but is
				// never counted as a machine dispense (#236).
				{ day: TODAY, source: "hand_fed", total: 1, grams: 1800 },
			];
		}
		return [];
	});

	db.deviceStateEvent.groupBy.mockImplementation(
		async (args: { where: { eventType: { in: string[] } } }) =>
			args.where.eventType.in.includes("pellet_low")
				? [
						{ eventType: "disconnected", _count: { _all: 6 } },
						{ eventType: "pellet_low", _count: { _all: 2 } },
					]
				: [
						{ eventType: "connected", _count: { _all: 8 } },
						{ eventType: "disconnected", _count: { _all: 2 } },
					],
	);

	db.fcrReport.findMany.mockResolvedValue([
		{
			pondId: "pond-1",
			fcrValue: 2.1,
			periodEnd: new Date("2026-10-20T00:00:00.000Z"),
			pond: { name: "Pond One" },
		},
		{
			pondId: "pond-1",
			fcrValue: 1.4,
			periodEnd: new Date("2026-10-01T00:00:00.000Z"),
			pond: { name: "Pond One" },
		},
		{
			pondId: "pond-2",
			fcrValue: 1.8,
			periodEnd: new Date("2026-10-18T00:00:00.000Z"),
			pond: { name: "Pond Two" },
		},
	]);

	db.energyDevice.findMany.mockImplementation(async (args: { where?: { OR?: unknown[] } }) => {
		if (args.where?.OR) {
			return [
				{ id: "d1", label: "A", mac: "aa", lastSeenAt: null, pond: null },
				{
					id: "d2",
					label: "B",
					mac: "bb",
					lastSeenAt: new Date("2026-10-20T00:00:00.000Z"),
					pond: { name: "Pond One" },
				},
			];
		}
		return [
			{
				id: "d3",
				label: "C",
				mac: "cc",
				createdAt: new Date("2026-10-26T00:00:00.000Z"),
			},
		];
	});

	db.backgroundJob.findMany.mockResolvedValue([
		{
			id: "job-1",
			type: "export_csv",
			error: "timeout",
			finishedAt: new Date("2026-10-27T01:00:00.000Z"),
			createdAt: new Date("2026-10-27T00:00:00.000Z"),
		},
	]);
}

beforeEach(() => {
	vi.resetAllMocks();
	mockGate.mockResolvedValue(undefined);
	primeQueries();
});

describe("parseAnalyticsRange", () => {
	it("accepts only 7, 30 and 90 and defaults to 30", () => {
		expect(parseAnalyticsRange("7")).toBe(7);
		expect(parseAnalyticsRange("90")).toBe(90);
		expect(parseAnalyticsRange("30")).toBe(30);
		expect(parseAnalyticsRange("14")).toBe(30);
		expect(parseAnalyticsRange(undefined)).toBe(30);
		expect(parseAnalyticsRange("abc")).toBe(30);
	});
});

describe("resolveAnalyticsWindow", () => {
	it("starts at farm-local midnight and keeps an equally long previous window", () => {
		const window = resolveAnalyticsWindow(7, NOW);
		expect(window.end).toEqual(NOW);
		expect(window.start.toISOString()).toBe("2026-10-20T16:00:00.000Z");
		expect(window.previousEnd).toEqual(window.start);
		expect(window.previousStart.toISOString()).toBe("2026-10-13T16:00:00.000Z");
	});
});

describe("getPlatformAnalytics", () => {
	it("gates before touching the database", async () => {
		mockGate.mockRejectedValueOnce(new Error("not a platform admin"));

		await expect(getPlatformAnalytics(30, NOW)).rejects.toThrow("not a platform admin");
		expect(db.user.count).not.toHaveBeenCalled();
		expect(db.$queryRaw).not.toHaveBeenCalled();
	});

	it("returns KPI totals with previous-period deltas", async () => {
		const result = await getPlatformAnalytics(7, NOW);

		expect(result.range).toBe(7);
		expect(result.kpis.users).toEqual({
			total: 140,
			newInRange: 5,
			previousNew: 4,
			deltaPct: 25,
			direction: "up",
		});
		expect(result.kpis.feedersOnline).toEqual({
			total: 4,
			online: 3,
			pct: 75,
			previousPct: 80,
			deltaPct: -5,
			direction: "down",
		});
		expect(result.kpis.feeds).toEqual({
			total: 5,
			previous: 4,
			deltaPct: 25,
			direction: "up",
		});
		expect(result.kpis.kgDispensed).toEqual({
			total: 2.5,
			previous: 1,
			deltaPct: 150,
			direction: "up",
		});
		expect(result.kpis.openAlerts).toMatchObject({ total: 3, newInRange: 2, previousNew: 1 });
		expect(result.kpis.pendingApprovals).toMatchObject({ total: 1, newInRange: 1, previousNew: 0 });
	});

	it("fills every day of the window and splits feeds by source", async () => {
		const result = await getPlatformAnalytics(7, NOW);

		expect(result.dayKeys).toHaveLength(7);
		expect(result.dayKeys.at(-1)).toBe(TODAY);
		expect(result.signupsPerDay).toHaveLength(7);
		expect(result.signupsPerDay.at(-1)).toEqual({ label: TODAY, value: 2 });
		expect(result.feedsPerDayBySource.sources).toEqual([
			"scheduled",
			"button",
			"dashboard",
			"hand_fed",
		]);
		expect(result.feedsPerDayBySource.totalsBySource).toEqual({
			scheduled: 3,
			button: 2,
			dashboard: 1,
			hand_fed: 1,
		});
		// Machine dispenses only: the 1,800 g hand-fed daily total is excluded.
		expect(result.kgPerDay.at(-1)).toEqual({ label: TODAY, value: 2.5 });
		expect(result.deviceSplit).toEqual([
			{ name: "online", segment: "online", value: 3 },
			{ name: "offline", segment: "offline", value: 1 },
		]);
		expect(result.alertsByType).toEqual([
			{ type: "disconnected", count: 6 },
			{ type: "pellet_low", count: 2 },
		]);
	});

	it("keeps one FCR row per pond and ranks the highest first", async () => {
		const result = await getPlatformAnalytics(30, NOW);

		expect(result.topFcrPonds).toEqual([
			{
				pondId: "pond-1",
				pondName: "Pond One",
				fcrValue: 2.1,
				periodEnd: new Date("2026-10-20T00:00:00.000Z"),
			},
			{
				pondId: "pond-2",
				pondName: "Pond Two",
				fcrValue: 1.8,
				periodEnd: new Date("2026-10-18T00:00:00.000Z"),
			},
		]);
	});

	it("puts never-seen feeders first in the needs-attention list", async () => {
		const result = await getPlatformAnalytics(30, NOW);

		expect(result.mostOfflineFeeders.map((device) => device.id)).toEqual(["d1", "d2"]);
		expect(result.pendingApprovalDevices).toHaveLength(1);
		expect(result.failedJobs[0]).toMatchObject({
			id: "job-1",
			type: "export_csv",
			error: "timeout",
		});
	});

	it("never selects a device token or token hash", async () => {
		await getPlatformAnalytics(30, NOW);

		for (const [args] of db.energyDevice.findMany.mock.calls) {
			const selection = JSON.stringify(args);
			expect(selection).not.toContain("tokenHash");
			expect(selection).not.toContain('"token"');
		}
	});

	it("buckets both charts on the Asia/Manila farm day", async () => {
		await getPlatformAnalytics(7, NOW);

		const sql = db.$queryRaw.mock.calls
			.map((call) => (call[0] as unknown as TemplateStringsArray).join(" "))
			.join(" | ");

		// The old double conversion shifted the first eight hours of each day
		// into the previous bucket; a single `AT TIME ZONE` on the zone keeps
		// `date_trunc` on a naive local timestamp.
		expect(sql).not.toContain("AT TIME ZONE 'UTC' AT TIME ZONE");
		expect(sql).toContain('"receivedAt" AT TIME ZONE');
	});

	it("counts only machine dispenses in the feed KPIs", async () => {
		await getPlatformAnalytics(7, NOW);

		for (const [args] of db.feedEvent.aggregate.mock.calls) {
			const where = (args as { where: { source?: { in: string[] } } }).where;
			expect(where.source?.in).toEqual(["scheduled", "dashboard", "button"]);
		}
	});

	it("only asks DeviceStateEvent for real alert types", async () => {
		await getPlatformAnalytics(30, NOW);

		const args = db.deviceStateEvent.groupBy.mock.calls[0][0] as {
			where: { eventType: { in: string[] } };
		};
		for (const type of args.where.eventType.in) {
			expect(ALERT_EVENT_TYPES).toContain(type);
		}
	});
});
