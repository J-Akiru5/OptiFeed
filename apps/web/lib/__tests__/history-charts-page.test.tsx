import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The History page puts the two charts above the event log (#188, E15). This
 * test pins the wiring: the series come from the pond-scoped query module, the
 * range toggle is a real link, and every chart keeps its accessible summary.
 */

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
}));

vi.mock("@/lib/auth/session", () => ({
	canWrite: vi.fn(async () => true),
}));

vi.mock("@/lib/pond-selection", () => ({
	getActivePond: vi.fn(async () => ({ id: "pond-1", name: "Pond 1", ownerId: "farm-1" })),
}));

vi.mock("@/lib/prisma", () => ({
	default: {
		energyDevice: {
			findMany: vi.fn(async () => [
				{
					id: "device-1",
					feedLevelPercent: 82,
					feedLevelUpdatedAt: new Date("2026-10-27T02:00:00.000Z"),
					lastSeenAt: new Date("2026-10-27T04:00:00.000Z"),
					hopperCapacityG: 10000,
					gramsPerFeeding: 400,
				},
			]),
		},
	},
}));

vi.mock("@/lib/settings/platform", () => ({
	getListPageSize: vi.fn(async () => 20),
}));

vi.mock("@/lib/actions/history", () => ({
	getFeedEvents: vi.fn(async () => ({ items: [], total: 0, page: 1, pageSize: 20 })),
}));

vi.mock("@/lib/pond-charts", () => ({
	getFeedPerDayBySource: vi.fn(async () => ({
		dayKeys: ["2026-10-26", "2026-10-27"],
		stack: {
			sources: ["scheduled", "button"],
			rows: [
				{ label: "2026-10-26", scheduled: 400, button: 0 },
				{ label: "2026-10-27", scheduled: 0, button: 120 },
			],
			totalsBySource: { scheduled: 400, button: 120 },
		},
	})),
	getHopperLevelSeries: vi.fn(async () => [
		{ label: "2026-10-26", value: 82 },
		{ label: "2026-10-27", value: 79.5 },
	]),
}));

vi.mock("@/components/DataImportExport", () => ({
	DataExportButton: () => null,
	DataImportDialog: () => null,
}));
vi.mock("@/components/FeedEventHistoryTable", () => ({
	FeedEventHistoryTable: () => <div data-testid="event-table" />,
}));
vi.mock("@/components/pwa/snapshot-writer", () => ({ SnapshotWriter: () => null }));

import HistoryPage from "@/app/[locale]/(dashboard)/dashboard/history/page";
import { getHopperLevelSeries } from "@/lib/pond-charts";

beforeEach(() => {
	vi.clearAllMocks();
});

describe("history charts (#188)", () => {
	it("renders feed-per-day and hopper charts above the event log", async () => {
		const html = renderToStaticMarkup(await HistoryPage({ searchParams: Promise.resolve({}) }));

		expect(html).toContain("Feed dispensed per day");
		expect(html).toContain("Hopper level");
		expect(html).toContain('role="img"');
		expect(html).toContain("Feed dispensed over the last 30 days");
		expect(html).toContain("Scheduled");
		expect(html).toContain('<th scope="row">2026-10-27</th>');
		// The event log is still rendered below the charts.
		expect(html).toContain('data-testid="event-table"');
	});

	it("defaults to the seven-day hopper window and links to the thirty-day one", async () => {
		const html = renderToStaticMarkup(await HistoryPage({ searchParams: Promise.resolve({}) }));

		expect(getHopperLevelSeries).toHaveBeenCalledWith(["device-1"], 7);
		expect(html).toContain('href="/dashboard/history?hopper=30"');
		expect(html).toContain('aria-current="page"');
	});

	it("reads the thirty-day hopper window from the URL", async () => {
		renderToStaticMarkup(await HistoryPage({ searchParams: Promise.resolve({ hopper: "30" }) }));

		expect(getHopperLevelSeries).toHaveBeenCalledWith(["device-1"], 30);
	});

	it("ignores an unsupported hopper window", async () => {
		renderToStaticMarkup(await HistoryPage({ searchParams: Promise.resolve({ hopper: "365" }) }));

		expect(getHopperLevelSeries).toHaveBeenCalledWith(["device-1"], 7);
	});
});
