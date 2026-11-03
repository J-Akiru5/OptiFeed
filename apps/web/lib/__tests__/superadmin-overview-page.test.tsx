import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
	analyticsMock,
	statusBandsMock,
	growthMock,
	feedBreakdownMock,
	feedHeatmapMock,
	fleetMonitorMock,
} = vi.hoisted(() => ({
	analyticsMock: vi.fn(),
	statusBandsMock: vi.fn(),
	growthMock: vi.fn(),
	feedBreakdownMock: vi.fn(),
	feedHeatmapMock: vi.fn(),
	fleetMonitorMock: vi.fn(),
}));

vi.mock("@/lib/platform/analytics", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@/lib/platform/analytics")>();
	return { ...actual, getPlatformAnalytics: analyticsMock };
});
// The status bands own database queries and are covered by
// lib/__tests__/status-bands.test.ts; this file only renders the page.
vi.mock("@/lib/platform/status-bands", () => ({ getStatusBands: statusBandsMock }));
// Sections C–G (#707). Each read model is covered by its own suite; here the
// page must be shown to *use* them, and to survive each one failing.
vi.mock("@/lib/platform/growth", () => ({ getGrowthSeries: growthMock }));
vi.mock("@/lib/platform/feed-analytics", () => ({
	getFeedBreakdown: feedBreakdownMock,
	getFeedHeatmap: feedHeatmapMock,
}));
vi.mock("@/lib/platform/fleet-health", () => ({ getFleetMonitor: fleetMonitorMock }));
vi.mock("@/lib/auth/require-platform-admin", () => ({ requirePlatformAdmin: vi.fn() }));
vi.mock("next-intl/server", async () => {
	const { createTranslator } = await import("./helpers/messages");
	return {
		getLocale: async () => "en",
		getTranslations: async (namespace: string) => createTranslator(namespace),
	};
});
vi.mock("@/i18n/routing", async () => {
	const react = await import("react");
	return {
		Link: ({ href, children, ...rest }: { href: unknown; children?: React.ReactNode }) =>
			react.createElement("a", { href: typeof href === "string" ? href : "#", ...rest }, children),
		getPathname: ({ href }: { href: string }) => href,
	};
});
// The command center's range frame writes the preset into the URL.
vi.mock("next/navigation", () => ({
	useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }),
	usePathname: () => "/en/superadmin",
}));

import SuperadminOverviewPage from "@/app/[locale]/(superadmin)/superadmin/page";
import type { PlatformAnalytics } from "@/lib/platform/analytics";
import type { PlatformFeedBreakdown, PlatformFeedHeatmap } from "@/lib/platform/feed-analytics";
import type { FleetMonitor } from "@/lib/platform/fleet-health";
import type { DeviceTelemetryRow, TenantFleetRow } from "@/lib/platform/fleet-health-rules";
import type { GrowthSeries } from "@/lib/platform/growth";
import { renderPageHtml as renderPage } from "./helpers/render-page";

/**
 * The command center renders three of its charts, six of its panels and its
 * range control through `charts/lazy` and the shared range provider (#707), so
 * the page is rendered with the streaming server renderer: `renderToStaticMarkup`
 * stops at the Suspense fallback and would only ever assert the skeletons.
 */

/** The 90 completed UTC days the connectivity panel expects, oldest first. */
const WINDOW_DAYS = Array.from({ length: 90 }, (_, index) =>
	new Date(Date.UTC(2026, 7, 4 + index)).toISOString().slice(0, 10),
);

const window = {
	start: new Date("2026-10-20T12:00:00.000Z"),
	end: new Date("2026-10-27T12:00:00.000Z"),
	previousStart: new Date("2026-10-13T12:00:00.000Z"),
	previousEnd: new Date("2026-10-20T12:00:00.000Z"),
};

