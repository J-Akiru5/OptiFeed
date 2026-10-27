"use client";

import type { ChartPoint } from "@/components/charts/chart-data";
import { type ChartLabels, SingleSeriesTable } from "@/components/charts/chart-frame";
import { useChartTheme } from "@/components/charts/chart-theme";
import { useId } from "react";
import { Area, AreaChart, ResponsiveContainer } from "recharts";

export interface SparklineProps {
	points: ChartPoint[];
	/** Localized text alternative for the sparkline. */
	summary: string;
	labels: ChartLabels;
	color?: string;
	height?: number;
	className?: string;
}

/**
 * A tiny trend strip for a KPI card. It carries the same accessible summary and
 * hidden data table as the large charts, just without the card chrome.
 */
export function Sparkline({
	points,
	summary,
	labels,
	color,
	height = 48,
	className,
}: SparklineProps) {
	const theme = useChartTheme();
	const stroke = color ?? theme.secondary;
	const reactId = useId();
	const gradientId = `sparkline-fill-${reactId.replace(/[:]/g, "")}`;

	if (points.length === 0) {
		return (
			<output className={className}>
				<span className="text-[10px] font-bold text-[#3D5568] dark:text-gray-400">
					{labels.empty}
				</span>
			</output>
		);
	}

	return (
		<div className={className}>
			<div role="img" aria-label={summary} className="w-full">
				<ResponsiveContainer width="100%" height={height}>
					<AreaChart data={points} margin={{ top: 2, right: 0, left: 0, bottom: 2 }}>
						<defs>
							<linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
								<stop offset="0%" stopColor={stroke} stopOpacity={0.28} />
								<stop offset="100%" stopColor={stroke} stopOpacity={0} />
							</linearGradient>
						</defs>
						<Area
							type="monotone"
							dataKey="value"
							stroke={stroke}
							strokeWidth={2}
							fill={`url(#${gradientId})`}
							dot={false}
							isAnimationActive={false}
						/>
					</AreaChart>
				</ResponsiveContainer>
			</div>
			<div className="sr-only">
				<SingleSeriesTable points={points} labels={labels} caption={summary} />
			</div>
		</div>
	);
}
