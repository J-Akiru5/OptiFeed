import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Renders the dashboard pages that changed in T-09b.
 *
 * Focus is on what a reader sees: translated headings and filter landmarks, the
 * desktop table with column scopes *plus* the mobile card list, and a helpful
 * empty state instead of an empty table.
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
	getPathname: ({ href }: { href: string }) => href,
	usePathname: () => "/dashboard",
	useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
	redirect: vi.fn(),
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

vi.mock("@/lib/auth/session", () => ({
	canWrite: vi.fn(async () => true),
	getCurrentUser: vi.fn(async () => ({ displayName: "Nong Juan" })),
	getCurrentPondOwnerId: vi.fn(async () => "farm-1"),
}));

vi.mock("@/lib/pond-selection", () => ({
	getActivePond: vi.fn(async () => ({ id: "pond-1", name: "Pond 1", ownerId: "farm-1" })),
}));

vi.mock("@/lib/prisma", () => ({
	default: {
		notification: {
			findMany: vi.fn(async () => []),
			count: vi.fn(async () => 0),
		},
		energyDevice: { findFirst: vi.fn(async () => null) },
		$queryRaw: vi.fn(async () => []),
	},
}));

vi.mock("@/lib/actions/audit", () => ({ getAuditLog: vi.fn() }));
vi.mock("@/lib/actions/notifications", () => ({
	acknowledgeNotification: vi.fn(),
	markAllNotificationsRead: vi.fn(),
}));

vi.mock("@/lib/growth-history", () => ({
	isGrowthHistoryTab: (value: string | undefined) =>
		value === "feed" || value === "growth" || value === "biomass",
	getFeedLevelHistory: vi.fn(),
	getGrowthHistory: vi.fn(),
	getBiomassHistory: vi.fn(),
}));

import AuditPage from "@/app/[locale]/(dashboard)/dashboard/audit/page";
import GrowthHistoryPage from "@/app/[locale]/(dashboard)/dashboard/growth/history/page";
import NotificationsPage from "@/app/[locale]/(dashboard)/dashboard/notifications/page";
import { getAuditLog } from "@/lib/actions/audit";
import { canWrite } from "@/lib/auth/session";
import { getBiomassHistory } from "@/lib/growth-history";
import prisma from "@/lib/prisma";

beforeEach(() => {
	vi.clearAllMocks();
	vi.mocked(prisma.notification.findMany).mockResolvedValue([]);
	vi.mocked(prisma.notification.count).mockResolvedValue(0);
});

describe("notifications page", () => {
	it("labels the filter groups and marks the active filter", async () => {
		const html = renderToStaticMarkup(
			await NotificationsPage({ searchParams: Promise.resolve({}) }),
		);

		expect(html.match(/<h1/g)).toHaveLength(1);
		expect(html).toContain("Notifications");
		expect(html).toContain('<nav aria-label="Filter by severity"');
		expect(html).toContain('<nav aria-label="Filter by category"');
		expect(html).toContain('aria-current="page"');
		// 44 px touch targets on the filter pills.
		expect(html).toContain("min-h-11");
	});

	it("shows the translated empty state instead of a blank list", async () => {
		const html = renderToStaticMarkup(
			await NotificationsPage({ searchParams: Promise.resolve({}) }),
		);

		expect(html).toContain("All clear!");
		expect(html).toContain("No notifications yet.");
		expect(html).toContain('<ul aria-label="Notifications"');
	});

	it("disables writes and explains why in read-only mode", async () => {
		vi.mocked(canWrite).mockResolvedValueOnce(false);

		const html = renderToStaticMarkup(
			await NotificationsPage({ searchParams: Promise.resolve({}) }),
		);

		expect(html).toContain('role="note"');
		expect(html).toContain("View only");
		expect(html).toContain("Controls are disabled instead of failing after a tap.");
	});
});