const analytics: PlatformAnalytics = {
	range: 7,
	window,
	dayKeys: ["2026-10-25", "2026-10-26", "2026-10-27"],
	kpis: {
		users: { total: 140, newInRange: 5, previousNew: 4, deltaPct: 25, direction: "up" },
		organizations: { total: 12, newInRange: 1, previousNew: 2, deltaPct: -50, direction: "down" },
		ponds: { total: 30, newInRange: 2, previousNew: 1, deltaPct: 100, direction: "up" },
		feedersOnline: {
			total: 4,
			online: 3,
			pct: 75,
			previousPct: 80,
			deltaPct: -5,
			direction: "down",
		},
		feeds: { total: 5, previous: 4, deltaPct: 25, direction: "up" },
		kgDispensed: { total: 2.5, previous: 1, deltaPct: 150, direction: "up" },
		openAlerts: { total: 3, newInRange: 2, previousNew: 1, deltaPct: 100, direction: "up" },
		pendingApprovals: { total: 1, newInRange: 1, previousNew: 0, deltaPct: null, direction: "up" },
	},
	signupsPerDay: [
		{ label: "2026-10-25", value: 3 },
		{ label: "2026-10-26", value: 0 },
		{ label: "2026-10-27", value: 2 },
	],
	feedsPerDayBySource: {
		sources: ["scheduled", "button"],
		rows: [
			{ label: "2026-10-25", scheduled: 2, button: 0 },
			{ label: "2026-10-26", scheduled: 0, button: 1 },
			{ label: "2026-10-27", scheduled: 1, button: 1 },
		],
		totalsBySource: { scheduled: 3, button: 2 },
	},
	kgPerDay: [
		{ label: "2026-10-25", value: 1 },
		{ label: "2026-10-26", value: 0 },
		{ label: "2026-10-27", value: 1.5 },
	],
	deviceSplit: [
		{ name: "online", segment: "online", value: 3 },
		{ name: "offline", segment: "offline", value: 1 },
	],
	alertsByType: [{ type: "disconnected", count: 6 }],
	topFcrPonds: [
		{
			pondId: "pond-1",
			pondName: "Pond One",
			fcrValue: 2.1,
			periodEnd: new Date("2026-10-20T00:00:00.000Z"),
		},
	],
	mostOfflineFeeders: [
		{ id: "d1", label: "Feeder A", mac: "AA:BB", lastSeenAt: null, pondName: null },
	],
	pendingApprovalDevices: [
		{ id: "d3", label: "Feeder C", mac: "CC:DD", createdAt: new Date("2026-10-26T00:00:00.000Z") },
	],
	failedJobs: [
		{
			id: "job-1",
			type: "export_csv",
			error: "timeout",
			at: new Date("2026-10-27T01:00:00.000Z"),
		},
	],
	connectivity: {
		registered: 12,
		active30d: 9,
		activePct: 75,
		activeWindowDays: 30,
		activeCutoff: new Date("2026-09-27T12:00:00.000Z"),
		windowDays: WINDOW_DAYS,
		// Two stored days out of 90; 2026-10-28 is deliberately absent.
		trend: [
			{
				day: "2026-10-27",
				devicesReporting: 4,
				onlineMinutes: 900,
				observedMinutes: 1200,
				gapCount: 1,
				heartbeatCount: 900,
				onlineSharePct: 75,
			},
			{
				day: "2026-10-30",
				devicesReporting: 5,
				onlineMinutes: 600,
				observedMinutes: 1000,
				gapCount: 2,
				heartbeatCount: 1200,
				onlineSharePct: 60,
			},
		],
		daysWithoutData: 88,
	},
};

const growth: GrowthSeries = {
	range: 7,
	window,
	dayKeys: ["2026-10-25", "2026-10-26", "2026-10-27"],
	series: {
		users: [
			{ label: "2026-10-25", value: 3 },
			{ label: "2026-10-26", value: 0 },
			{ label: "2026-10-27", value: 2 },
		],
		organizations: [
			{ label: "2026-10-25", value: 1 },
			{ label: "2026-10-26", value: 0 },
			{ label: "2026-10-27", value: 2 },
		],
		ponds: [
			{ label: "2026-10-25", value: 0 },
			{ label: "2026-10-26", value: 1 },
			{ label: "2026-10-27", value: 0 },
		],
		devices: [
			{ label: "2026-10-25", value: 2 },
			{ label: "2026-10-26", value: 0 },
			{ label: "2026-10-27", value: 0 },
		],
	},
	totals: { users: 5, organizations: 3, ponds: 1, devices: 2 },
};

const feedBreakdown: PlatformFeedBreakdown = {
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
};

const heatmap: PlatformFeedHeatmap = {
	range: 7,
	window,
	cells: [
		{ day: "2026-10-26", hour: 8, operations: 5, grams: 500 },
		{ day: "2026-10-27", hour: 17, operations: 3, grams: 300 },
	],
	dayKeys: ["2026-10-25", "2026-10-26", "2026-10-27"],
	maxOperations: 5,
};

