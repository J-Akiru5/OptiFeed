"use client";

import {
	type ChartLabels,
	type ChartPoint,
	Donut,
	LineTrend,
	StackedBars,
	type StackedSeries,
} from "@/components/charts";
import type { AdminDeviceHealth } from "@/lib/admin-overview";

interface AdminOverviewChartsProps {
	feedStack: StackedSeries;
	activityPoints: ChartPoint[];
	deviceHealth: AdminDeviceHealth;
	labels: {
		feedTitle: string;
		feedSummary: string;
		activityTitle: string;
		activitySummary: string;
		healthTitle: string;
		healthSummary: string;
		online: string;
		offline: string;
		pending: string;
		sources: Record<string, string>;
		chart: ChartLabels;
	};
}

/**
 * The three Admin Overview graphs (#277). All of them reuse the shared E15
 * chart components, so there is no new chart dependency, dark mode and the
 * screen-reader data tables come for free.
 */
export function AdminOverviewCharts({
	feedStack,
	activityPoints,
	deviceHealth,
	labels,
}: AdminOverviewChartsProps) {
	const segments = [
		{ name: labels.online, value: deviceHealth.online, color: "#1E7B34" },
		{ name: labels.offline, value: deviceHealth.offline, color: "#C42B3A" },
		{ name: labels.pending, value: deviceHealth.pending, color: "#B45309" },
	];

	return (
		<div className="grid min-w-0 gap-4 lg:grid-cols-3">
			<StackedBars
				className="min-w-0 lg:col-span-2"
				title={labels.feedTitle}
				summary={labels.feedSummary}
				labels={labels.chart}
				stack={feedStack}
				seriesLabels={labels.sources}
				unit="g"
				decimals={0}
			/>
			<Donut
				className="min-w-0"
				title={labels.healthTitle}
				summary={labels.healthSummary}
				labels={labels.chart}
				segments={segments}
			/>
			<LineTrend
				className="min-w-0 lg:col-span-3"
				title={labels.activityTitle}
				summary={labels.activitySummary}
				labels={labels.chart}
				points={activityPoints}
			/>
		</div>
	);
}
