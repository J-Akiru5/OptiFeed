import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
	CommandCenterLayout,
	type CommandCenterLayoutProps,
} from "@/components/superadmin/monitor/sections/command-center-layout";

/**
 * Level-2 checks for the Platform Command Center composition (issue #479,
 * M3C.8). The layout takes every visible string as a prop, so a static render
 * exercises it fully: no i18n runtime, no hooks and no data access.
 */

const full = {
	title: "Platform Command Center",
	description: "What is happening across the platform right now.",
	rangeSwitcher: <button type="button">Last 7 days</button>,
	bands: <div>status bands</div>,
	kpis: [
		{
			label: "Organizations",
			value: "24",
			delta: { value: "+2", direction: "up" },
			hint: "active tenants",
			series: [18, 19, 21, 24],
			sparklineLabel: "Organizations over the last four days",
		},
		{
			label: "Devices online",
			value: "87%",
			delta: { value: "-3", direction: "down" },
			hint: "across every organization",
		},
	],
	trend: {
		title: "New accounts",
		description: "Signups per day in the selected range.",
		meta: "7 day window",
		children: <p>chart</p>,
	},
	mix: {
		title: "Fleet status",
		description: "Devices by last known state.",
		items: [
			{ key: "online", label: "Online", value: 112, tone: "ok" },
			{ key: "offline", label: "Offline", value: 16, tone: "danger" },
		],
		totalLabel: "128 devices",
	},
	attention: {
		title: "Needs attention",
		description: "Worst first.",
		items: [
			{
				id: "device-3b09",
				title: "Feeder 3B09 has not reported",
				meta: "Organization Alpha",
				severity: "critical",
				action: <button type="button">Open device</button>,
			},
		],
		empty: "Nothing is waiting in the queue.",
	},
	activity: {
		title: "Recent activity",
		description: "Platform events, newest first.",
		items: [
			{
				id: "event-1",
				title: "Organization suspended",
				meta: "Organization Beta",
				time: "5 minutes ago",
				tone: "warning",
			},
		],
		empty: "No events in this window.",
	},
	footer: <p>footer slot</p>,
} satisfies CommandCenterLayoutProps;

describe("CommandCenterLayout", () => {
	it("renders the title, KPI labels, panel titles and mix legend", () => {
		const markup = renderToStaticMarkup(<CommandCenterLayout {...full} />);

		expect(markup).toContain(`aria-label="${full.title}"`);
		expect(markup).toContain(full.title);
		for (const kpi of full.kpis) {
			expect(markup).toContain(kpi.label);
		}
		expect(markup).toContain(full.trend.title);
		expect(markup).toContain("<p>chart</p>");
		for (const item of full.mix.items) {
			expect(markup).toContain(item.label);
		}
		expect(markup).toContain(full.attention.title);
		expect(markup).toContain(full.activity.title);
	});

	it("renders the slots the page fills", () => {
		const markup = renderToStaticMarkup(<CommandCenterLayout {...full} />);

		expect(markup).toContain("status bands");
		expect(markup).toContain("Last 7 days");
		expect(markup).toContain("footer slot");
	});

	it("renders empty KPI, attention and activity collections with their empty copy", () => {
		const empty: CommandCenterLayoutProps = {
			...full,
			kpis: [],
			attention: { ...full.attention, items: [] },
			activity: { ...full.activity, items: [] },
		};

		const markup = renderToStaticMarkup(<CommandCenterLayout {...empty} />);

		expect(markup).toContain(full.attention.empty);
		expect(markup).toContain(full.activity.empty);
	});

	it("renders the charts slot and omits optional panels that are not supplied", () => {
		const sparse: CommandCenterLayoutProps = {
			title: "Platform Overview",
			bands: <div>bands</div>,
			kpis: [{ label: "Users", value: "140" }],
			trend: { title: "Signups", children: <p>chart</p> },
			charts: <section aria-label="extra charts">extra charts</section>,
		};

		const markup = renderToStaticMarkup(<CommandCenterLayout {...sparse} />);

		expect(markup).toContain("extra charts");
		expect(markup).not.toContain("Needs attention");
		expect(markup).not.toContain("Recent activity");
		// The trend spans the row when there is no mix panel.
		expect(markup).toContain("xl:col-span-3");
	});
});