function device(over: Partial<DeviceTelemetryRow>): DeviceTelemetryRow {
	return {
		id: "device-1",
		label: "Feeder A",
		mac: "AA:BB",
		pondName: "Pond One",
		tenantId: "org-1",
		tenantName: "Cebu Farms",
		connection: "online",
		lastHeartbeatAt: new Date("2026-10-27T11:00:00.000Z"),
		rssiDbm: -62,
		rssiFreshness: "fresh",
		rssiAt: new Date("2026-10-27T11:00:00.000Z"),
		firmware: { version: "1.6.0", at: new Date("2026-10-27T11:00:00.000Z"), source: "diag" },
		lastFeedAt: new Date("2026-10-27T09:00:00.000Z"),
		feedLevel: { percent: 72, at: new Date("2026-10-27T11:00:00.000Z"), freshness: "fresh" },
		waterTemp: {
			celsius: 28.4,
			at: new Date("2026-10-27T11:00:00.000Z"),
			freshness: "fresh",
			probeOk: true,
		},
		health: { safeMode: false, faults: [], since: new Date("2026-10-20T00:00:00.000Z") },
		...over,
	};
}

const tenantRow: TenantFleetRow = {
	tenantId: "org-1",
	tenantName: "Cebu Farms",
	total: 3,
	reporting: 3,
	online: 2,
	weak: 0,
	offline: 1,
	offlinePct: 33.3,
	lastHeartbeatAt: new Date("2026-10-27T11:00:00.000Z"),
	state: "degraded",
	devices: [
		device({ id: "device-1", label: "Feeder A" }),
		device({
			id: "device-2",
			label: "Feeder B",
			feedLevel: { percent: 20, at: null, freshness: "stale" },
			waterTemp: null,
			health: { safeMode: false, faults: ["rtc"], since: new Date("2026-10-26T00:00:00.000Z") },
		}),
		device({
			id: "device-3",
			label: "Feeder C",
			connection: "offline",
			lastHeartbeatAt: null,
			rssiDbm: null,
			rssiFreshness: "none",
			rssiAt: null,
			feedLevel: { percent: null, at: null, freshness: "none" },
			waterTemp: null,
			health: null,
		}),
	],
};

const fleet: FleetMonitor = {
	checkedAt: new Date("2026-10-27T12:00:00.000Z"),
	policy: {
		offlineAfterMs: 300_000,
		graceMs: 10_000,
		weakAfterMs: 120_000,
	},
	rows: [
		{
			...tenantRow,
			devices: [
				tenantRow.devices[0],
				{
					...tenantRow.devices[1],
					health: {
						safeMode: false,
						faults: ["hopper_sensor"],
						since: new Date("2026-10-26T00:00:00.000Z"),
					},
				},
				tenantRow.devices[2],
			],
		},
	],
	summary: { state: "degraded", counts: { ok: 0, degraded: 1, critical: 0, unknown: 0 } },
	totalDevices: 3,
	truncated: false,
	sourceError: false,
};

function page(range = "7") {
	return SuperadminOverviewPage({ searchParams: Promise.resolve({ range }) });
}

const statusBands = {
	checkedAt: new Date("2026-10-27T12:00:00.000Z"),
	bands: [
		{
			key: "platform" as const,
			state: "degraded" as const,
			facts: [{ key: "failedJobs", state: "degraded" as const, value: 1, threshold: 10 }],
		},
		{
			key: "tenants" as const,
			state: "ok" as const,
			facts: [{ key: "organizations", state: "ok" as const, value: 12, threshold: null }],
		},
		{
			key: "devices" as const,
			state: "unknown" as const,
			facts: [{ key: "offlineDevices", state: "unknown" as const, value: null, threshold: 50 }],
		},
		{
			key: "security" as const,
			state: "ok" as const,
			facts: [{ key: "lockouts", state: "ok" as const, value: 0, threshold: 1 }],
		},
	],
};

beforeEach(() => {
	vi.clearAllMocks();
	analyticsMock.mockResolvedValue(analytics);
	statusBandsMock.mockResolvedValue(statusBands);
	growthMock.mockResolvedValue(growth);
	feedBreakdownMock.mockResolvedValue(feedBreakdown);
	feedHeatmapMock.mockResolvedValue(heatmap);
	fleetMonitorMock.mockResolvedValue(fleet);
});

