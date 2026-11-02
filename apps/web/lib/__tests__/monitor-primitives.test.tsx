import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Activity } from "lucide-react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ActivityFeed } from "@/components/superadmin/monitor/primitives/activity-feed";
import { AttentionList } from "@/components/superadmin/monitor/primitives/attention-list";
import { KpiTile } from "@/components/superadmin/monitor/primitives/kpi-tile";
import { MonitorPanel, PanelGrid } from "@/components/superadmin/monitor/primitives/monitor-panel";
import { Sparkline } from "@/components/superadmin/monitor/primitives/sparkline";
import { StatusMix } from "@/components/superadmin/monitor/primitives/status-mix";

/**
 * The Level-1 presentational primitives for the Platform Command Center
 * (issue #479, M3C.8).
 *
 * Every primitive takes its copy as a prop, so these tests pass English
 * fixtures directly instead of standing up next-intl. The theme guard reads
 * the sources because the console's `superadmin-theme.test.tsx` scans the same
 * tree: a primitive that drops its `dark:` counterpart would otherwise pass
 * here and fail there.
 */

const PRIMITIVES = [
	"monitor-panel.tsx",
	"sparkline.tsx",
	"kpi-tile.tsx",
	"status-mix.tsx",
	"activity-feed.tsx",
	"attention-list.tsx",
];

describe("MonitorPanel", () => {
	it("renders the title, description, meta, action, body and deep-link id", () => {
		const html = renderToStaticMarkup(
			<MonitorPanel
				id="fleet-status"
				title="Fleet status"
				description="The last twenty-four hours."
				meta="Updated two minutes ago"
				action={<a href="/superadmin/devices">Open devices</a>}
			>
				<p>Panel body</p>
			</MonitorPanel>,
		);

		expect(html).toContain("data-monitor-panel");
		expect(html).toContain('id="fleet-status"');
		expect(html).toContain('aria-labelledby="fleet-status-title"');
		expect(html).toContain('id="fleet-status-title"');
		expect(html).toContain("Fleet status");
		expect(html).toContain("The last twenty-four hours.");
		expect(html).toContain("Updated two minutes ago");
		expect(html).toContain('href="/superadmin/devices"');
		expect(html).toContain("<p>Panel body</p>");
	});

	it("marks the accent tone with the brand border in both themes", () => {
		const html = renderToStaticMarkup(
			<MonitorPanel title="Accent" tone="accent">
				Body
			</MonitorPanel>,
		);

		expect(html).toContain("border-[#C2410C]/35");
		expect(html).toContain("dark:border-[#FF8A5C]/45");
	});

	it("keeps the dark surface classes on the card", () => {
		const html = renderToStaticMarkup(<MonitorPanel title="Panel">Body</MonitorPanel>);
		expect(html).toContain("dark:bg-[#111A2C]");
		expect(html).toContain("dark:border-[#24304A]");
	});
});

describe("PanelGrid", () => {
	it("is one column on phones, two at sm and three at xl", () => {
		const html = renderToStaticMarkup(
			<PanelGrid>
				<div>One</div>
				<div>Two</div>
			</PanelGrid>,
		);

		expect(html).toContain("grid-cols-1");
		expect(html).toContain("sm:grid-cols-2");
		expect(html).toContain("xl:grid-cols-3");
		expect(html).toContain("gap-4");
	});
});

