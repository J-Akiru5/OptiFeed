import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { analyticsMock, statusBandsMock } = vi.hoisted(() => ({
	analyticsMock: vi.fn(),
	statusBandsMock: vi.fn(),
}));

vi.mock("@/lib/platform/analytics", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@/lib/platform/analytics")>();
	return { ...actual, getPlatformAnalytics: analyticsMock };
});
// The status bands own database queries and are covered by
// lib/__tests__/status-bands.test.ts; this file only renders the page.
vi.mock("@/lib/platform/status-bands", () => ({ getStatusBands: statusBandsMock }));
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

import SuperadminOverviewPage from "@/app/[locale]/(superadmin)/superadmin/page";
import type { PlatformAnalytics } from "@/lib/platform/analytics";

const analytics: PlatformAnalytics = {
	range: 7,
	window: {
		start: new Date("2026-10-20T12:00:00.000Z"),
		end: new Date("2026-10-27T12:00:00.000Z"),
		previousStart: new Date("2026-10-13T12:00:00.000Z"),
		previousEnd: new Date("2026-10-20T12:00:00.000Z"),
	},
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
});

describe("/superadmin analytics overview (E16.1)", () => {
	it("renders the KPI row with trend arrows and the selected range", async () => {
		const html = renderToStaticMarkup(await page("7"));

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
		expect(html).toContain('href="/superadmin?range=30"');
		expect(html).toContain('aria-current="page"');
	});

	it("renders every chart with an accessible summary and a hidden data table", async () => {
		const html = renderToStaticMarkup(await page());

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
		const html = renderToStaticMarkup(await page());

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

		const html = renderToStaticMarkup(await page());

		expect(html).toContain("No data in this period.");
		expect(html).toContain("Every feeder reported recently.");
		expect(html).toContain("No failed jobs.");
	});
});
