import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

/**
 * The control-room dashboard (issue #188, decision E14).
 *
 * Presentation only, so these tests check what a reader sees: one pin per
 * feeder with its online/offline state and last-known hopper level, the rail's
 * alert and advisor summaries, and the anchors the tour and the help centre
 * point at.
 */

vi.mock("next-intl", async () => {
	const { createTranslator } = await import("./helpers/messages");
	return {
		useTranslations: (namespace: string) => createTranslator(namespace),
		useLocale: () => "en",
	};
});

vi.mock("next-intl/server", async () => {
	const { createTranslator } = await import("./helpers/messages");
	return {
		getTranslations: async (namespace: string) => createTranslator(namespace),
		getLocale: async () => "en",
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

import { NextFeedingStrip } from "@/components/dashboard/control-room/next-feeding-strip";
import { PondOverview } from "@/components/dashboard/control-room/pond-overview";
import {
	AdvisorSummary,
	AlertsPanel,
	GrowOutPanel,
	PondSummary,
	RecentFeedings,
	StatTile,
} from "@/components/dashboard/control-room/rail-panels";

const readingAt = new Date("2026-10-27T09:32:00+08:00");

describe("pond overview canvas", () => {
	it("draws one pin per feeder with the online level and the water temperature", () => {
		const html = renderToStaticMarkup(
			<PondOverview
				pondName="Demo Pond"
				feeders={[
					{
						id: "dev-1",
						label: "CICT Feeder",
						isOffline: false,
						isPaused: false,
						levelPercent: 82,
						levelUpdatedAt: readingAt,
						nextFeedLabel: "12:00",
						waterTempLabel: "28.4 °C",
					},
				]}
			/>,
		);

		expect(html).toContain("Demo Pond");
		expect(html).toContain("CICT Feeder");
		expect(html).toContain("82%");
		expect(html).toContain("12:00");
		expect(html).toContain("28.4 °C");
		expect(html).toContain('href="/dashboard/settings/hardware"');
	});

	it("shows the last known level, the reading time and an Offline tag for an offline feeder", () => {
		const html = renderToStaticMarkup(
			<PondOverview
				pondName="Demo Pond"
				feeders={[
					{
						id: "dev-1",
						label: "CICT Feeder",
						isOffline: true,
						isPaused: false,
						levelPercent: 82,
						levelUpdatedAt: readingAt,
						nextFeedLabel: "12:00",
						waterTempLabel: null,
					},
				]}
			/>,
		);

		expect(html).toContain("Last known 82%");
		expect(html).toContain("Offline");
		expect(html).not.toContain("28.4 °C");
	});

	it("shows a dash when the feeder has never reported a level", () => {
		const html = renderToStaticMarkup(
			<PondOverview
				pondName="Demo Pond"
				feeders={[
					{
						id: "dev-1",
						label: "CICT Feeder",
						isOffline: true,
						isPaused: true,
						levelPercent: null,
						levelUpdatedAt: null,
						nextFeedLabel: null,
						waterTempLabel: null,
					},
				]}
			/>,
		);

		expect(html).toContain("—");
		expect(html).toContain("No reading yet");
		expect(html).toContain("Schedule Paused");
	});

	it("says so when the pond has no feeder", () => {
		const html = renderToStaticMarkup(<PondOverview pondName="Demo Pond" feeders={[]} />);

		expect(html).toContain("No feeder is registered on this pond yet.");
	});
});

describe("next feeding strip", () => {
	it("keeps the tour and help targets and shows the time, volume and rate", () => {
		const html = renderToStaticMarkup(
			<NextFeedingStrip
				pondName="Demo Pond"
				label="NEXT SCHEDULED FEEDING"
				time="12:00"
				timeSrLabel="Next feeding time"
				isPaused={false}
				statusLabel="ESP32 Auto-Timer On"
				volumeLabel="FEED VOLUME"
				volumeValue="330 g"
				rateLabel="Feeding Rate"
				rateValue="3% BW/Day"
				basedOn="Based on the sample of 27 October"
				updateLabel="Update Biomass Weight"
				updateHref="/dashboard/log-sample"
			/>,
		);

		expect(html).toContain('data-onboard="next-feeding"');
		expect(html).toContain('data-help="next-feeding"');
		expect(html).toContain("12:00");
		expect(html).toContain("330 g");
		expect(html).toContain("3% BW/Day");
	});

	it("shows a paused dash instead of a time", () => {
		const html = renderToStaticMarkup(
			<NextFeedingStrip
				pondName="Demo Pond"
				label="NEXT SCHEDULED FEEDING"
				time="12:00"
				timeSrLabel="Next feeding time"
				isPaused
				statusLabel="Schedule Paused"
				volumeLabel="FEED VOLUME"
				volumeValue="330 g"
				rateLabel="Feeding Rate"
				rateValue="3% BW/Day"
				basedOn={null}
				updateLabel="Update Biomass Weight"
				updateHref="/dashboard/log-sample"
			/>,
		);

		expect(html).toContain("—:—");
		expect(html).toContain("Schedule Paused");
	});
});

describe("right-pane sections", () => {
	it("lists the alerts with their links", () => {
		const html = renderToStaticMarkup(
			<AlertsPanel
				items={[
					{
						id: "offline",
						tone: "danger",
						title: "Feeder offline for 2 days",
						detail: "CICT Feeder has not sent a heartbeat.",
						href: "/dashboard/settings/hardware",
						linkLabel: "Open hardware settings",
					},
				]}
				emptyTitle="Nothing needs attention"
				emptyDescription="The feeder is online."
			/>,
		);

		expect(html).toContain("Feeder offline for 2 days");
		expect(html).toContain("Open hardware settings");
		expect(html).not.toContain("Nothing needs attention");
	});

	it("says nothing needs attention when the list is empty", () => {
		const html = renderToStaticMarkup(
			<AlertsPanel items={[]} emptyTitle="Nothing needs attention" emptyDescription="All good." />,
		);

		expect(html).toContain("Nothing needs attention");
	});

	it("summarises the advisor and links to the full card", () => {
		const html = renderToStaticMarkup(
			<AdvisorSummary
				grams={412.4}
				gramsLabel="Recommended per meal"
				unit="g"
				confidenceLabel="Confidence"
				confidence="High"
				reasoning="Fresh sample and a falling FCR."
				emptyLabel="Not enough data."
				href="/dashboard/growth"
				linkLabel="Open the full advisor"
			/>,
		);

		expect(html).toContain("412");
		expect(html).toContain("Confidence: High");
		expect(html).toContain('href="/dashboard/growth"');
		expect(html).toContain("Open the full advisor");
	});

	it("keeps the pond summary, the stats and the recent feedings", () => {
		const summary = renderToStaticMarkup(
			<PondSummary
				name="Demo Pond"
				meta={[
					{ label: "POND POPULATION", value: "1,200 Catfish" },
					{ label: "Grow-out cycle", value: "Cycle 3" },
				]}
				href="/dashboard/settings/pond"
				linkLabel="Open pond settings"
			/>,
		);
		expect(summary).toContain("Demo Pond");
		expect(summary).toContain("1,200 Catfish");
		expect(summary).toContain("Cycle 3");

		const stats = renderToStaticMarkup(
			<StatTile
				label="CURRENT FCR"
				value="1.24"
				detail="African Catfish Rate"
				href="/dashboard/growth"
			/>,
		);
		expect(stats).toContain("1.24");

		const feedings = renderToStaticMarkup(
			<RecentFeedings
				rows={[
					{ id: "1", time: "12:00", date: "27 Oct 2026", sourceLabel: "Scheduled", grams: "330 g" },
				]}
				emptyTitle="No feedings recorded yet."
				emptyHint="Feedings appear after a dispense."
				href="/dashboard/history"
				linkLabel="View complete history"
			/>,
		);
		expect(feedings).toContain("12:00");
		expect(feedings).toContain("330 g");
		expect(feedings).toContain("View complete history");

		const growOut = renderToStaticMarkup(
			<GrowOutPanel
				title="Cycle 3"
				detail="Day 42 of 90 · harvest in 48 days"
				href="/dashboard/harvest"
				linkLabel="Open harvest"
			/>,
		);
		expect(growOut).toContain("Cycle 3");
		expect(growOut).toContain("Open harvest");
	});
});

describe("dashboard anchors", () => {
	const webRoot = join(__dirname, "../..");
	const pageSource = readFileSync(
		join(webRoot, "app/[locale]/(dashboard)/dashboard/page.tsx"),
		"utf8",
	);
	const controlRoomSource = [
		"next-feeding-strip.tsx",
		"pond-overview.tsx",
		"rail-panels.tsx",
		"control-room-shell.tsx",
	]
		.map((file) => readFileSync(join(webRoot, "components/dashboard/control-room", file), "utf8"))
		.join("\n");

	it("keeps the tour targets on the dashboard", () => {
		const tour: Record<string, string> = {
			"feed-now": pageSource,
			fcr: pageSource,
			"next-feeding": controlRoomSource,
		};

		for (const [anchor, source] of Object.entries(tour)) {
			expect(source, `tour target ${anchor} is missing`).toContain(`data-onboard="${anchor}"`);
		}
	});

	it("keeps every help anchor the dashboard guide points at", () => {
		const sources = new Map<string, string>([
			["app/[locale]/(dashboard)/dashboard/page.tsx", pageSource],
			[
				"components/dashboard/control-room/next-feeding-strip.tsx",
				readFileSync(
					join(webRoot, "components/dashboard/control-room/next-feeding-strip.tsx"),
					"utf8",
				),
			],
			[
				"components/FeedNowButton.tsx",
				readFileSync(join(webRoot, "components/FeedNowButton.tsx"), "utf8"),
			],
			[
				"components/FeedLevelCard.tsx",
				readFileSync(join(webRoot, "components/FeedLevelCard.tsx"), "utf8"),
			],
			[
				"components/WaterTempCard.tsx",
				readFileSync(join(webRoot, "components/WaterTempCard.tsx"), "utf8"),
			],
			[
				"components/FeedingPredictionCard.tsx",
				readFileSync(join(webRoot, "components/FeedingPredictionCard.tsx"), "utf8"),
			],
			[
				"components/export-pdf-button.tsx",
				readFileSync(join(webRoot, "components/export-pdf-button.tsx"), "utf8"),
			],
		]);

		const owners: Record<string, string> = {
			"feed-now": "components/FeedNowButton.tsx",
			fcr: "app/[locale]/(dashboard)/dashboard/page.tsx",
			"dashboard-feed-log": "app/[locale]/(dashboard)/dashboard/page.tsx",
			"dashboard-biomass-log": "app/[locale]/(dashboard)/dashboard/page.tsx",
			"dashboard-hopper": "components/FeedLevelCard.tsx",
			"dashboard-water-temp": "components/WaterTempCard.tsx",
			"ai-advisor": "components/FeedingPredictionCard.tsx",
			"dashboard-export": "components/export-pdf-button.tsx",
		};

		for (const [anchor, file] of Object.entries(owners)) {
			const source = sources.get(file);
			expect(source, `no source loaded for ${file}`).toBeTruthy();
			expect(source ?? "", `data-help="${anchor}" is missing from ${file}`).toContain(
				`data-help="${anchor}"`,
			);
		}

		// The strip owns the help anchor even though the page renders it.
		expect(sources.get("components/dashboard/control-room/next-feeding-strip.tsx")).toContain(
			'data-help="next-feeding"',
		);
	});

	it("still renders the cooperating components that carry their own anchors", () => {
		for (const component of [
			"FeedNowButton",
			"FeedLevelCard",
			"WaterTempCard",
			"FeedingPredictionCard",
			"ExportPdfButton",
		]) {
			expect(pageSource, `${component} is no longer rendered`).toContain(`<${component}`);
		}
	});
});
