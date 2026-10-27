import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Renders the dashboard home page in the control-room layout (E14).
 *
 * The page is the one place where the shell, the pond canvas, the charts and
 * the right rail are assembled, so this test proves the composition works with
 * the real loaders mocked out and that the tour/help anchors survive.
 */

vi.mock("next-intl/server", async () => {
	const { createTranslator } = await import("./helpers/messages");
	const withRich = (namespace: string) => {
		const translate = createTranslator(namespace);
		return Object.assign(
			(key: string, values?: Record<string, string | number>) => translate(key, values),
			{
				rich: (key: string, values?: Record<string, string | number>) => translate(key, values),
				has: translate.has,
			},
		);
	};
	return {
		getTranslations: async (namespace: string) => withRich(namespace),
		getLocale: async () => "en",
	};
});

vi.mock("next-intl", async () => {
	const { createTranslator } = await import("./helpers/messages");
	const withRich = (namespace: string) => {
		const translate = createTranslator(namespace);
		return Object.assign(
			(key: string, values?: Record<string, string | number>) => translate(key, values),
			{
				rich: (key: string, values?: Record<string, string | number>) => translate(key, values),
				has: translate.has,
			},
		);
	};
	return { useTranslations: (namespace: string) => withRich(namespace), useLocale: () => "en" };
});

