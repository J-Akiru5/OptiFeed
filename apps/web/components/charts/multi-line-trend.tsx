"use client";

import type { MultiSeries } from "@/components/charts/chart-data";
import { formatAxisDay, formatChartNumber } from "@/components/charts/chart-data";
import { ChartFrame, type ChartProps, MultiSeriesTable } from "@/components/charts/chart-frame";
import { seriesColor, tooltipStyle, useChartTheme } from "@/components/charts/chart-theme";
import {
	CartesianGrid,
	Line,
	LineChart,
	ResponsiveContainer,
	Tooltip,
	XAxis,
	YAxis,
} from "recharts";

export interface MultiLineTrendProps extends ChartProps {
	/** Buckets as rows, one column per series (e.g. one line per sampling batch). */
	series: MultiSeries;
	/** Localized labels for the series keys, in the same order. */
	seriesLabels: Record<string, string>;
	unit?: string;
	decimals?: number;
	height?: number;
}

/**
 * Several trend lines on one set of axes (average body weight per sampling
 * batch). A missing bucket is a gap, not a zero: `connectNulls` stays off so a
 * batch that was not sampled that day is visibly absent.
 */
export function MultiLineTrend({
	title,
	summary,
	labels,
	series,
	seriesLabels,
	unit,
	decimals = 1,
	height = 240,
	className,
}: MultiLineTrendProps) {
	const theme = useChartTheme();
	const lines = series.series.map((key, index) => ({
		key,
		label: seriesLabels[key] ?? key,
		color: seriesColor(index),
	}));

	return (
		<ChartFrame
			title={title}
			summary={summary}
			emptyLabel={labels.empty}
			isEmpty={lines.length === 0}
			className={className}
			table={
				<MultiSeriesTable rows={series.rows} series={lines} labels={labels} caption={summary} />
			}
			aux={
				lines.length > 0 ? (
					<ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5">
						{lines.map((entry) => (
							<li
								key={entry.key}
								className="flex items-center gap-1.5 text-[11px] font-bold text-[#3D5568] dark:text-gray-300"
							>
								<span
									aria-hidden="true"
									className="h-2.5 w-2.5 shrink-0 rounded-full"
									style={{ backgroundColor: entry.color }}
								/>
								<span>{entry.label}</span>
							</li>
						))}
					</ul>
				) : null
			}
		>
			<ResponsiveContainer width="100%" height={height}>
				<LineChart data={series.rows} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
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
						width={52}
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
							value === null || value === undefined ? "—" : formatChartNumber(Number(value), unit),
							String(name),
						]}
					/>
					{lines.map((entry) => (
						<Line
							key={entry.key}
							type="monotone"
							dataKey={entry.key}
							name={entry.label}
							stroke={entry.color}
							strokeWidth={2.5}
							connectNulls={false}
							dot={{ r: 3, strokeWidth: 0, fill: entry.color }}
							activeDot={{ r: 4 }}
							isAnimationActive={false}
						/>
					))}
				</LineChart>
			</ResponsiveContainer>
		</ChartFrame>
	);
}
