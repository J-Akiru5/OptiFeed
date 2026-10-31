import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

/** Column/heading copy a chart needs from the message catalogue. */
export interface ChartLabels {
	period: string;
	value: string;
	name: string;
	empty: string;
}

export interface ChartProps {
	/** Visible card title. */
	title: string;
	/** Localized text alternative, used as the chart's accessible name. */
	summary: string;
	labels: ChartLabels;
	/**
	 * Card height for the plotting area: a pixel number, or a percentage such as
	 * `"100%"` when the caller sizes the plot area itself (the dashboard does,
	 * through the `ofd-plot` class and the height-based density tiers).
	 */
	height?: ChartHeight;
	className?: string;
	/** Extra classes for the plot area, e.g. the dashboard's `ofd-plot`. */
	plotClassName?: string;
}

/** A pixel height, or a percentage of the (CSS-sized) plot area. */
export type ChartHeight = number | `${number}%`;

/**
 * The frame every chart shares (E15):
 *
 * - a visible title (`figcaption`) and one `role="img"` plot area named by the
 *   caller's localized `summary`;
 * - an optional legend / auxiliary list;
 * - a visually hidden table of the exact plotted data, so a screen-reader user
 *   can read the numbers without interpreting the drawing;
 * - one empty state when there is nothing to plot.
 */
export function ChartFrame({
	title,
	summary,
	emptyLabel,
	isEmpty,
	children,
	aux,
	table,
	className,
	plotClassName,
}: {
	title: string;
	summary: string;
	emptyLabel: string;
	isEmpty: boolean;
	children: ReactNode;
	aux?: ReactNode;
	table: ReactNode;
	className?: string;
	plotClassName?: string;
}) {
	return (
		<figure
			className={cn(
				"flex min-w-0 flex-col rounded-2xl border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-700 dark:bg-gray-900",
				className,
			)}
		>
			<figcaption className="text-sm font-black text-[#0A3D62] dark:text-gray-100">
				{title}
			</figcaption>

			{isEmpty ? (
				<output className="flex flex-1 items-center justify-center py-12 text-center text-sm font-bold text-[#3D5568] dark:text-gray-300">
					{emptyLabel}
				</output>
			) : (
				<>
					<div role="img" aria-label={summary} className={cn("mt-4 w-full flex-1", plotClassName)}>
						{children}
					</div>
					{aux}
					<div className="sr-only">{table}</div>
				</>
			)}
		</figure>
	);
}

/** Hidden table for a single-series chart. */
export function SingleSeriesTable({
	points,
	labels,
	caption,
}: {
	points: ReadonlyArray<{ label: string; value: number }>;
	labels: ChartLabels;
	caption: string;
}) {
	return (
		<table>
			<caption>{caption}</caption>
			<thead>
				<tr>
					<th scope="col">{labels.period}</th>
					<th scope="col">{labels.value}</th>
				</tr>
			</thead>
			<tbody>
				{points.map((point) => (
					<tr key={point.label}>
						<th scope="row">{point.label}</th>
						<td>{point.value}</td>
					</tr>
				))}
			</tbody>
		</table>
	);
}

/** Hidden table for a stacked/grouped multi-series chart. */
export function MultiSeriesTable({
	rows,
	series,
	labels,
	caption,
}: {
	rows: ReadonlyArray<Record<string, number | string | null | undefined>>;
	series: ReadonlyArray<{ key: string; label: string }>;
	labels: ChartLabels;
	caption: string;
}) {
	return (
		<table>
			<caption>{caption}</caption>
			<thead>
				<tr>
					<th scope="col">{labels.period}</th>
					{series.map((entry) => (
						<th key={entry.key} scope="col">
							{entry.label}
						</th>
					))}
				</tr>
			</thead>
			<tbody>
				{rows.map((row) => (
					<tr key={String(row.label)}>
						<th scope="row">{row.label}</th>
						{series.map((entry) => {
							const value = row[entry.key];
							return (
								<td key={entry.key}>
									{value === null || value === undefined ? "—" : Number(value)}
								</td>
							);
						})}
					</tr>
				))}
			</tbody>
		</table>
	);
}

/** Hidden table for a donut: one row per named segment. */
export function SegmentTable({
	segments,
	labels,
	caption,
}: {
	segments: ReadonlyArray<{ name: string; value: number }>;
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
				{segments.map((segment) => (
					<tr key={segment.name}>
						<th scope="row">{segment.name}</th>
						<td>{segment.value}</td>
					</tr>
				))}
			</tbody>
		</table>
	);
}
