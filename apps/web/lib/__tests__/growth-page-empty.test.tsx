import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A new pond has no biomass samples and no FCR report. The Growth page must
 * say so instead of rendering a perfect-looking 0.00 FCR with a trend claim
 * (#752).
 */

const mocks = vi.hoisted(() => ({
	canWrite: vi.fn(),
	getActivePond: vi.fn(),
	getLiveCountForPond: vi.fn(),
	mortalityRatePct: vi.fn(),
	activeWindowForPond: vi.fn(),
	feedGivenKgInWindow: vi.fn(),
	biomassSamplesInWindow: vi.fn(),
	computeFcr: vi.fn(),
	loadGrowthPlanForPond: vi.fn(),
	resolveCurrentSchedule: vi.fn(),
	computeDeterministicPrediction: vi.fn(),
	biomassFindMany: vi.fn(),
	biomassFindFirst: vi.fn(),
	fcrReportFindMany: vi.fn(),
	energyDeviceFindFirst: vi.fn(),
	cropCycleFindFirst: vi.fn(),
	feedLevelLogFindMany: vi.fn(),
}));

vi.mock("next-intl/server", async () => {
	const { createTranslator } = await import("./helpers/messages");
	return {
		getTranslations: async (namespace: string) => createTranslator(namespace),
		getLocale: async () => "en",
	};
});

vi.mock("next-intl", async () => {
	const { createTranslator } = await import("./helpers/messages");
	return {
		useTranslations: (namespace: string) => createTranslator(namespace),
		useLocale: () => "en",
	};
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
	useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
}));

vi.mock("@/lib/auth/session", () => ({ canWrite: mocks.canWrite }));
vi.mock("@/lib/pond-selection", () => ({ getActivePond: mocks.getActivePond }));
vi.mock("@/lib/growth/live-count", () => ({
	getLiveCountForPond: mocks.getLiveCountForPond,
	mortalityRatePct: mocks.mortalityRatePct,
}));
vi.mock("@/lib/analytics/fcr", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@/lib/analytics/fcr")>();
	return {
		...actual,
		activeWindowForPond: mocks.activeWindowForPond,
		biomassSamplesInWindow: mocks.biomassSamplesInWindow,
		computeFcr: mocks.computeFcr,
		feedGivenKgInWindow: mocks.feedGivenKgInWindow,
	};
});
vi.mock("@/lib/growth-plan-loader", () => ({
	loadGrowthPlanForPond: mocks.loadGrowthPlanForPond,
}));
vi.mock("@/lib/schedule/resolve-current", () => ({
	resolveCurrentSchedule: mocks.resolveCurrentSchedule,
}));
vi.mock("@/lib/prediction", () => ({
	computeDeterministicPrediction: mocks.computeDeterministicPrediction,
}));

vi.mock("@/lib/prisma", () => ({
	default: {
		biomassLog: { findMany: mocks.biomassFindMany, findFirst: mocks.biomassFindFirst },
		fcrReport: { findMany: mocks.fcrReportFindMany },
		energyDevice: { findFirst: mocks.energyDeviceFindFirst },
		cropCycle: { findFirst: mocks.cropCycleFindFirst },
		feedLevelLog: { findMany: mocks.feedLevelLogFindMany },
	},
}));

vi.mock("@/components/DataImportExport", () => ({
	DataExportButton: () => null,
	DataImportDialog: () => null,
}));
vi.mock("@/components/pwa/snapshot-writer", () => ({ SnapshotWriter: () => null }));
vi.mock("@/components/FeedingPredictionCard", () => ({ FeedingPredictionCard: () => null }));
vi.mock("@/components/growth/GrowthPlanCard", () => ({ GrowthPlanCard: () => null }));
vi.mock("@/components/growth/mortality-form", () => ({ MortalityForm: () => null }));
vi.mock("@/components/FcrCalculator", () => ({
	FcrCalculator: ({ latestFcr }: { latestFcr: number | null }) => (
		<div
			data-testid="fcr-calculator"
			data-latest-fcr={latestFcr === null ? "null" : latestFcr.toFixed(2)}
		/>
	),
}));

import GrowthPage from "@/app/[locale]/(dashboard)/dashboard/growth/page";
import { renderPageHtml } from "./helpers/render-page";

beforeEach(() => {
	vi.clearAllMocks();
	mocks.canWrite.mockResolvedValue(true);
	mocks.getActivePond.mockResolvedValue({
		id: "pond-1",
		name: "New pond",
		ownerId: "farm-1",
		population: 1000,
		feedingRatePct: 3,
		feedsPerDay: 3,
		isFallow: false,
	});
	mocks.getLiveCountForPond.mockResolvedValue({
		stocked: 1000,
		dead: 0,
		live: 1000,
		source: "crop_cycle",
	});
	mocks.mortalityRatePct.mockReturnValue(0);
	mocks.activeWindowForPond.mockResolvedValue({ cycleId: null, from: null, to: null });
	mocks.feedGivenKgInWindow.mockResolvedValue(0);
	mocks.biomassSamplesInWindow.mockResolvedValue([]);
	mocks.computeFcr.mockReturnValue({ feedGivenKg: 0, biomassGainKg: 0, fcr: null });
	mocks.loadGrowthPlanForPond.mockResolvedValue(null);
	mocks.resolveCurrentSchedule.mockResolvedValue(null);
	mocks.computeDeterministicPrediction.mockReturnValue({});
	mocks.biomassFindMany.mockResolvedValue([]);
	mocks.biomassFindFirst.mockResolvedValue(null);
	mocks.fcrReportFindMany.mockResolvedValue([]);
	mocks.energyDeviceFindFirst.mockResolvedValue(null);
	mocks.cropCycleFindFirst.mockResolvedValue(null);
	mocks.feedLevelLogFindMany.mockResolvedValue([]);
});

describe("Growth page without data (#752)", () => {
	it("shows an empty state instead of 0.00 FCR, 0.0 g ABW and a fake trend", async () => {
		const html = await renderPageHtml(await GrowthPage());

		expect(html).toContain("No FCR data yet");
		expect(html).toContain('data-latest-fcr="null"');
		expect(html).not.toContain("Trending downwards");
		expect(html).not.toContain("0.00");
		expect(html).not.toContain("0.0 g");
	});
});
