import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Shared chart foundation (#629): the range control and filtering, the frame's
 * loading/error/empty states, and the stacked-area primitive's legend/table.
 */

vi.mock("recharts", async () => {
	const React = await import("react");
	const passthrough = ({ children }: { children?: React.ReactNode }) =>
		React.createElement(React.Fragment, null, children);
	return {
		ResponsiveContainer: passthrough,
		AreaChart: passthrough,
		Area: () => null,
		CartesianGrid: () => null,
		Tooltip: () => null,
		XAxis: () => null,
		YAxis: () => null,
	};
});

import type { StackedSeries } from "@/components/charts/chart-data";
import { ChartFrame } from "@/components/charts/chart-frame";
import {
	ChartRangeControl,
	ChartRangeProvider,
	filterByRange,
	isInRange,
	useChartRange,
} from "@/components/charts/chart-range";
import { StackedArea } from "@/components/charts/stacked-area";

const LABELS = { period: "Period", value: "Value", name: "Name", empty: "Nothing to plot" };
const RANGE_LABELS = {
	label: "Date range",
	sevenDays: "7 days",
	thirtyDays: "30 days",
	ninetyDays: "90 days",
	custom: "Custom",
	from: "From",
	to: "To",
};

const NOW = new Date(2026, 10, 3, 12);

afterEach(cleanup);

function Probe() {
	const context = useChartRange();
	return <output data-testid="range">{context?.range.key ?? "none"}</output>;
}

describe("chart range", () => {
	it("filters rows by preset and custom windows", () => {
		const rows = [
			{ date: "2026-11-03", value: 1 },
			{ date: "2026-10-20", value: 2 },
			{ date: "2025-12-01", value: 3 },
		];

		expect(
			filterByRange(rows, (row) => row.date, { key: "7d", from: null, to: null }, NOW),
		).toEqual([{ date: "2026-11-03", value: 1 }]);
		expect(
			filterByRange(rows, (row) => row.date, { key: "90d", from: null, to: null }, NOW),
		).toHaveLength(2);
		// A date-only label is a local calendar day, so the first day of the
		// window is included in every timezone.
		expect(isInRange("2026-10-28", { key: "7d", from: null, to: null }, NOW)).toBe(true);
		expect(isInRange("2026-10-27", { key: "7d", from: null, to: null }, NOW)).toBe(false);
		expect(
			isInRange(
				"2026-10-25",
				{
					key: "custom",
					from: new Date(2026, 9, 20),
					to: new Date(2026, 9, 31),
				},
				NOW,
			),
		).toBe(true);
	});

	it("updates the shared range from the control", () => {
		render(
			<ChartRangeProvider>
				<ChartRangeControl labels={RANGE_LABELS} />
				<Probe />
			</ChartRangeProvider>,
		);

		expect(screen.getByTestId("range").textContent).toBe("90d");
		fireEvent.click(screen.getByRole("button", { name: RANGE_LABELS.sevenDays }));
		expect(screen.getByTestId("range").textContent).toBe("7d");
		expect(
			screen.getByRole("button", { name: RANGE_LABELS.sevenDays }).getAttribute("aria-pressed"),
		).toBe("true");
	});

	it("shows the custom date inputs when custom is chosen", () => {
		render(
			<ChartRangeProvider>
				<ChartRangeControl labels={RANGE_LABELS} />
			</ChartRangeProvider>,
		);

		fireEvent.click(screen.getByRole("button", { name: RANGE_LABELS.custom }));
		expect(screen.getByLabelText(RANGE_LABELS.from)).toBeVisible();
		expect(screen.getByLabelText(RANGE_LABELS.to)).toBeVisible();
	});
});

describe("chart frame states", () => {
	const table = (
		<table>
			<tbody>
				<tr>
					<td>row</td>
				</tr>
			</tbody>
		</table>
	);

	it("renders a labelled loading skeleton", () => {
		const html = renderToStaticMarkup(
			<ChartFrame
				title="Fleet"
				summary="Fleet trend"
				emptyLabel={LABELS.empty}
				isEmpty={false}
				table={table}
				isLoading
				loadingLabel="Loading fleet"
			>
				<div />
			</ChartFrame>,
		);

		expect(html).toContain("Loading fleet");
		expect(html).toContain("<output");
		expect(html).toContain('aria-label="Loading fleet"');
	});

	it("renders an error instead of the plot", () => {
		const html = renderToStaticMarkup(
			<ChartFrame
				title="Fleet"
				summary="Fleet trend"
				emptyLabel={LABELS.empty}
				isEmpty={false}
				table={table}
				error="Could not load fleet data"
			>
				<div />
			</ChartFrame>,
		);

		expect(html).toContain("Could not load fleet data");
		expect(html).toContain('role="alert"');
	});

	it("renders the empty label when there is nothing to plot", () => {
		const html = renderToStaticMarkup(
			<ChartFrame
				title="Fleet"
				summary="Fleet trend"
				emptyLabel={LABELS.empty}
				isEmpty
				table={table}
			>
				<div />
			</ChartFrame>,
		);

		expect(html).toContain(LABELS.empty);
	});
});

describe("StackedArea", () => {
	const stack: StackedSeries = {
		sources: ["scheduled", "dashboard"],
		rows: [
			{ label: "2026-11-02", scheduled: 10, dashboard: 3 },
			{ label: "2026-11-03", scheduled: 8, dashboard: 5 },
		],
		totalsBySource: { scheduled: 18, dashboard: 8 },
	};

	it("renders a toggleable legend and the hidden data table", () => {
		const html = renderToStaticMarkup(
			<StackedArea
				title="Feed volume"
				summary="Feed volume by source"
				labels={LABELS}
				stack={stack}
				seriesLabels={{ scheduled: "Scheduled", dashboard: "Dashboard" }}
				unit="kg"
			/>,
		);

		expect(html).toContain("Scheduled");
		expect(html).toContain("Dashboard");
		expect(html).toContain("18 kg");
		expect(html).toContain("<table>");
	});

	it("renders the empty label for an empty stack", () => {
		const html = renderToStaticMarkup(
			<StackedArea
				title="Feed volume"
				summary="Feed volume by source"
				labels={LABELS}
				stack={{ sources: [], rows: [], totalsBySource: {} }}
				seriesLabels={{}}
			/>,
		);

		expect(html).toContain(LABELS.empty);
	});

	it("renders a single point and a loading skeleton", () => {
		const single = renderToStaticMarkup(
			<StackedArea
				title="Feed volume"
				summary="Feed volume by source"
				labels={LABELS}
				stack={{ ...stack, rows: [stack.rows[0]] }}
				seriesLabels={{ scheduled: "Scheduled", dashboard: "Dashboard" }}
			/>,
		);
		expect(single).toContain("Scheduled");

		const loading = renderToStaticMarkup(
			<StackedArea
				title="Feed volume"
				summary="Feed volume by source"
				labels={LABELS}
				stack={stack}
				seriesLabels={{}}
				isLoading
				loadingLabel="Loading volume"
			/>,
		);
		expect(loading).toContain("Loading volume");
	});

	it("filters its rows and its totals with the page's shared range", () => {
		const today = new Date();
		const old = new Date(today);
		old.setDate(old.getDate() - 30);
		const label = (date: Date) =>
			`${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
				date.getDate(),
			).padStart(2, "0")}`;

		const { container } = render(
			<ChartRangeProvider initial={{ key: "7d", from: null, to: null }}>
				<StackedArea
					title="Feed volume"
					summary="Feed volume by source"
					labels={LABELS}
					stack={{
						sources: ["scheduled"],
						rows: [
							{ label: label(old), scheduled: 99 },
							{ label: label(today), scheduled: 7 },
						],
						totalsBySource: { scheduled: 106 },
					}}
					seriesLabels={{ scheduled: "Scheduled" }}
				/>
			</ChartRangeProvider>,
		);

		const text = container.textContent ?? "";
		expect(text).toContain(label(today));
		expect(text).not.toContain(label(old));
		// The legend total is the visible window, not the unfiltered series.
		expect(text).toContain("7");
		expect(text).not.toContain("106");
	});
});
