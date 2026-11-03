"use client";

import { ChartSkeleton } from "@/components/charts/chart-skeleton";
import { type ComponentProps, Suspense, lazy } from "react";

/**
 * Lazy entry points for the chart primitives that pull in Recharts (#629).
 *
 * A page that imports from `@/components/charts` gets the chart library in its
 * initial client bundle even when the plot is below the fold. Importing the
 * same component from here instead splits it into its own chunk: the module is
 * fetched when React first renders the chart, and the skeleton reserves the
 * plot area until it arrives.
 *
 * Charts that are plain DOM/SVG (heatmap, timeline, sparkline) are not wrapped:
 * they are cheap and lazy-loading them would trade a request for nothing.
 *
 * The wrappers forward every prop unchanged, so a caller swaps only the import.
 * The fallback reads the instance's own localized labels, which a module-level
 * `next/dynamic` loading component cannot do.
 */

const DonutLazy = lazy(() =>
	import("@/components/charts/donut").then((module) => ({ default: module.Donut })),
);

const LineTrendLazy = lazy(() =>
	import("@/components/charts/line-trend").then((module) => ({ default: module.LineTrend })),
);

const MultiLineTrendLazy = lazy(() =>
	import("@/components/charts/multi-line-trend").then((module) => ({
		default: module.MultiLineTrend,
	})),
);

const StackedBarsLazy = lazy(() =>
	import("@/components/charts/stacked-bars").then((module) => ({ default: module.StackedBars })),
);

const StackedAreaLazy = lazy(() =>
	import("@/components/charts/stacked-area").then((module) => ({ default: module.StackedArea })),
);

const TreemapLazy = lazy(() =>
	import("@/components/charts/treemap").then((module) => ({ default: module.Treemap })),
);

const RadialGaugeLazy = lazy(() =>
	import("@/components/charts/radial-gauge").then((module) => ({
		default: module.RadialGauge,
	})),
);

/** `loadingLabel` is localized by the caller; `title` is the label of last resort. */
function fallbackFor(props: {
	height?: number | `${number}%`;
	loadingLabel?: string;
	title: string;
}) {
	const height = typeof props.height === "number" ? props.height : 220;
	return <ChartSkeleton height={height} label={props.loadingLabel ?? props.title} />;
}

export function LazyDonut(props: ComponentProps<typeof DonutLazy>) {
	return (
		<Suspense fallback={fallbackFor(props)}>
			<DonutLazy {...props} />
		</Suspense>
	);
}

export function LazyLineTrend(props: ComponentProps<typeof LineTrendLazy>) {
	return (
		<Suspense fallback={fallbackFor(props)}>
			<LineTrendLazy {...props} />
		</Suspense>
	);
}

export function LazyMultiLineTrend(props: ComponentProps<typeof MultiLineTrendLazy>) {
	return (
		<Suspense fallback={fallbackFor(props)}>
			<MultiLineTrendLazy {...props} />
		</Suspense>
	);
}

export function LazyStackedBars(props: ComponentProps<typeof StackedBarsLazy>) {
	return (
		<Suspense fallback={fallbackFor(props)}>
			<StackedBarsLazy {...props} />
		</Suspense>
	);
}

export function LazyStackedArea(props: ComponentProps<typeof StackedAreaLazy>) {
	return (
		<Suspense fallback={fallbackFor(props)}>
			<StackedAreaLazy {...props} />
		</Suspense>
	);
}

export function LazyTreemap(props: ComponentProps<typeof TreemapLazy>) {
	return (
		<Suspense fallback={fallbackFor(props)}>
			<TreemapLazy {...props} />
		</Suspense>
	);
}

export function LazyRadialGauge(props: ComponentProps<typeof RadialGaugeLazy>) {
	return (
		<Suspense fallback={fallbackFor(props)}>
			<RadialGaugeLazy {...props} />
		</Suspense>
	);
}
