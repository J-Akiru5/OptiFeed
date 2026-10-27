"use client";

import { formatChartNumber, sharePct, sumValues } from "@/components/charts/chart-data";
import { ChartFrame, type ChartProps, SegmentTable } from "@/components/charts/chart-frame";
import { seriesColor, tooltipStyle, useChartTheme } from "@/components/charts/chart-theme";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";

export interface DonutSegment {
	name: string;
	value: number;
	color?: string;
}

export interface DonutProps extends ChartProps {
	segments: DonutSegment[];
	unit?: string;
	height?: number;
}

/** A part-to-whole split (fleet online/offline, alerts by type). */
export function Donut({
	title,
	summary,
	labels,
	segments,
	unit,
	height = 200,
	className,
}: DonutProps) {
	const theme = useChartTheme();
	const total = sumValues(segments);
	const colored = segments.map((segment, index) => ({
		...segment,
		color: segment.color ?? seriesColor(index),
	}));

	return (
		<ChartFrame
			title={title}
			summary={summary}
			emptyLabel={labels.empty}
			isEmpty={colored.length === 0 || total === 0}
			className={className}
			table={<SegmentTable segments={colored} labels={labels} caption={summary} />}
		>
			<div className="flex flex-col items-center gap-4 sm:flex-row sm:justify-center">
				<div className="h-[180px] w-full max-w-[220px] shrink-0">
					<ResponsiveContainer width="100%" height="100%">
						<PieChart>
							<Pie
								data={colored}
								dataKey="value"
								nameKey="name"
								cx="50%"
								cy="50%"
								innerRadius="58%"
								outerRadius="88%"
								paddingAngle={2}
								stroke={theme.tooltipBg}
								strokeWidth={2}
								isAnimationActive={false}
							>
								{colored.map((segment) => (
									<Cell key={segment.name} fill={segment.color} />
								))}
							</Pie>
							<Tooltip
								contentStyle={tooltipStyle(theme)}
								formatter={(value: unknown, name: unknown) => [
									formatChartNumber(Number(value), unit),
									String(name),
								]}
							/>
						</PieChart>
					</ResponsiveContainer>
				</div>

				<ul className="min-w-0 flex-1 space-y-1.5">
					{colored.map((segment) => (
						<li
							key={segment.name}
							className="flex items-center justify-between gap-3 text-[11px] font-bold text-[#3D5568] dark:text-gray-300"
						>
							<span className="flex min-w-0 items-center gap-1.5">
								<span
									aria-hidden="true"
									className="h-2.5 w-2.5 shrink-0 rounded-sm"
									style={{ backgroundColor: segment.color }}
								/>
								<span className="truncate">{segment.name}</span>
							</span>
							<span className="shrink-0 tabular-nums text-[#0A3D62] dark:text-gray-100">
								{formatChartNumber(segment.value, unit)} · {sharePct(segment.value, total)}%
							</span>
						</li>
					))}
				</ul>
			</div>
		</ChartFrame>
	);
}
