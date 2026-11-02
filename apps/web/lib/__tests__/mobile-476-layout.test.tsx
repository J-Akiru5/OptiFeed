import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

/**
 * #476 — the mobile-native pass.
 *
 * The mobile layout is the same DOM tree as the desktop control room, with
 * `max-xl:` utilities that remove the card chrome below 1280 px. These tests
 * pin the parts that must not regress: the band wrapper, the flattened
 * sections, the pond canvas becoming a list (one label per feeder), and the
 * full-width primary action.
 */

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
	usePathname: () => "/dashboard",
	useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
}));

import { FeedLevelCard } from "@/components/FeedLevelCard";
import { ChartFrame } from "@/components/charts/chart-frame";
import {
	CONTROL_ROOM_MOBILE_BAND,
	ControlPanel,
	ControlRoomLayout,
} from "@/components/dashboard/control-room/control-room-shell";
import { NextFeedingStrip } from "@/components/dashboard/control-room/next-feeding-strip";
import { PondOverview } from "@/components/dashboard/control-room/pond-overview";
import { StatTile } from "@/components/dashboard/control-room/rail-panels";

const readingAt = new Date("2026-10-27T09:32:00+08:00");

describe("control room mobile band (#476)", () => {
	it("exports the flat full-bleed band and keeps the desktop shell intact", () => {
		expect(CONTROL_ROOM_MOBILE_BAND).toContain("max-xl:bg-white");
		expect(CONTROL_ROOM_MOBILE_BAND).toContain("max-xl:border-b");

		const html = renderToStaticMarkup(<ControlRoomLayout>content</ControlRoomLayout>);
		expect(html).toContain("flex w-full min-w-0 flex-col");
		expect(html).toContain("max-xl:-mx-4");
		expect(html).toContain("max-xl:-mt-4");
		expect(html).toContain("max-xl:gap-0");
		expect(html).toContain("xl:grid");
	});

	it("flattens ControlPanel below xl without touching the desktop card", () => {
		const html = renderToStaticMarkup(<ControlPanel title="Pond at a glance">body</ControlPanel>);
		expect(html).toContain("rounded-2xl");
		expect(html).toContain("max-xl:rounded-none");
		expect(html).toContain("max-xl:border-0");
		expect(html).toContain("max-xl:bg-transparent");
		expect(html).toContain("max-xl:p-0");
		expect(html).toContain("max-xl:shadow-none");
	});

	it("turns a stat tile into a full-width row below xl", () => {
		const html = renderToStaticMarkup(<StatTile label="FCR" value="1.42" detail="7 days" />);
		expect(html).toContain("max-xl:min-h-11");
		expect(html).toContain("max-xl:border-b");
		expect(html).toContain("max-xl:rounded-none");
		expect(html).toContain("max-xl:bg-transparent");
	});

	it("keeps the hero anchor and drops its card shell below xl", () => {
		const html = renderToStaticMarkup(
			<NextFeedingStrip
				pondName="Demo Pond"
				label="Next feeding"
				time="18:00"
				timeSrLabel="Next feeding time"
				isPaused={false}
				statusLabel="Timer on"
				volumeLabel="Volume"
				volumeValue="120 g"
				rateLabel="Rate"
				rateValue="100%"
				basedOn={null}
				updateLabel="Update biomass"
				updateHref="/dashboard/log-sample"
			/>,
		);
		expect(html).toContain("ofd-hero-strip");
		expect(html).toContain("ofd-hero-time");
		expect(html).toContain("max-xl:rounded-none");
		expect(html).toContain("max-xl:bg-[#EAF1F6]");
	});

	it("renders each feeder once and turns the canvas into a list below xl", () => {
		const html = renderToStaticMarkup(
			<PondOverview
				pondName="Demo Pond"
				feeders={[
					{
						id: "f1",
						label: "Alpha Feeder",
						status: "online",
						isOffline: false,
						isPaused: false,
						levelPercent: 82,
						levelUpdatedAt: readingAt,
						nextFeedLabel: "18:00",
						waterTempLabel: "28.4 °C",
					},
					{
						id: "f2",
						label: "Beta Feeder",
						status: "offline",
						isOffline: true,
						isPaused: false,
						levelPercent: 21,
						levelUpdatedAt: readingAt,
						nextFeedLabel: "19:00",
						waterTempLabel: null,
					},
				]}
			/>,
		);

		expect(html.match(/Alpha Feeder/g)).toHaveLength(1);
		expect(html.match(/Beta Feeder/g)).toHaveLength(1);
		expect(html).toContain("max-xl:hidden");
		expect(html).toContain("max-xl:static");
		expect(html).toContain("max-xl:translate-x-0");
		expect(html).toContain("max-xl:w-full");
		expect(html).toContain("max-xl:border-b");
	});

	it("flattens the hopper card and keeps the low-state accent on mobile", () => {
		const html = renderToStaticMarkup(
			<FeedLevelCard
				levelPercent={12}
				updatedAt={readingAt}
				hopperCapacityG={5000}
				gramsPerFeeding={100}
				feedsPerDay={3}
			/>,
		);
		expect(html).toContain("max-xl:rounded-none");
		expect(html).toContain("max-xl:border-l-4");
		expect(html).toContain("max-xl:p-0");
		expect(html).toContain("max-xl:shadow-none");
	});

	it("flattens a chart card below xl", () => {
		const html = renderToStaticMarkup(
			<ChartFrame
				title="Feed per day"
				summary="A chart"
				emptyLabel="No data"
				isEmpty={false}
				table={<table />}
			>
				<div />
			</ChartFrame>,
		);
		expect(html).toContain("max-xl:rounded-none");
		expect(html).toContain("max-xl:border-0");
		expect(html).toContain("max-xl:last:border-b-0");
	});
});