describe("Sparkline", () => {
	it("draws a normalised polyline in a 100 x 28 view box with an accessible name", () => {
		const html = renderToStaticMarkup(<Sparkline points={[1, 3, 2]} label="Feeds per day" />);

		expect(html).toContain('role="img"');
		expect(html).toContain('aria-label="Feeds per day"');
		expect(html).toContain('viewBox="0 0 100 28"');
		expect(html).toContain("<polyline");
		expect(html).toContain('points="2,26 50,2 98,14"');
	});

	it("puts a flat series on the middle line", () => {
		const html = renderToStaticMarkup(<Sparkline points={[5, 5, 5]} label="Flat" />);
		expect(html).toContain('points="2,14 50,14 98,14"');
	});

	it("renders a flat line for an empty or single-point series", () => {
		expect(renderToStaticMarkup(<Sparkline points={[]} label="Empty" />)).toContain(
			'points="2,14 98,14"',
		);
		expect(renderToStaticMarkup(<Sparkline points={[7]} label="One" />)).toContain(
			'points="2,14 98,14"',
		);
	});

	it("carries a dark counterpart for every tone", () => {
		const html = renderToStaticMarkup(<Sparkline points={[1, 2]} label="Tone" tone="success" />);
		expect(html).toContain("text-[#1E7B34]");
		expect(html).toContain("dark:text-[#4ADE80]");
	});
});

describe("KpiTile", () => {
	it("renders the label, value, delta text, hint and sparkline", () => {
		const html = renderToStaticMarkup(
			<KpiTile
				label="Active devices"
				value="1,284"
				delta={{ value: "+12%", direction: "up" }}
				hint="Against last week"
				series={[4, 6, 5, 9]}
				sparklineLabel="Active devices over four readings"
			/>,
		);

		expect(html).toContain("Active devices");
		expect(html).toContain("1,284");
		expect(html).toContain("+12%");
		expect(html).toContain('data-delta="up"');
		expect(html).toContain("Against last week");
		expect(html).toContain('aria-label="Active devices over four readings"');
		expect(html).toContain("tabular-nums");
		expect(html).toContain("dark:bg-[#111A2C]");
	});

	it("renders each delta direction with its own state", () => {
		const down = renderToStaticMarkup(
			<KpiTile label="Feeds" value="12" delta={{ value: "-4", direction: "down" }} />,
		);
		const flat = renderToStaticMarkup(
			<KpiTile label="Queued" value="0" delta={{ value: "0%", direction: "flat" }} />,
		);

		expect(down).toContain('data-delta="down"');
		expect(down).toContain("-4");
		expect(flat).toContain('data-delta="flat"');
		expect(flat).toContain("0%");
	});

	it("falls back to the tile label for the sparkline name and omits an empty series", () => {
		const withSeries = renderToStaticMarkup(
			<KpiTile label="Batch size" value="40" series={[1, 2]} />,
		);
		const withoutSeries = renderToStaticMarkup(<KpiTile label="Batch size" value="40" />);

		expect(withSeries).toContain('aria-label="Batch size"');
		expect(withoutSeries).not.toContain("<polyline");
	});
});

describe("StatusMix", () => {
	const items = [
		{ key: "online", label: "Online", value: 30, tone: "ok" as const },
		{ key: "offline", label: "Offline", value: 10, tone: "danger" as const },
	];

	it("computes the share of each item and prints it in the legend", () => {
		const html = renderToStaticMarkup(<StatusMix items={items} totalLabel="Devices" />);

		expect(html).toContain("75%");
		expect(html).toContain("25%");
		expect(html).toContain(">40</text>");
		expect(html).toContain('stroke-width="3.5"');
		expect(html).toContain('viewBox="0 0 120 120"');
	});

	it("names the chart after the items and repeats the data for screen readers", () => {
		const html = renderToStaticMarkup(<StatusMix items={items} totalLabel="Devices" />);

		expect(html).toContain('role="img"');
		expect(html).toContain('aria-label="Devices: 40. Online: 30, Offline: 10"');
		expect(html).toContain('class="sr-only"');
		expect(html).toContain("Online: 30 (75%)");
		expect(html).toContain("Offline: 10 (25%)");
		expect(html).toContain("stroke-[#1E7B34]");
		expect(html).toContain("dark:stroke-[#4ADE80]");
		expect(html).toContain("stroke-[#C42B3A]");
		expect(html).toContain("dark:stroke-[#F87171]");
	});

	it("renders an empty ring and a zero centre when the total is zero", () => {
		const html = renderToStaticMarkup(
			<StatusMix
				items={[{ key: "none", label: "Nothing", value: 0, tone: "neutral" }]}
				totalLabel="Devices"
			/>,
		);

		expect(html).toContain(">0</text>");
		expect(html).toContain("0%");
		expect(html).toContain('aria-label="Devices: 0. Nothing: 0"');
	});
});

