import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The shared HarvestCalendar is rendered on both the farmer dashboard and the
 * admin calendar. T-09b moved its remaining copy into the message catalogue, so
 * this test renders it in English and Hiligaynon and checks the visible labels
 * actually change. A widget that falls back to hard-coded English fails here.
 */

const state = vi.hoisted(() => ({ locale: "en" as "en" | "hil" }));

vi.mock("next-intl", async () => {
	const { createTranslator } = await import("./helpers/messages");
	return {
		useTranslations: (namespace: string) => createTranslator(namespace, state.locale),
		useLocale: () => state.locale,
	};
});

vi.mock("next/dynamic", () => ({
	// The month grid is client-only; the surrounding page is what we assert on.
	default: () => () => null,
}));

vi.mock("@/i18n/routing", () => ({
	Link: ({ href, children }: { href: string; children?: ReactNode }) => (
		<a href={href}>{children}</a>
	),
	useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

vi.mock("@/lib/api-client", () => ({
	apiGet: vi.fn(async () => ({ events: [], truncated: false })),
	ApiClientError: class extends Error {},
}));

vi.mock("@/lib/actions/crop-cycle", () => ({
	cancelCropCycle: vi.fn(),
	updateCropCycle: vi.fn(),
	createCropCycle: vi.fn(),
	markCycleHarvested: vi.fn(),
}));

vi.mock("@/lib/actions/pond-event", () => ({
	completePondEvent: vi.fn(),
	uncompletePondEvent: vi.fn(),
	updatePondEvent: vi.fn(),
	createPondEvent: vi.fn(),
	deletePondEvent: vi.fn(),
}));

import { HarvestCalendar } from "@/components/harvest/harvest-calendar";

function renderCalendar() {
	return renderToStaticMarkup(
		<HarvestCalendar
			initialPondId="pond-1"
			initialPondName="Pond 1"
			initialPondIsFallow={false}
			ponds={[
				{
					id: "pond-1",
					name: "Pond 1",
					isFallow: false,
					population: 1000,
					areaM2: 500,
					averageDepthM: 1.5,
					savedTargetWeightG: null,
				},
			]}
			activeCycle={null}
			activeCycles={[]}
			recentCycles={[]}
			canManage
			today="2026-10-26"
			hopperLevelPct={50}
		/>,
	);
}

const activeCycle = {
	id: "cycle-1",
	pondId: "pond-1",
	label: "Cycle 1",
	status: "ACTIVE" as const,
	stockingDate: "2026-08-01",
	stockingCount: 1000,
	stockingAvgWeightG: 5,
	growOutDays: 90,
	targetHarvestDate: "2026-10-30",
	targetHarvestWeightG: 250,
	expectedSurvivalPct: 80,
	actualHarvestDate: null,
	actualHarvestWeightKg: null,
	actualHarvestCount: null,
	actualFcr: null,
	notes: null,
};

beforeEach(() => {
	state.locale = "en";
});

describe("HarvestCalendar copy", () => {
	it("renders English labels and the translated no-cycle state", () => {
		const html = renderCalendar();

		expect(html).toContain("Harvest &amp; Grow-out");
		expect(html).toContain("Pond 1");
		expect(html).toContain('<fieldset aria-label="Filter"');
		expect(html).toContain('aria-label="Pond calendar"');
		expect(html).toContain('aria-label="Upcoming events"');
		expect(html).toContain("No active grow-out cycle");
		expect(html).toContain("Start grow-out cycle");
		expect(html).toContain("Add event");
	});

	it("renders the Hiligaynon draft instead of hard-coded English", () => {
		state.locale = "hil";
		const html = renderCalendar();

		expect(html).toContain("Pag-ani kag Pagpatubo");
		expect(html).toContain("Wala sang aktibo nga siklo");
		expect(html).toContain('aria-label="Mga masunod nga hitabo"');
		expect(html).toContain("Tanan nga punong");
		expect(html).not.toContain("No active grow-out cycle");
	});

	it("renders the grow-out and harvest panels for an active cycle (#248)", () => {
		const html = renderToStaticMarkup(
			<HarvestCalendar
				initialPondId="pond-1"
				initialPondName="Pond 1"
				initialPondIsFallow={false}
				ponds={[
					{
						id: "pond-1",
						name: "Pond 1",
						isFallow: false,
						population: 1000,
						areaM2: 500,
						averageDepthM: 1.5,
						savedTargetWeightG: null,
					},
				]}
				activeCycle={activeCycle}
				activeCycles={[activeCycle]}
				recentCycles={[]}
				canManage
				today="2026-10-26"
				hopperLevelPct={50}
			/>,
		);

		// Grow-out start/edit and harvest planning are the Harvest-only controls
		// the merged page must keep.
		expect(html).toContain("Edit plan");
		expect(html).toContain("Mark harvested");
		expect(html).toContain("Grow-out progress");
		expect(html).toContain("Harvest in 4 days");
	});
});