describe("audit page", () => {
	it("renders an ordered timeline with an accessible name", async () => {
		vi.mocked(getAuditLog).mockResolvedValue({
			events: [
				{
					id: "evt-1",
					eventType: "feed_dispensed",
					source: "scheduled",
					actorId: null,
					actorLabel: null,
					actorRole: null,
					actorFarmId: null,
					deviceTime: null,
					createdAt: new Date("2026-07-08T16:19:00"),
					metadata: { grams: 500, source: "scheduled" },
					device: { id: "dev-1", label: "Feeder 1" },
				},
			],
			total: 1,
			page: 1,
			pageSize: 20,
			lastTouch: null,
		});

		const html = renderToStaticMarkup(await AuditPage({ searchParams: Promise.resolve({}) }));

		expect(html.match(/<h1/g)).toHaveLength(1);
		expect(html).toContain('<nav aria-label="Filter events"');
		expect(html).toContain('<ol aria-label="Event timeline"');
		expect(html).toContain("Feed Dispensed");
		expect(html).toContain("Feeder 1");
		expect(html).toContain("500g");
	});

	it("shows an empty state when there is nothing to show", async () => {
		vi.mocked(getAuditLog).mockResolvedValue({
			events: [],
			total: 0,
			page: 1,
			pageSize: 20,
			lastTouch: null,
		});

		const html = renderToStaticMarkup(await AuditPage({ searchParams: Promise.resolve({}) }));

		expect(html).toContain("No events recorded yet.");
		expect(html).toContain("<ol");
	});

	it("shows the last touch, the resolved actor and escaped metadata details", async () => {
		const touch = {
			id: "evt-touch",
			eventType: "settings_changed",
			source: "user",
			actorId: "farm-1",
			actorLabel: "Nong Juan",
			actorRole: "ADMIN",
			actorFarmId: "farm-1",
			deviceTime: null,
			createdAt: new Date("2026-07-09T08:30:00"),
			metadata: {
				before: { feedsPerDay: 2 },
				after: { feedsPerDay: 3 },
				note: "<script>alert(1)</script>",
			},
			device: { id: "dev-1", label: "Feeder 1" },
		};
		vi.mocked(getAuditLog).mockResolvedValue({
			events: [touch],
			total: 1,
			page: 1,
			pageSize: 20,
			lastTouch: touch,
		});

		const html = renderToStaticMarkup(await AuditPage({ searchParams: Promise.resolve({}) }));

		expect(html).toContain('aria-label="Last recorded user action"');
		expect(html).toContain("Last touch");
		expect(html).toContain("Nong Juan — Settings Changed");
		expect(html).toContain("by Nong Juan");
		expect(html).toContain("<details");
		expect(html).toContain("<summary");
		expect(html).toContain("Details");
		expect(html).toContain("Event metadata");
		expect(html).toContain("ADMIN");
		expect(html).toContain("feedsPerDay");
		// Metadata is plain text: React escapes the payload, never executes it.
		expect(html).toContain("&lt;script&gt;");
		expect(html).not.toContain("<script>");
	});
});

describe("growth history page", () => {
	it("renders scoped table columns and a mobile card list for biomass rows", async () => {
		vi.mocked(getBiomassHistory).mockResolvedValue({
			total: 1,
			items: [
				{
					id: "log-1",
					recordedAt: new Date("2026-07-08T16:19:00"),
					batchLabel: "Batch A",
					source: "manual",
					sampleWeightKg: 1.25,
					sampleCount: 12,
					sampleLengthCm: 18.5,
					avgWeightKg: 0.104,
					fishSamples: [],
				},
			],
		});

		const html = renderToStaticMarkup(
			await GrowthHistoryPage({ searchParams: Promise.resolve({ tab: "biomass" }) }),
		);

		expect(html.match(/<h1/g)).toHaveLength(1);
		expect(html).toContain('<caption class="sr-only">Biomass samples, newest first</caption>');
		expect(html).toContain('scope="col"');
		expect(html).toContain('<ul aria-label="Biomass samples, newest first"');
		expect(html).toContain("Batch A");
		expect(html).toContain("1.25 kg");
		expect(html).toContain("104.0 g");
		expect(html).toContain('<nav aria-label="Pagination"');
	});

	it("shows a translated empty state when the filters match nothing", async () => {
		vi.mocked(getBiomassHistory).mockResolvedValue({ total: 0, items: [] });

		const html = renderToStaticMarkup(
			await GrowthHistoryPage({ searchParams: Promise.resolve({ tab: "biomass" }) }),
		);

		expect(html).toContain("No records yet");
		expect(html).toContain("Records appear once samples or hopper readings are logged.");
		expect(html).not.toContain("<table");
	});

	it("charts average body weight per sampling batch with an accessible summary", async () => {
		vi.mocked(getBiomassHistory).mockResolvedValue({
			total: 2,
			items: [
				{
					id: "log-1",
					recordedAt: new Date("2026-10-02T16:19:00"),
					batchLabel: "Batch A",
					source: "manual",
					sampleWeightKg: 1.25,
					sampleCount: 12,
					sampleLengthCm: 18.5,
					avgWeightKg: 0.104,
					fishSamples: [],
				},
			],
		});
		vi.mocked(prisma.$queryRaw).mockResolvedValueOnce([
			{ day: "2026-10-01", batch: "Batch A", grams: 96.4 },
			{ day: "2026-10-02", batch: "Batch B", grams: 118.2 },
		] as never);

		const html = renderToStaticMarkup(
			await GrowthHistoryPage({ searchParams: Promise.resolve({ tab: "biomass" }) }),
		);

		expect(html).toContain("Average body weight trend");
		expect(html).toContain('role="img"');
		expect(html).toContain("Batch A");
		expect(html).toContain("Batch B");
		// The hidden table keeps the exact plotted numbers for screen readers.
		expect(html).toContain('<th scope="col">Period</th>');
		expect(html).toContain('<th scope="row">2026-10-01</th>');
	});
});
