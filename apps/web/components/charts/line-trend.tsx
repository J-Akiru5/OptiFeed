"use client";

import { type ChartPoint, formatAxisDay, formatChartNumber } from "@/components/charts/chart-data";
import { ChartFrame, type ChartProps, SingleSeriesTable } from "@/components/charts/chart-frame";
import { tooltipStyle, useChartTheme } from "@/components/charts/chart-theme";
import {
	CartesianGrid,
	Line,
	LineChart,
	ResponsiveContainer,
	Tooltip,
	XAxis,
	YAxis,
} from "recharts";

export interface LineTrendProps extends ChartProps {
	points: ChartPoint[];
	/** Suffix shown in the tooltip, e.g. `kg`. */
	unit?: string;
	/** 0 for whole counts, 1–2 for weights. */
	decimals?: number;
	/** Stroke colour; defaults to the theme's primary navy. */
	color?: string;
}

/** A single trend line over time (sign-ups, kg dispensed, water temperature…). */
export function LineTrend({
	title,
	summary,
	labels,
	points,
	unit,
	decimals = 0,
	height = 220,
	color,
	className,
}: LineTrendProps) {
	const theme = useChartTheme();
	const stroke = color ?? theme.primary;

	return (
		<ChartFrame
			title={title}
			summary={summary}
			emptyLabel={labels.empty}
			isEmpty={points.length === 0}
			className={className}
			table={<SingleSeriesTable points={points} labels={labels} caption={summary} />}
		>
			<ResponsiveContainer width="100%" height={height}>
				<LineChart data={points} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
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
						formatter={(value: unknown) => [formatChartNumber(Number(value), unit), title]}
					/>
					<Line
						type="monotone"
						dataKey="value"
						name={title}
						stroke={stroke}
						strokeWidth={2.5}
						dot={false}
						activeDot={{ r: 4 }}
						isAnimationActive={false}
					/>
				</LineChart>
			</ResponsiveContainer>
		</ChartFrame>
	);
}
