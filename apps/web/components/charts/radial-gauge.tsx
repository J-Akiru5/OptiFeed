"use client";

import { formatChartNumber } from "@/components/charts/chart-data";
import { ChartFrame, type ChartLabels, type ChartProps } from "@/components/charts/chart-frame";
import { CHART_COLORS, tooltipStyle, useChartTheme } from "@/components/charts/chart-theme";
import { PolarAngleAxis, RadialBar, RadialBarChart, ResponsiveContainer, Tooltip } from "recharts";

export type RadialGaugeTone = "primary" | "success" | "warning" | "danger";

export interface RadialGaugeProps extends ChartProps {
	value: number;
	max: number;
	unit?: string;
	/** Visible centre caption, e.g. `Fleet online`. */
	label: string;
	tone?: RadialGaugeTone;
	height?: number;
}

const TONE_COLORS: Record<RadialGaugeTone, string> = {
	primary: CHART_COLORS.navy,
	success: CHART_COLORS.green,
	warning: CHART_COLORS.amber,
	danger: CHART_COLORS.red,
};

/** A percentage when no unit is supplied; otherwise the value with its unit. */
function formatGaugeValue(value: number, max: number, unit?: string): string {
	if (!unit || unit === "%") {
		const pct = max > 0 ? Math.round((value / max) * 100) : 0;
		return `${pct}%`;
	}
	return formatChartNumber(value, unit);
}

/** Hidden table: the gauge's single reading, never tooltip-only. */
function GaugeTable({
	label,
	value,
	labels,
	caption,
}: {
	label: string;
	value: string;
	labels: ChartLabels;
	caption: string;
}) {
	return (
		<table>
			<caption>{caption}</caption>
			<thead>
				<tr>
					<th scope="col">{labels.name}</th>
					<th scope="col">{labels.value}</th>
				</tr>
			</thead>
			<tbody>
				<tr>
					<th scope="row">{label}</th>
					<td>{value}</td>
				</tr>
			</tbody>
		</table>
	);
}

/**
 * A single health or utilisation reading as a ring (#629).
 *
 * The centre text and the hidden table each state the value, so the reading
 * does not depend on hovering an arc that Recharts may not expose to the
 * keyboard.
 */
export function RadialGauge({
	title,
	summary,
	labels,
	value,
	max,
	unit,
	label,
	tone = "primary",
	height = 200,
	className,
	plotClassName,
	isLoading = false,
	loadingLabel,
	error = null,
}: RadialGaugeProps) {
	const theme = useChartTheme();
	const hasRange = Number.isFinite(max) && max > 0;
	const isEmpty = !hasRange || !Number.isFinite(value);
	const safeMax = hasRange ? max : 0;
	const clamped = hasRange && Number.isFinite(value) ? Math.min(safeMax, Math.max(0, value)) : 0;
	const displayValue = isEmpty ? "" : formatGaugeValue(clamped, safeMax, unit);
	const color = tone === "primary" ? theme.primary : TONE_COLORS[tone];
	const data = [{ name: label, value: clamped }];

	return (
		<ChartFrame
			title={title}
			summary={summary}
			emptyLabel={labels.empty}
			isEmpty={isEmpty}
			className={className}
			plotClassName={plotClassName}
			isLoading={isLoading}
			loadingLabel={loadingLabel}
			error={error}
			table={<GaugeTable label={label} value={displayValue} labels={labels} caption={summary} />}
		>
			<div className="relative mx-auto w-full" style={{ height }}>
				<ResponsiveContainer width="100%" height="100%">
					<RadialBarChart
						data={data}
						cx="50%"
						cy="50%"
						innerRadius="74%"
						outerRadius="100%"
						startAngle={90}
						endAngle={-270}
					>
						<PolarAngleAxis
							type="number"
							domain={[0, safeMax]}
							tick={false}
							axisLine={false}
							tickLine={false}
						/>
						<RadialBar
							dataKey="value"
							name={label}
							fill={color}
							background={{ fill: theme.grid }}
							barSize={14}
							cornerRadius={999}
							isAnimationActive={false}
						/>
						<Tooltip
							contentStyle={tooltipStyle(theme)}
							formatter={(tooltipValue: unknown, name: unknown) => [displayValue, String(name)]}
						/>
					</RadialBarChart>
				</ResponsiveContainer>

				<div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
					<span className="text-2xl font-black tabular-nums" style={{ color: theme.tooltipText }}>
						{displayValue}
					</span>
					<span
						className="mt-1 max-w-[80%] text-center text-[11px] font-bold"
						style={{ color: theme.muted }}
					>
						{label}
					</span>
				</div>
			</div>
		</ChartFrame>
	);
}
