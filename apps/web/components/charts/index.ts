/**
 * The chart layer's public surface (#629).
 *
 * Charts that pull in Recharts are also available from `./lazy`, which splits
 * each one into its own chunk. A page that renders a chart below the fold —
 * including the health panels — should import from `./lazy` so the chart
 * library is not in its initial bundle.
 */

export type { ChartPoint, StackedSeries } from "@/components/charts/chart-data";
export type { ChartHeight, ChartLabels, ChartProps } from "@/components/charts/chart-frame";
export {
	ChartFrame,
	MultiSeriesTable,
	SegmentTable,
	SingleSeriesTable,
} from "@/components/charts/chart-frame";
export { ChartLegend, type ChartLegendItem } from "@/components/charts/chart-legend";
export {
	CHART_RANGES,
	type ChartRange,
	ChartRangeControl,
	type ChartRangeKey,
	type ChartRangeLabels,
	ChartRangeProvider,
	DEFAULT_CHART_RANGE,
	filterByRange,
	isInRange,
	rangeEnd,
	rangeStart,
	useChartRange,
} from "@/components/charts/chart-range";
export { ChartSkeleton } from "@/components/charts/chart-skeleton";
export { CHART_COLORS } from "@/components/charts/chart-theme";
export { Donut, type DonutProps, type DonutSegment } from "@/components/charts/donut";
export { Heatmap, type HeatmapProps, type HeatmapRow } from "@/components/charts/heatmap";
export { LineTrend, type LineTrendProps } from "@/components/charts/line-trend";
export { MultiLineTrend, type MultiLineTrendProps } from "@/components/charts/multi-line-trend";
export {
	RadialGauge,
	type RadialGaugeProps,
	type RadialGaugeTone,
} from "@/components/charts/radial-gauge";
export { Sparkline } from "@/components/charts/sparkline";
export { StackedArea, type StackedAreaProps } from "@/components/charts/stacked-area";
export { StackedBars, type StackedBarsProps } from "@/components/charts/stacked-bars";
export {
	Timeline,
	type TimelineEvent,
	type TimelineProps,
	type TimelineTone,
} from "@/components/charts/timeline";
export {
	Treemap,
	type TreemapChild,
	type TreemapDatum,
	type TreemapProps,
} from "@/components/charts/treemap";