vi.mock("@/i18n/routing", () => ({
	Link: ({
		href,
		children,
		...rest
	}: {
		href: string | { pathname?: string };
		children?: ReactNode;
	} & Record<string, unknown>) => (
		<a href={typeof href === "string" ? href : (href?.pathname ?? "#")} {...rest}>
			{children}
		</a>
	),
	getPathname: ({ href }: { href: string }) => href,
	usePathname: () => "/dashboard",
	useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
	redirect: vi.fn(),
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

vi.mock("@/lib/auth/session", () => ({
	canWrite: vi.fn(async () => true),
	getCurrentUser: vi.fn(async () => ({ displayName: "Nong Juan" })),
	getCurrentPondOwnerId: vi.fn(async () => "farm-1"),
}));

vi.mock("@/lib/pond-selection", () => ({
	getActivePond: vi.fn(async () => ({
		id: "pond-1",
		name: "Demo Pond",
		ownerId: "farm-1",
		population: 1200,
		feedsPerDay: 3,
		feedingRatePct: 3,
		scheduleStart: new Date("2026-10-27T06:00:00Z"),
		scheduleEnd: new Date("2026-10-27T18:00:00Z"),
		isFallow: false,
		sampleIntervalDays: 14,
		energyDevices: [{ id: "dev-1", label: "CICT Feeder" }],
	})),
}));

vi.mock("@/lib/schedule/resolve-current", () => ({
	resolveCurrentSchedule: vi.fn(async () => null),
}));

// The low-hopper alert threshold is an org setting (#190); the page reads it
// through the farm → org chain. Keep the page test off the database.
vi.mock("@/lib/settings/org", async () => {
	const { ORG_SETTINGS_DEFAULTS } = await import("@/lib/settings/org-shared");
	return {
		ORG_SETTINGS_DEFAULTS,
		getOrgSettingsForFarm: vi.fn(async () => ({
			orgId: "org-1",
			settings: { ...ORG_SETTINGS_DEFAULTS },
		})),
	};
});

vi.mock("@/lib/pond-charts", () => ({
	getFeedPerDayBySource: vi.fn(async () => ({
		dayKeys: [],
		stack: { sources: [], rows: [], totalsBySource: {} },
	})),
	getHopperLevelSeries: vi.fn(async () => []),
	getWaterTempSeries: vi.fn(async () => []),
}));

vi.mock("@/lib/actions/energy", () => ({ requestFeed: vi.fn() }));
vi.mock("@/lib/actions/time", () => ({ setDeviceTime: vi.fn() }));
vi.mock("@/lib/actions/prediction", () => ({ applyPredictedGrams: vi.fn() }));

vi.mock("@/lib/prisma", () => ({
	default: {
		energyDevice: {
			findMany: vi.fn(async () => [
				{
					id: "dev-1",
					mac: "68:09:47:25:E1:80",
					label: "CICT Feeder",
					rtcOk: true,
					feederActive: true,
					isPaused: false,
					gramsPerFeeding: 330,
					gramsPerSecond: 12.5,
					lastSeenAt: new Date(),
					feedLevelPercent: 82,
					feedLevelUpdatedAt: new Date(),
					hopperCapacityG: 25000,
					lastCalibratedAt: new Date(),
					recalibrationIntervalDays: 30,
					waterTempC: 28.4,
					waterTempOk: true,
					waterTempUpdatedAt: new Date(),
				},
			]),
		},
		biomassLog: { findMany: vi.fn(async () => []) },
		fcrReport: { findMany: vi.fn(async () => []) },
		cropCycle: { findFirst: vi.fn(async () => null) },
		feedEvent: { findMany: vi.fn(async () => []) },
		feedLevelLog: { findMany: vi.fn(async () => []) },
		$queryRaw: vi.fn(async () => []),
	},
}));

import DashboardHomePage from "@/app/[locale]/(dashboard)/dashboard/page";
import prisma from "@/lib/prisma";

beforeEach(() => {
	vi.clearAllMocks();
});

describe("dashboard control room page", () => {
	it("assembles the viewport layout with the pond overview, charts and rail", async () => {
		const html = renderToStaticMarkup(
			await DashboardHomePage({ searchParams: Promise.resolve({}) }),
		);

		// One viewport shell and its independently scrolling rail.
		expect(html).toContain("xl:h-[calc(100dvh-8rem)]");
		expect(html).toContain('aria-label="Pond controls"');

		// Feeding strip first, with the tour and help anchors.
		expect(html).toContain('data-onboard="next-feeding"');
		expect(html).toContain('data-help="next-feeding"');

		// Pond canvas with the feeder pin.
		expect(html).toContain("Demo Pond");
		expect(html).toContain("CICT Feeder");
		expect(html).toContain("28.4 °C");

		// The three charts and the water-temperature range control.
		expect(html).toContain("Feed per day");
		expect(html).toContain("Hopper level");
		expect(html).toContain("Water temperature trend");
		expect(html).toContain('aria-label="Water temperature period"');

		// Rail sections and the surviving anchors.
		expect(html).toContain("Feed Level");
		expect(html).toContain("Water Temperature");
		expect(html).toContain("Pond at a glance");
		expect(html).toContain("Recent feedings");
		expect(html).toContain('data-help="fcr"');
		expect(html).toContain('data-help="dashboard-feed-log"');
		expect(html).toContain('data-help="feed-now"');
		expect(html).toContain('data-help="dashboard-hopper"');
		expect(html).toContain('data-help="dashboard-water-temp"');
		expect(html).toContain('data-help="ai-advisor"');

		// Two "Feed now" surfaces are not duplicated: the header renders one,
		// the rail's block is the same component.
		expect(html.match(/data-help="feed-now"/g)).toHaveLength(1);
	});

	it("reads every device on the pond so the canvas can pin each feeder", async () => {
		await DashboardHomePage({ searchParams: Promise.resolve({}) });

		expect(prisma.energyDevice.findMany).toHaveBeenCalledWith(
			expect.objectContaining({ where: { pondId: "pond-1" } }),
		);
	});

	it("uses the org's low-hopper threshold, not the hard-coded default", async () => {
		// 82 % is well above the 20 % default, but this farm raises the warning
		// threshold to 90 %, so the alert must appear.
		vi.mocked(prisma.energyDevice.findMany).mockResolvedValueOnce([
			{ id: "dev-1", label: "CICT Feeder", feedLevelPercent: 82 },
		] as never);
		const { getOrgSettingsForFarm } = await import("@/lib/settings/org");
		const { ORG_SETTINGS_DEFAULTS } = await import("@/lib/settings/org-shared");
		vi.mocked(getOrgSettingsForFarm).mockResolvedValueOnce({
			orgId: "org-1",
			settings: { ...ORG_SETTINGS_DEFAULTS, hopperLowPct: 90 },
		});

		const html = renderToStaticMarkup(
			await DashboardHomePage({ searchParams: Promise.resolve({}) }),
		);

		expect(html).toContain("Hopper low: 82%");
	});

	it("renders the empty state when the pond has no feeder", async () => {
		const pondSelection = await import("@/lib/pond-selection");
		vi.mocked(pondSelection.getActivePond).mockResolvedValueOnce({
			id: "pond-2",
			name: "Empty Pond",
			ownerId: "farm-1",
			energyDevices: [],
		} as unknown as Awaited<ReturnType<typeof pondSelection.getActivePond>>);

		const html = renderToStaticMarkup(
			await DashboardHomePage({ searchParams: Promise.resolve({}) }),
		);

		expect(html).toContain("No pond is assigned yet");
		expect(html).not.toContain("Pond controls");
	});
});