describe("/superadmin analytics overview (E16.1)", () => {
	it("renders the KPI row with trend arrows and the selected range", async () => {
		const html = await renderPage(await page("7"));

		expect(html.split("<h1").length - 1).toBe(1);
		expect(html).toContain("Platform Overview");
		// M3C.2: the four status bands render above the KPI row.
		expect(html).toContain("Platform status");
		expect(html).toContain("Degraded");
		expect(html).toContain("Unknown");
		expect(html).toContain("last 7 days");
		for (const label of [
			"Users",
			"Organizations",
			"Ponds",
			"Feeders online",
			"Feeds",
			"Feed dispensed",
			"Open alerts",
			"Pending approvals",
		]) {
			expect(html).toContain(label);
		}
		expect(html).toContain("75%");
		expect(html).toContain("25% up on the previous period");
		// #707: the shared control replaced the three preset links.
		expect(html).toContain('aria-pressed="true"');
		expect(html).toContain(">7 days<");
		expect(html).toContain(">30 days<");
		expect(html).toContain(">90 days<");
		expect(html).toContain(">Custom<");
	});

	it("renders every pre-existing chart with an accessible summary and a hidden data table", async () => {
		const html = await renderPage(await page());

		for (const title of [
			"New users per day",
			"Feeds per day",
			"Feed dispensed per day",
			"Fleet status",
			"Alerts by type",
		]) {
			expect(html).toContain(title);
		}
		expect(html).toContain('role="img"');
		expect(html).toContain("New users per day: 3 days, 5 new accounts");
		expect(html).toContain('<th scope="col">Date</th>');
		expect(html).toContain('<th scope="row">2026-10-27</th>');
	});

	it("lists offline feeders, pending approvals, failed jobs and FCR", async () => {
		const html = await renderPage(await page());

		expect(html).toContain("Needs attention");
		expect(html).toContain("Most offline feeders");
		expect(html).toContain("Feeder A");
		expect(html).toContain("Never seen");
		expect(html).toContain("Feeder C");
		expect(html).toContain("export_csv");
		expect(html).toContain("timeout");
		expect(html).toContain("Pond One");
		expect(html).toContain("FCR 2.10");
	});

	it("renders registered versus active and the stored connectivity trend", async () => {
		const html = await renderPage(await page());

		expect(html).toContain("Registered versus active devices");
		expect(html).toContain("Registered devices");
		expect(html).toContain("Active (30 days)");
		expect(html).toContain("9 of 12 registered devices");
		expect(html).toContain("2 of 90 days have stored history");
		expect(html).toContain("average online share");
		// Only stored days reach the accessible table; the quiet day is absent.
		expect(html).toContain('<th scope="row">2026-10-30</th>');
		expect(html).not.toContain('<th scope="row">2026-10-28</th>');
		expect(html).toContain("Days are UTC calendar days");
	});

	it("says there is no connectivity history instead of drawing a zero line", async () => {
		analyticsMock.mockResolvedValueOnce({
			...analytics,
			connectivity: {
				...analytics.connectivity,
				registered: 0,
				activePct: null,
				active30d: 0,
				trend: [],
				daysWithoutData: 90,
			},
		});

		const html = await renderPage(await page());

		expect(html).toContain("No stored connectivity history yet.");
		expect(html).toContain("No device is registered yet");
		expect(html).not.toContain("average online share");
	});

	it("keeps an empty range readable instead of rendering a blank chart", async () => {
		analyticsMock.mockResolvedValueOnce({
			...analytics,
			dayKeys: [],
			signupsPerDay: [],
			feedsPerDayBySource: { sources: [], rows: [], totalsBySource: {} },
			kgPerDay: [],
			deviceSplit: [
				{ name: "online", segment: "online", value: 0 },
				{ name: "offline", segment: "offline", value: 0 },
			],
			alertsByType: [],
			mostOfflineFeeders: [],
			pendingApprovalDevices: [],
			failedJobs: [],
			topFcrPonds: [],
		});
		growthMock.mockResolvedValueOnce({ ...growth, dayKeys: [] });
		feedBreakdownMock.mockResolvedValueOnce({
			...feedBreakdown,
			byOrg: [],
			byPond: [],
			totals: { operations: 0, grams: 0, kg: 0 },
		});
		feedHeatmapMock.mockResolvedValueOnce({ ...heatmap, cells: [], dayKeys: [], maxOperations: 0 });
		fleetMonitorMock.mockResolvedValueOnce({ ...fleet, rows: [], totalDevices: 0 });

		const html = await renderPage(await page());

		expect(html).toContain("No data in this period.");
		expect(html).toContain("Every feeder reported recently.");
		expect(html).toContain("No failed jobs.");
	});
});