describe("ActivityFeed", () => {
	it("renders an ordered list with title, meta and a time element", () => {
		const html = renderToStaticMarkup(
			<ActivityFeed
				empty="Nothing has happened yet."
				items={[
					{
						id: "a1",
						title: "Feeding completed",
						meta: "Pond three",
						time: "09:12",
						tone: "ok",
					},
				]}
			/>,
		);

		expect(html).toContain("<ol");
		expect(html).toContain("<li");
		expect(html).toContain("Feeding completed");
		expect(html).toContain("Pond three");
		expect(html).toContain("<time");
		expect(html).toContain("09:12");
		expect(html).not.toContain("Nothing has happened yet.");
	});

	it("renders the empty prop when there are no rows", () => {
		const html = renderToStaticMarkup(
			<ActivityFeed empty="Nothing has happened yet." items={[]} />,
		);

		expect(html).toContain("Nothing has happened yet.");
		expect(html).not.toContain("<ol");
	});

	it("renders a supplied icon instead of the tone dot", () => {
		const html = renderToStaticMarkup(
			<ActivityFeed
				empty="Empty"
				items={[{ id: "a2", title: "Device approved", time: "10:00", icon: Activity }]}
			/>,
		);

		expect(html).toContain("<svg");
		expect(html).not.toContain("bg-[#3D5568]");
	});
});

describe("AttentionList", () => {
	it("renders severity, title, meta and the optional action", () => {
		const html = renderToStaticMarkup(
			<AttentionList
				empty="Nothing needs attention."
				items={[
					{
						id: "at1",
						title: "Feeder offline",
						meta: "Pond three has not reported since 08:00.",
						severity: "critical",
						action: <button type="button">Acknowledge</button>,
					},
				]}
			/>,
		);

		expect(html).toContain("<ul");
		expect(html).toContain('data-severity="critical"');
		expect(html).toContain("Feeder offline");
		expect(html).toContain("Pond three has not reported since 08:00.");
		expect(html).toContain("Acknowledge");
		expect(html).toContain("<svg");
		expect(html).toContain('aria-hidden="true"');
	});

	it("gives warning and unknown their own icons as well as colours", () => {
		const html = renderToStaticMarkup(
			<AttentionList
				empty="Empty"
				items={[
					{ id: "w", title: "Late job", severity: "warning" },
					{ id: "u", title: "No reading", severity: "unknown" },
				]}
			/>,
		);

		expect(html).toContain('data-severity="warning"');
		expect(html).toContain('data-severity="unknown"');
		// One icon per row, never only a coloured dot.
		expect(html.split("<svg").length - 1).toBe(2);
		expect(html).toContain("dark:text-[#FBBF24]");
		expect(html).toContain("dark:text-[#94A3B8]");
	});

	it("renders the empty prop when there are no rows", () => {
		const html = renderToStaticMarkup(
			<AttentionList empty="Nothing needs attention." items={[]} />,
		);

		expect(html).toContain("Nothing needs attention.");
		expect(html).not.toContain("<ul");
	});
});

describe("theme guard", () => {
	it("keeps a dark counterpart in every primitive source", () => {
		for (const file of PRIMITIVES) {
			const source = readFileSync(
				join(__dirname, "../../components/superadmin/monitor/primitives", file),
				"utf8",
			);
			expect(source, `${file} has no dark: utility`).toContain("dark:");
		}
	});
});
