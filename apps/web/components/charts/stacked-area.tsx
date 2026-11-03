"use client";

import {
	type StackedSeries,
	formatAxisDay,
	formatChartNumber,
} from "@/components/charts/chart-data";
import { ChartFrame, type ChartProps, MultiSeriesTable } from "@/components/charts/chart-frame";
import { ChartLegend } from "@/components/charts/chart-legend";
import { filterByRange, useChartRange } from "@/components/charts/chart-range";
import { seriesColor, tooltipStyle, useChartTheme } from "@/components/charts/chart-theme";
import { useMemo, useState } from "react";
import {
	Area,
	AreaChart,
	CartesianGrid,
	ResponsiveContainer,
	Tooltip,
	XAxis,
	YAxis,
} from "recharts";

export interface StackedAreaProps extends ChartProps {
	stack: StackedSeries;
	/** Localized labels for the source keys, in the same order. */
	seriesLabels: Record<string, string>;
	unit?: string;
	decimals?: number;
	height?: number;
	/**
	 * Treat the row labels as dates and apply the page's shared range (#629).
	 * A categorical stack that happens to use `Series` rows can opt out.
	 */
	temporal?: boolean;
}

/**
 * Cumulative consumption over time, one stacked band per source.
 *
 * Stacked areas answer "how much in total, split by source" — the companion
 * `StackedBars` answers "how many operations per bucket". The epic keeps those
 * two questions apart (#629); do not swap one for the other.
 */
export function StackedArea({
	title,
	summary,
	labels,
	stack,
	seriesLabels,
	unit,
	decimals = 0,
	height = 240,
	temporal = true,
	className,
	plotClassName,
	isLoading = false,
	loadingLabel,
	error = null,
}: StackedAreaProps) {
	const theme = useChartTheme();
	const range = useChartRange();
	const [hidden, setHidden] = useState<ReadonlySet<string>>(() => new Set());

	const rows = useMemo(() => {
		if (!temporal || !range) return stack.rows;
		return filterByRange(stack.rows, (row) => row.label, range.range, range.now);
	}, [stack.rows, temporal, range]);

	const series = useMemo(
		() =>
			stack.sources.map((key, index) => ({
				key,
				label: seriesLabels[key] ?? key,
				color: seriesColor(index),
			})),
		[stack.sources, seriesLabels],
	);

	const visible = series.filter((entry) => !hidden.has(entry.key));

	// The legend must describe what is plotted: when the shared range filters
	// rows out, an all-time total would contradict the chart beside it.
	const totals = useMemo(() => {
		const result: Record<string, number> = {};
		for (const entry of series) {
			result[entry.key] = rows.reduce((sum, row) => sum + Number(row[entry.key] ?? 0), 0);
		}
		return result;
	}, [rows, series]);

	const toggle = (key: string) => {
		setHidden((previous) => {
			const next = new Set(previous);
			if (next.has(key)) next.delete(key);
			else next.add(key);
			return next;
		});
	};

	return (
		<ChartFrame
			title={title}
			summary={summary}
			emptyLabel={labels.empty}
			isEmpty={rows.length === 0 || series.length === 0}
			className={className}
			plotClassName={plotClassName}
			isLoading={isLoading}
			loadingLabel={loadingLabel}
			error={error}
			aux={
				<ChartLegend
					items={series.map((entry) => ({
						key: entry.key,
						label: entry.label,
						color: entry.color,
						shape: "square",
						value: formatChartNumber(totals[entry.key] ?? 0, unit),
					}))}
					hidden={hidden}
					onToggle={toggle}
				/>
			}
			table={<MultiSeriesTable rows={rows} series={visible} labels={labels} caption={summary} />}
		>
			<ResponsiveContainer width="100%" height={height}>
				<AreaChart
					data={rows}
					margin={{ top: 8, right: 12, left: 0, bottom: 0 }}
					accessibilityLayer
				>
					<CartesianGrid strokeDasharray="3 3" stroke={theme.grid} vertical={false} />
					<XAxis
						dataKey="label"
						tick={{ fill: theme.axis, fontSize: 11 }}
						tickLine={{ stroke: theme.grid }}
						axisLine={{ stroke: theme.grid }}
						minTickGap={24}
						tickFormatter={(value: string) => formatAxisDay(String(value))}
					/>
					<YAxis
						width={48}
						tick={{ fill: theme.axis, fontSize: 11 }}
						tickLine={false}
						axisLine={false}
						allowDecimals={decimals > 0}
						tickFormatter={(value: number) =>
							Number(value).toLocaleString("en-US", { maximumFractionDigits: decimals })
						}
					/>
					<Tooltip
						contentStyle={tooltipStyle(theme)}
						cursor={{ stroke: theme.grid }}
						formatter={(value: unknown, name: unknown) => [
							formatChartNumber(Number(value), unit),
							String(name),
						]}
					/>
					{visible.map((entry) => (
						<Area
							key={entry.key}
							type="monotone"
							dataKey={entry.key}
							name={entry.label}
							stackId="1"
							stroke={entry.color}
							fill={entry.color}
							fillOpacity={0.28}
							strokeWidth={2}
							dot={rows.length === 1 ? { r: 3, strokeWidth: 0, fill: entry.color } : false}
							activeDot={{ r: 4 }}
							isAnimationActive={false}
						/>
					))}
				</AreaChart>
			</ResponsiveContainer>
		</ChartFrame>
	);
}
