"use client";

import { formatChartNumber } from "@/components/charts/chart-data";
import { ChartFrame, type ChartProps, MultiSeriesTable } from "@/components/charts/chart-frame";
import { filterByRange, useChartRange } from "@/components/charts/chart-range";
import { type ChartTheme, useChartTheme } from "@/components/charts/chart-theme";
import { Fragment } from "react";

const HOURS_PER_DAY = 24;
const HOURS = Array.from({ length: HOURS_PER_DAY }, (_, hour) => hour);

/**
 * Opacity ramp for a non-zero cell. Zero keeps the empty surface: the grid
 * answers "when is the pond busy?" and a pale block must never look like
 * activity.
 */
const HEAT_STEPS = [0.15, 0.3, 0.5, 0.72, 1] as const;

const TABLE_SERIES = HOURS.map((hour) => ({ key: `h${hour}`, label: `${hour}:00` }));

export interface HeatmapRow {
	/** Day key (`YYYY-MM-DD`) or any value `Date` understands. */
	date: string;
	/** One value per hour, index 0 = midnight. Missing entries are 0. */
	values: number[];
}

export interface HeatmapProps extends ChartProps {
	rows: HeatmapRow[];
	/** Suffix shown in each cell's tooltip, e.g. `events`. */
	unit?: string;
	/** Force the top of the colour scale (for example a device's daily cap). */
	max?: number;
	/** Localized legend words; the meaning is never carried by shade alone. */
	legendLabels?: { less: string; more: string };
}

function normalizeValues(values: readonly number[] | undefined): number[] {
	return HOURS.map((hour) => {
		const value = values?.[hour] ?? 0;
		return Number.isFinite(value) && value > 0 ? value : 0;
	});
}

function heatStep(value: number, scaleMax: number): number {
	if (value <= 0 || scaleMax <= 0) return 0;
	const ratio = Math.min(1, value / scaleMax);
	const index = Math.min(HEAT_STEPS.length - 1, Math.ceil(ratio * HEAT_STEPS.length) - 1);
	return HEAT_STEPS[index];
}

function cellTitle(date: string, hour: number, value: number, unit?: string): string {
	return `${date} ${hour}:00 — ${formatChartNumber(value, unit)}`;
}

/**
 * Activity by day × hour (feed events, commands, door openings).
 *
 * Recharts cannot express a two-dimensional calendar grid, so the plot is a
 * dependency-free CSS grid: one row per day, 24 cells per row, and the theme's
 * primary colour stepped by opacity. A cell is not focusable — a 90-day grid
 * would add thousands of tab stops — so the keyboard and screen-reader path is
 * the visually hidden table that `ChartFrame` renders from the same values.
 */
export function Heatmap({
	title,
	summary,
	labels,
	rows,
	unit,
	max,
	legendLabels,
	className,
	plotClassName,
	isLoading,
	loadingLabel,
	error,
}: HeatmapProps) {
	const theme = useChartTheme();
	const range = useChartRange();

	const visible = range ? filterByRange(rows, (row) => row.date, range.range, range.now) : rows;
	const matrix = visible.map((row) => ({
		date: row.date,
		values: normalizeValues(row.values),
	}));

	const dataMax = matrix.reduce((current, row) => Math.max(current, ...row.values), 0);
	const isEmpty = matrix.length === 0 || dataMax <= 0;
	const scaleMax = max !== undefined && max > 0 ? max : dataMax;

	const tableRows = matrix.map((row) => {
		const record: Record<string, number | string> = { label: row.date };
		for (const hour of HOURS) record[`h${hour}`] = row.values[hour];
		return record;
	});

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
			aux={
				<HeatmapLegend
					theme={theme}
					less={legendLabels?.less ?? "Less"}
					more={legendLabels?.more ?? "More"}
				/>
			}
			table={
				<MultiSeriesTable
					rows={tableRows}
					series={TABLE_SERIES}
					labels={labels}
					caption={summary}
				/>
			}
		>
			<div data-testid="chart-heatmap-grid" className="overflow-x-auto pb-1">
				<div className="min-w-[540px]">
					<div
						className="grid items-center gap-[3px]"
						style={{
							gridTemplateColumns: `minmax(76px, auto) repeat(${HOURS_PER_DAY}, minmax(0, 1fr))`,
						}}
					>
						<span aria-hidden="true" />
						{HOURS.map((hour) => (
							<span
								key={hour}
								aria-hidden="true"
								className="text-center text-[9px] font-bold text-[#3D5568] tabular-nums dark:text-gray-400"
							>
								{String(hour).padStart(2, "0")}
							</span>
						))}

						{matrix.map((row) => (
							<Fragment key={row.date}>
								<span className="pr-2 text-[10px] font-bold text-[#3D5568] tabular-nums whitespace-nowrap dark:text-gray-300">
									{row.date}
								</span>
								{HOURS.map((hour) => (
									<div
										key={hour}
										title={cellTitle(row.date, hour, row.values[hour], unit)}
										className="h-4 rounded-[3px] bg-[#F4F7F6] ring-1 ring-[#0A3D62]/5 ring-inset dark:bg-gray-800 dark:ring-white/5"
									>
										<span
											aria-hidden="true"
											className="block h-full w-full rounded-[3px]"
											style={{
												backgroundColor: theme.primary,
												opacity: heatStep(row.values[hour], scaleMax),
											}}
										/>
									</div>
								))}
							</Fragment>
						))}
					</div>
				</div>
			</div>
		</ChartFrame>
	);
}

function HeatmapLegend({
	theme,
	less,
	more,
}: {
	theme: ChartTheme;
	less: string;
	more: string;
}) {
	return (
		<div className="mt-3 flex items-center justify-end gap-2 text-[10px] font-bold text-[#3D5568] dark:text-gray-300">
			<span>{less}</span>
			<span aria-hidden="true" className="flex items-center gap-0.5">
				{HEAT_STEPS.map((opacity) => (
					<span
						key={opacity}
						className="h-2.5 w-2.5 rounded-[2px]"
						style={{ backgroundColor: theme.primary, opacity }}
					/>
				))}
			</span>
			<span>{more}</span>
		</div>
	);
}
