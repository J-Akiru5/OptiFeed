import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * #247: on a 1900 px screen the Biomass Log and Feeding Schedule pages used to
 * sit in an uncentred ~860–980 px column with a large unused gap.
 *
 * These tests render the real pages and pin what the fix relies on: the shared
 * page width, the `xl` two-column grid, and the `data-help` anchors the help
 * centre and the tour use (they must survive the layout change).
 */

vi.mock("next-intl/server", async () => {
	const { createTranslator } = await import("./helpers/messages");
	type TestTranslator = ReturnType<typeof createTranslator>;
	type RichTranslator = TestTranslator & {
		rich: (key: string, values?: Record<string, string | number>) => string;
	};
	const withRich = (namespace: string): RichTranslator => {
		const translator = createTranslator(namespace) as RichTranslator;
		translator.rich = (key, values) => translator(key, values);
		return translator;
	};
	return {
		getTranslations: async (namespace: string) => withRich(namespace),
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
	getPathname: ({ href }: { href: string }) => href,
	usePathname: () => "/dashboard",
	useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
	redirect: vi.fn(),
}));

vi.mock("sonner", () => ({
	toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

vi.mock("@/lib/pwa/use-feed-guard", () => ({
	useFeedCommandGuard: () => ({ online: true, reason: undefined, blockIfOffline: () => false }),
}));

vi.mock("@/lib/actions/energy", () => ({ requestFeed: vi.fn() }));
vi.mock("@/lib/actions/schedule", () => ({
	toggleDevicePause: vi.fn(),
	updateScheduleCommand: vi.fn(),
}));
vi.mock("@/lib/actions/time", () => ({ setDeviceTime: vi.fn() }));
vi.mock("@/lib/actions/biomass", () => ({ saveBiomassLog: vi.fn() }));

vi.mock("@/lib/auth/session", () => ({
	canWrite: vi.fn(async () => true),
	getCurrentUser: vi.fn(async () => ({ displayName: "Nong Juan" })),
	getCurrentPondOwnerId: vi.fn(async () => "farm-1"),
}));

vi.mock("@/lib/pond-selection", () => ({
	getActivePond: vi.fn(async () => ({
		id: "pond-1",
		name: "Pond 1",
		ownerId: "farm-1",
		feedingRatePct: 5,
		feedsPerDay: 2,
		population: 600,
		scheduleStart: new Date("2026-10-28T06:00:00Z"),
		scheduleEnd: new Date("2026-10-28T18:00:00Z"),
	})),
}));

vi.mock("@/lib/settings/platform", () => ({ getListPageSize: vi.fn(async () => 20) }));
vi.mock("@/lib/schedule/resolve-current", () => ({
	resolveCurrentSchedule: vi.fn(async () => null),
}));
vi.mock("@/lib/batch-logs", () => ({
	getBatchSummaryPage: vi.fn(async () => ({ rows: [], total: 0, page: 1, pageSize: 20 })),
}));

vi.mock("@/lib/prisma", () => ({
	default: {
		energyDevice: { findFirst: vi.fn(async () => null) },
		biomassLog: { findMany: vi.fn(async () => []) },
		scheduleCommand: { findFirst: vi.fn(async () => null), findMany: vi.fn(async () => []) },
		feedRequest: { findMany: vi.fn(async () => []) },
	},
}));

import LogSamplePage from "@/app/[locale]/(dashboard)/dashboard/log-sample/page";
import SchedulePage from "@/app/[locale]/(dashboard)/dashboard/schedule/page";
import prisma from "@/lib/prisma";

const TWO_COLUMN_GRID = "xl:grid-cols-[minmax(0,1fr)_22rem]";

beforeEach(() => {
	vi.clearAllMocks();
});

describe("biomass log page (#247)", () => {
	it("uses the shared page width and keeps the help anchors", async () => {
		const html = renderToStaticMarkup(await LogSamplePage({ searchParams: Promise.resolve({}) }));

		expect(html).toContain("max-w-7xl");
		expect(html).toContain('data-help="biomass-form"');
		expect(html).toContain('data-help="biomass-batches"');
		// The form fields keep their ids (E2E and the offline outbox rely on them).
		for (const id of ["batchLabel", "weightGrams", "lengthCm", "sampleCount"]) {
			expect(html).toContain(`id="${id}"`);
		}
	});

	it("gives the form and the sticky Live Preview their own columns from xl", async () => {
		const html = renderToStaticMarkup(await LogSamplePage({ searchParams: Promise.resolve({}) }));

		expect(html).toContain(TWO_COLUMN_GRID);
		expect(html).toContain("xl:sticky");
		expect(html).toContain('aria-labelledby="biomass-live-preview"');
		expect(html).toContain('id="biomass-live-preview"');
		// The preview column also explains the formulas it applies.
		expect(html).toContain("Total biomass = fish count");
		expect(html).toContain("Daily feed = total biomass");
		expect(html).toContain("Feed per meal = daily feed");
	});

	it("lists saved sampling batches three or four across on wide screens", async () => {
		const { getBatchSummaryPage } = await import("@/lib/batch-logs");
		vi.mocked(getBatchSummaryPage).mockResolvedValueOnce({
			rows: [
				{
					label: "Batch A",
					lastSavedAt: new Date("2026-10-01T08:00:00Z"),
					entryCount: 1,
					totalSampleCount: 20,
					totalWeightKg: 4.4,
					avgWeightKg: 0.22,
				},
			],
			total: 1,
			page: 1,
			pageSize: 20,
		});

		const html = renderToStaticMarkup(await LogSamplePage({ searchParams: Promise.resolve({}) }));

		expect(html).toContain("sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4");
		expect(html).toContain("Batch A");
	});
});

describe("feeding schedule page (#247)", () => {
	beforeEach(() => {
		vi.mocked(prisma.energyDevice.findFirst).mockResolvedValue({
			id: "device-1",
			label: "Feeder 1",
			lastSeenAt: new Date("2020-01-01T00:00:00Z"),
			isPaused: false,
			gramsPerFeeding: 150,
			gramsPerSecond: 4,
		} as never);
	});

	it("puts the editor and calibration beside a sticky controls rail from xl", async () => {
		const html = renderToStaticMarkup(await SchedulePage());

		expect(html).toContain("max-w-7xl");
		expect(html).toContain(TWO_COLUMN_GRID);
		expect(html).toContain("xl:sticky");
		expect(html).toContain('aria-label="Feeder status and controls"');
	});

	it("keeps every schedule help anchor and the offline notice", async () => {
		const html = renderToStaticMarkup(await SchedulePage());

		for (const target of [
			"schedule-calibration",
			"schedule-controls",
			"schedule-editor",
			"schedule-save",
		]) {
			expect(html).toContain(`data-help="${target}"`);
		}
		expect(html).toContain("Device Offline");
		expect(html).toContain("Feed Now");
	});

	it("keeps the mobile stacking order below xl", async () => {
		const html = renderToStaticMarkup(await SchedulePage());

		// Same order farmers had before: calibration, notices, controls, editor.
		expect(html).toContain("order-1");
		expect(html).toContain("order-2");
		expect(html).toContain("order-3");
		expect(html).toContain("order-4");
	});
});
