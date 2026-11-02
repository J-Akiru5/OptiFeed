import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * The chart layer's published surface (#629).
 *
 * The new primitives are consumed by the superadmin lanes (#627 H/J), not by
 * this one, so nothing in production imports them yet. This test is the
 * contract: every value and type the barrel promises must exist, and the lazy
 * entry points must really defer the module and show a localized skeleton
 * first. It also keeps the dead-code gate honest — a primitive that is removed
 * from the surface fails here rather than silently disappearing.
 */

vi.mock("recharts", async (importOriginal) => {
	const actual = await importOriginal<typeof import("recharts")>();
	const React = await import("react");
	return {
		...actual,
		ResponsiveContainer: ({ children }: { children?: ReactNode }) =>
			React.createElement(actual.ResponsiveContainer, { width: 480, height: 240, children }),
	};
});

import * as charts from "@/components/charts";
import type {
	ChartHeight,
	ChartLabels,
	ChartLegendItem,
	ChartProps,
	ChartRange,
	ChartRangeKey,
	ChartRangeLabels,
	DonutProps,
	DonutSegment,
	HeatmapProps,
	HeatmapRow,
	LineTrendProps,
	MultiLineTrendProps,
	RadialGaugeProps,
	RadialGaugeTone,
	StackedAreaProps,
	StackedBarsProps,
	TimelineEvent,
	TimelineProps,
	TimelineTone,
	TreemapChild,
	TreemapDatum,
	TreemapProps,
} from "@/components/charts";
import * as lazyCharts from "@/components/charts/lazy";

const LABELS: ChartLabels = {
	period: "Period",
	value: "Value",
	name: "Name",
	empty: "Nothing to plot",
};

// Compile-time assertion that the barrel exports every public type, so a
// consumer in another lane can rely on it.
type PublicTypes = [
	ChartHeight,
	ChartProps,
	ChartLegendItem,
	ChartRange,
	ChartRangeKey,
	ChartRangeLabels,
	DonutProps,
	DonutSegment,
	HeatmapProps,
	HeatmapRow,
	LineTrendProps,
	MultiLineTrendProps,
	RadialGaugeProps,
	RadialGaugeTone,
	StackedAreaProps,
	StackedBarsProps,
	TimelineEvent,
	TimelineProps,
	TimelineTone,
	TreemapChild,
	TreemapDatum,
	TreemapProps,
];
const publicTypes: PublicTypes | null = null;
void publicTypes;

const PUBLIC_FUNCTIONS = [
	"ChartFrame",
	"ChartLegend",
	"ChartRangeControl",
	"ChartRangeProvider",
	"ChartSkeleton",
	"Donut",
	"Heatmap",
	"LineTrend",
	"MultiLineTrend",
	"MultiSeriesTable",
	"RadialGauge",
	"SegmentTable",
	"SingleSeriesTable",
	"Sparkline",
	"StackedArea",
	"StackedBars",
	"Timeline",
	"Treemap",
	"filterByRange",
	"isInRange",
	"rangeEnd",
	"rangeStart",
	"useChartRange",
] as const;

const PUBLIC_LAZY = [
	"LazyDonut",
	"LazyLineTrend",
	"LazyMultiLineTrend",
	"LazyRadialGauge",
	"LazyStackedArea",
	"LazyStackedBars",
	"LazyTreemap",
] as const;

afterEach(cleanup);

describe("chart public surface", () => {
	it("exports every primitive, table and helper", () => {
		for (const name of PUBLIC_FUNCTIONS) {
			expect(typeof charts[name], name).toBe("function");
		}
	});

	it("exports a lazy entry point for every Recharts-backed chart", () => {
		for (const name of PUBLIC_LAZY) {
			expect(typeof lazyCharts[name], name).toBe("function");
		}
	});

	it("exports the shared constants", () => {
		expect(charts.CHART_COLORS.navy).toMatch(/^#/);
		expect(charts.CHART_RANGES).toEqual(["7d", "30d", "90d", "custom"]);
		expect(charts.DEFAULT_CHART_RANGE).toEqual({ key: "90d", from: null, to: null });
	});

	it("defers the chart module and shows a localized skeleton first", async () => {
		render(
			<lazyCharts.LazyStackedArea
				title="Feed volume"
				summary="Feed volume by source"
				labels={LABELS}
				loadingLabel="Loading volume"
				stack={{
					sources: ["scheduled"],
					rows: [{ label: "2026-11-02", scheduled: 4 }],
					totalsBySource: { scheduled: 4 },
				}}
				seriesLabels={{ scheduled: "Scheduled" }}
			/>,
		);

		expect(screen.getByLabelText("Loading volume")).toBeInTheDocument();
		expect(await screen.findByRole("table", { name: "Feed volume by source" })).toBeInTheDocument();
	});
});
