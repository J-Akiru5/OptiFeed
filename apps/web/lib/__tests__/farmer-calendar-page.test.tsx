import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The farmer Calendar page (E25, #212) must render from the org-wide loader
 * and pass the writable pond list through to the shared calendar. The calendar
 * itself is client-only; this test asserts the server contract around it.
 */

const mocks = vi.hoisted(() => ({
	pondFindMany: vi.fn(),
	cropCycleFindMany: vi.fn(),
	energyDeviceFindMany: vi.fn(),
	pondEventFindMany: vi.fn(),
	biomassLogGroupBy: vi.fn(),
	deviceStateEventFindMany: vi.fn(),
	resolveMemberOrgScope: vi.fn(),
	canWrite: vi.fn(),
	hasPermission: vi.fn(),
	getCurrentPondOwnerId: vi.fn(),
	getActivePondId: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
	default: {
		pond: { findMany: mocks.pondFindMany },
		cropCycle: { findMany: mocks.cropCycleFindMany },
		energyDevice: { findMany: mocks.energyDeviceFindMany },
		pondEvent: { findMany: mocks.pondEventFindMany },
		biomassLog: { groupBy: mocks.biomassLogGroupBy },
		deviceStateEvent: { findMany: mocks.deviceStateEventFindMany },
	},
}));

vi.mock("@/lib/schedule/resolve-current", () => ({
	resolveCurrentSchedule: vi.fn(),
}));

vi.mock("@/lib/auth/org-scope", () => ({
	resolveMemberOrgScope: mocks.resolveMemberOrgScope,
}));

vi.mock("@/lib/auth/permissions", () => ({
	hasPermission: mocks.hasPermission,
}));

vi.mock("@/lib/auth/session", () => ({
	canWrite: mocks.canWrite,
	getCurrentPondOwnerId: mocks.getCurrentPondOwnerId,
}));

vi.mock("@/lib/pond-selection", () => ({
	getActivePondId: mocks.getActivePondId,
}));

vi.mock("@/components/harvest/harvest-calendar", () => ({
	HarvestCalendar: (props: {
		initialPondId: string;
		initialPondName: string;
		canManage: boolean;
		writablePondIds?: string[];
		apiScope?: string;
		heading?: string;
		activeCycle?: { id: string } | null;
		activeCycles?: Array<{ id: string }>;
		recentCycles?: Array<{ id: string }>;
		hopperLevelPct?: number | null;
		hopperIsOffline?: boolean;
	}) => (
		<div
			data-testid="calendar"
			data-pond={props.initialPondId}
			data-name={props.initialPondName}
			data-can-manage={String(props.canManage)}
			data-writable={props.writablePondIds?.join(",") ?? "all"}
			data-scope={props.apiScope}
			data-heading={props.heading}
			data-active-cycle={props.activeCycle?.id ?? ""}
			data-active-cycles={props.activeCycles?.map((cycle) => cycle.id).join(",") ?? ""}
			data-recent-cycles={props.recentCycles?.map((cycle) => cycle.id).join(",") ?? ""}
			data-hopper={props.hopperLevelPct ?? ""}
			data-hopper-offline={String(props.hopperIsOffline ?? false)}
		/>
	),
}));

vi.mock("next-intl/server", async () => {
	const { createTranslator } = await import("./helpers/messages");
	return {
		getLocale: async () => "en",
		getTranslations: async (namespace: string) => createTranslator(namespace),
	};
});

import FarmerCalendarPage from "@/app/[locale]/(dashboard)/dashboard/calendar/page";

const EMPTY_SCOPE = { orgIds: [], memberUserIds: [], farmIds: [], pondIds: [] };

const ownPond = {
	id: "pond-own",
	name: "My pond",
	isFallow: false,
	population: 1000,
	notificationPrefs: null,
	ownerId: "farm-own",
	sampleIntervalDays: 14,
	createdAt: new Date("2026-01-01T00:00:00.000Z"),
};

const otherPond = {
	id: "pond-other",
	name: "Neighbour pond",
	isFallow: true,
	population: null,
	notificationPrefs: null,
	ownerId: "farm-other",
	sampleIntervalDays: 14,
	createdAt: new Date("2026-02-01T00:00:00.000Z"),
};

beforeEach(() => {
	vi.clearAllMocks();
	mocks.getCurrentPondOwnerId.mockResolvedValue("farm-own");
	mocks.canWrite.mockResolvedValue(true);
	mocks.hasPermission.mockResolvedValue(true);
	mocks.getActivePondId.mockResolvedValue(null);
	mocks.resolveMemberOrgScope.mockResolvedValue(EMPTY_SCOPE);
	mocks.pondFindMany.mockResolvedValue([ownPond]);
	mocks.cropCycleFindMany.mockResolvedValue([]);
	mocks.energyDeviceFindMany.mockResolvedValue([]);
	mocks.pondEventFindMany.mockResolvedValue([]);
	mocks.biomassLogGroupBy.mockResolvedValue([]);
	mocks.deviceStateEventFindMany.mockResolvedValue([]);
});

describe("/dashboard/calendar page", () => {
	it("renders the org-wide calendar with only the own farm writable", async () => {
		mocks.resolveMemberOrgScope.mockResolvedValue({
			orgIds: ["org-1"],
			memberUserIds: [],
			farmIds: [],
			pondIds: [ownPond.id, otherPond.id],
		});
		mocks.pondFindMany.mockResolvedValue([ownPond, otherPond]);

		const html = renderToStaticMarkup(await FarmerCalendarPage());

		expect(html).toContain('data-testid="calendar"');
		expect(html).toContain('data-pond="pond-own"');
		expect(html).toContain('data-name="My pond"');
		expect(html).toContain('data-can-manage="true"');
		expect(html).toContain('data-writable="pond-own"');
		expect(html).toContain('data-scope="member-org"');
	});

	it("merges the Harvest page data into the one page (#248)", async () => {
		const cycle = {
			id: "cycle-1",
			pondId: "pond-own",
			label: "Cycle 1",
			status: "ACTIVE" as const,
			stockingDate: new Date("2026-09-01T00:00:00.000Z"),
			stockingCount: 1000,
			stockingAvgWeightG: 5,
			growOutDays: 90,
			targetHarvestDate: new Date("2026-11-30T00:00:00.000Z"),
			targetHarvestWeightG: 250,
			expectedSurvivalPct: 80,
			actualHarvestDate: null,
			actualHarvestWeightKg: null,
			actualHarvestCount: null,
			actualFcr: null,
			notes: null,
		};
		mocks.cropCycleFindMany.mockResolvedValue([cycle]);
		mocks.energyDeviceFindMany.mockResolvedValue([
			{
				feedLevelPercent: 82,
				feedLevelUpdatedAt: new Date("2026-10-27T01:00:00.000Z"),
				lastSeenAt: new Date("2026-10-27T01:00:00.000Z"),
			},
		]);

		const html = renderToStaticMarkup(await FarmerCalendarPage());

		// Grow-out start/edit, harvest planning and projection all read from the
		// cycle the Harvest page used to load.
		expect(html).toContain('data-active-cycle="cycle-1"');
		expect(html).toContain('data-active-cycles="cycle-1"');
		// The hopper card is the one Harvest-only panel on the page rail.
		expect(html).toContain('data-hopper="82"');
		expect(html).toContain('data-hopper-offline="true"');
	});

	it("keeps the merged page heading", async () => {
		const html = renderToStaticMarkup(await FarmerCalendarPage());

		expect(html).toContain("Calendar &amp; Harvest");
	});

	it("falls back to the caller's own farm when they have no org", async () => {
		const html = renderToStaticMarkup(await FarmerCalendarPage());

		expect(html).toContain('data-pond="pond-own"');
		expect(html).toContain('data-writable="pond-own"');
		expect(mocks.pondFindMany).toHaveBeenCalledWith(
			expect.objectContaining({ where: { ownerId: "farm-own", status: "ACTIVE" } }),
		);
	});

	it("renders the empty state when the farm has no active pond", async () => {
		mocks.pondFindMany.mockResolvedValue([]);

		const html = renderToStaticMarkup(await FarmerCalendarPage());

		expect(html).toContain("No pond or device data found");
		expect(html).not.toContain('data-testid="calendar"');
	});

	it("propagates the authentication redirect before rendering", async () => {
		mocks.getCurrentPondOwnerId.mockRejectedValue(new Error("NEXT_REDIRECT"));

		await expect(FarmerCalendarPage()).rejects.toThrow("NEXT_REDIRECT");
	});

	it("renders read-only when the caller cannot write", async () => {
		mocks.canWrite.mockResolvedValue(false);

		const html = renderToStaticMarkup(await FarmerCalendarPage());

		expect(html).toContain('data-can-manage="false"');
	});
});