describe("/superadmin command center sections C–G (#707)", () => {
	it("renders growth, feed breakdown, heatmap, freshness, faults and activity from the read models", async () => {
		const html = await renderPage(await page("7"));

		// Section G — registrations per day, one stacked band per kind.
		expect(html).toContain("Growth and consumption");
		expect(html).toContain("New organizations, ponds and devices per day");
		expect(html).toContain("Registrations per day: 6 new in this period, highest 3 on 2026-10-25.");
		expect(html).toContain("Feeders</span>");

		// Section D/E — organization → pond hierarchy sized by mass.
		expect(html).toContain("Feed dispensed by organization");
		expect(html).toContain("Feed dispensed by organization: 2.5 kg across 2 organizations.");
		expect(html).toContain("Cebu Farms / Pond One");
		expect(html).toContain("Unattributed / Pond Two");

		// Section E — day × hour grid from the sparse cells.
		expect(html).toContain("Feeding by day and hour");
		expect(html).toContain(
			"Feeding operations by day and hour: 5 in the busiest hour, 2 active hours.",
		);
		expect(html).toContain('data-testid="chart-heatmap-grid"');

		// Section C — freshness histogram and current faults.
		expect(html).toContain("Fleet telemetry");
		expect(html).toContain("Telemetry freshness");
		expect(html).toContain(
			"Telemetry freshness across 3 units: signal 2 fresh, feed level 1 fresh, water temperature 1 fresh.",
		);
		expect(html).toContain("Feed level readings fresh");
		expect(html).toContain("33%");
		expect(html).toContain("Units with a current fault");
		expect(html).toContain("Current faults: 1 of 3 units report hopper sensor (1).");

		// Section F/B — newest operational events, newest first.
		expect(html).toContain("Recent platform activity");
		expect(html).toContain("Recent platform activity: 2 events, newest first.");
		expect(html).toContain("export_csv job failed");
		expect(html).toContain("Feeder C is waiting for approval");
		expect(html).toContain('<th scope="col">Event</th>');
	});

	it("renders one explicit error per failed read and keeps the rest of the page", async () => {
		// The chart sections fail on their own; the overview must not become a 500
		// and must not draw an empty axis as if the numbers were zero.
		const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
		growthMock.mockRejectedValueOnce(new Error("growth down"));
		feedBreakdownMock.mockRejectedValueOnce(new Error("feed down"));
		feedHeatmapMock.mockRejectedValueOnce(new Error("heatmap down"));
		fleetMonitorMock.mockResolvedValueOnce({ ...fleet, sourceError: true, rows: [] });

		const html = await renderPage(await page("7"));

		expect(html).toContain("This section could not be loaded. Reload the page to try again.");
		expect(html).toContain("Platform Overview");
		expect(html).toContain("Needs attention");
		// The failed growth read also drops its KPI sparklines instead of showing 0.
		expect(html).not.toContain("New Organizations per day");
		quiet.mockRestore();
	});

	it("re-throws an auth redirect raised inside a read model", async () => {
		// requirePlatformAdmin() inside a loader redirects; swallowing that would
		// render the console (with "could not load" panels) to a non-admin.
		growthMock.mockRejectedValueOnce({
			digest: "NEXT_REDIRECT;replace;/en/dashboard;307;",
		});

		await expect(page("7")).rejects.toMatchObject({
			digest: "NEXT_REDIRECT;replace;/en/dashboard;307;",
		});
	});

	it("still draws a one-day window instead of the empty state", async () => {
		growthMock.mockResolvedValueOnce({
			...growth,
			dayKeys: ["2026-10-27"],
			series: {
				users: [{ label: "2026-10-27", value: 2 }],
				organizations: [{ label: "2026-10-27", value: 2 }],
				ponds: [{ label: "2026-10-27", value: 0 }],
				devices: [{ label: "2026-10-27", value: 0 }],
			},
			totals: { users: 2, organizations: 2, ponds: 0, devices: 0 },
		});

		const html = await renderPage(await page("7"));

		expect(html).toContain("Registrations per day: 2 new in this period, highest 2 on 2026-10-27.");
		expect(html).toContain('<th scope="row">2026-10-27</th>');
	});
});
