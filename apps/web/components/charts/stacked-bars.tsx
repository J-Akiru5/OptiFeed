"use client";

import {
	type StackedSeries,
	formatAxisDay,
	formatChartNumber,
	stackedValue,
} from "@/components/charts/chart-data";
import {
	ChartFrame,
	type ChartHeight,
	type ChartProps,
	MultiSeriesTable,
} from "@/components/charts/chart-frame";
import { seriesColor, tooltipStyle, useChartTheme } from "@/components/charts/chart-theme";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

export interface StackedBarsProps extends ChartProps {
	stack: StackedSeries;
	/** Localized labels for the source keys, in the same order. */
	seriesLabels: Record<string, string>;
	unit?: string;
	decimals?: number;
	height?: ChartHeight;
}

/** Bars per day, split by source (scheduled / dashboard / button). */
export function StackedBars({
	title,
	summary,
	labels,
	stack,
	seriesLabels,
	unit,
	decimals = 0,
	height = 220,
	className,
	plotClassName,
}: StackedBarsProps) {
	const theme = useChartTheme();
	const series = stack.sources.map((key, index) => ({
		key,
		label: seriesLabels[key] ?? key,
		color: seriesColor(index),
	}));

	return (
		<ChartFrame
			title={title}
			summary={summary}
			emptyLabel={labels.empty}
			isEmpty={stack.rows.length === 0}
			className={className}
			plotClassName={plotClassName}
			table={
				<MultiSeriesTable rows={stack.rows} series={series} labels={labels} caption={summary} />
			}
			aux={
				series.length > 0 ? (
					<ul className="ofd-chart-legend mt-3 flex flex-wrap gap-x-4 gap-y-1.5">
						{series.map((entry) => (
							<li
								key={entry.key}
								className="flex items-center gap-1.5 text-[11px] font-bold text-[#3D5568] dark:text-gray-300"
							>
								<span
									aria-hidden="true"
									className="h-2.5 w-2.5 shrink-0 rounded-sm"
									style={{ backgroundColor: entry.color }}
								/>
								<span>{entry.label}</span>
								<span className="tabular-nums text-[#0A3D62] dark:text-gray-100">
									{formatChartNumber(stack.totalsBySource[entry.key] ?? 0, unit)}
								</span>
							</li>
						))}
					</ul>
				) : null
			}
		>
			<ResponsiveContainer width="100%" height={height}>
				<BarChart data={stack.rows} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
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
						cursor={{ fill: theme.grid }}
						formatter={(value: unknown, name: unknown) => [
							formatChartNumber(Number(value), unit),
							String(name),
						]}
					/>
					{series.map((entry) => (
						<Bar
							key={entry.key}
							dataKey={entry.key}
							name={entry.label}
							stackId="stack"
							fill={entry.color}
							isAnimationActive={false}
							maxBarSize={28}
						/>
					))}
				</BarChart>
			</ResponsiveContainer>
		</ChartFrame>
	);
}
