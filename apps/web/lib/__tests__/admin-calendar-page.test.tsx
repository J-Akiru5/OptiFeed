import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The admin calendar's all-ponds view must keep every ACTIVE cycle.
 *
 * A single newest-30 query used to mix active and finished cycles, so an active
 * cycle on an older pond could drop out of the window entirely. The page now
 * reads active cycles without that mixed cap; this test fixes that contract.
 */

vi.mock("next-intl/server", async () => {
	const { createTranslator } = await import("./helpers/messages");
	return {
		getTranslations: async (namespace: string) => createTranslator(namespace),
		getLocale: async () => "en",
	};
});

vi.mock("@/i18n/routing", () => ({
	Link: ({ href, children }: { href: string; children?: ReactNode }) => (
		<a href={href}>{children}</a>
	),
}));

vi.mock("@/lib/auth/tenant-admin", () => ({
	requireTenantAdmin: vi.fn(async () => undefined),
}));

vi.mock("@/lib/auth/session", () => ({
	canWrite: vi.fn(async () => true),
	getCurrentUser: vi.fn(async () => ({ id: "user-1" })),
}));

vi.mock("@/lib/auth/permissions", () => ({
	hasPermission: vi.fn(async () => true),
}));

vi.mock("@/lib/auth/org-scope", () => ({
	resolveOrgScope: vi.fn(async () => ({
		orgIds: ["org-1"],
		memberUserIds: ["user-1"],
		farmIds: ["farm-1"],
		pondIds: ["pond-1", "pond-2"],
	})),
}));

vi.mock("@/lib/prisma", () => ({
	default: {
		pond: { findMany: vi.fn() },
		cropCycle: { findMany: vi.fn() },
	},
}));

vi.mock("@/components/harvest/harvest-calendar", () => ({
	HarvestCalendar: (props: { activeCycles: { id: string }[]; recentCycles: { id: string }[] }) => (
		<div
			data-testid="calendar"
			data-active={props.activeCycles.map((cycle) => cycle.id).join(",")}
			data-recent={props.recentCycles.map((cycle) => cycle.id).join(",")}
		/>
	),
}));

import AdminCalendarPage from "@/app/[locale]/(admin)/admin/calendar/page";
import prisma from "@/lib/prisma";

const mockPond = vi.mocked(prisma.pond);
const mockCycle = vi.mocked(prisma.cropCycle);

const cycle = (id: string, pondId: string, status: "ACTIVE" | "HARVESTED") => ({
	id,
	pondId,
	label: null,
	status,
	stockingDate: new Date("2026-10-01T00:00:00.000Z"),
	stockingCount: 1000,
	stockingAvgWeightG: null,
	growOutDays: 135,
	targetHarvestDate: new Date("2027-02-13T00:00:00.000Z"),
	targetHarvestWeightG: null,
	expectedSurvivalPct: null,
	actualHarvestDate: status === "HARVESTED" ? new Date("2026-10-20T00:00:00.000Z") : null,
	actualHarvestWeightKg: null,
	actualHarvestCount: null,
	actualFcr: null,
	notes: null,
});

beforeEach(() => {
	vi.clearAllMocks();
	mockPond.findMany.mockResolvedValue([
		{ id: "pond-1", name: "Pond One", isFallow: false, population: 1000, notificationPrefs: {} },
		{ id: "pond-2", name: "Pond Two", isFallow: false, population: 800, notificationPrefs: {} },
	] as never);
});

describe("admin calendar all-ponds data", () => {
	it("keeps an active cycle from an older pond alongside recent history", async () => {
		mockCycle.findMany
			.mockResolvedValueOnce([cycle("active-old", "pond-2", "ACTIVE")] as never)
			.mockResolvedValueOnce([cycle("harvested-new", "pond-1", "HARVESTED")] as never);

		const html = renderToStaticMarkup(await AdminCalendarPage());

		expect(html).toContain('data-active="active-old"');
		expect(html).toContain('data-recent="harvested-new"');
		// The two reads are separated by status, not by a shared mixed cap.
		expect(mockCycle.findMany).toHaveBeenNthCalledWith(
			1,
			expect.objectContaining({ where: expect.objectContaining({ status: "ACTIVE" }) }),
		);
		expect(mockCycle.findMany).toHaveBeenNthCalledWith(
			2,
			expect.objectContaining({
				where: expect.objectContaining({ status: { not: "ACTIVE" } }),
				take: 30,
			}),
		);
	});
});
