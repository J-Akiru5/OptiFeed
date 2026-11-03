"use client";

import { ChartFrame, type ChartProps } from "@/components/charts/chart-frame";
import { filterByRange, useChartRange } from "@/components/charts/chart-range";
import { PH_TZ } from "@/lib/constants";
import { cn } from "@/lib/utils";

/** Farm wall-clock time, independent of the runtime timezone (server = UTC). */
const EVENT_TIME = new Intl.DateTimeFormat("en-US", {
	timeZone: PH_TZ,
	month: "short",
	day: "numeric",
	hour: "numeric",
	minute: "2-digit",
});

export type TimelineTone = "info" | "success" | "warning" | "danger";

export interface TimelineEvent {
	id: string;
	/** ISO timestamp, or a `Date` from the server. */
	at: string | Date;
	title: string;
	detail?: string;
	tone?: TimelineTone;
}

export interface TimelineProps extends ChartProps {
	events: TimelineEvent[];
	/** Localized tone words; the dot is decoration and never the only label. */
	toneLabels?: Partial<Record<TimelineTone, string>>;
}

const DEFAULT_TONE_LABELS: Record<TimelineTone, string> = {
	info: "Info",
	success: "Success",
	warning: "Warning",
	danger: "Danger",
};

const DOT_TONES: Record<TimelineTone, string> = {
	info: "bg-[#0A3D62] dark:bg-[#8fc0ea]",
	success: "bg-[#1E7B34] dark:bg-[#4ADE80]",
	warning: "bg-[#B45309] dark:bg-[#FBBF24]",
	danger: "bg-[#C42B3A] dark:bg-[#F87171]",
};

const BADGE_TONES: Record<TimelineTone, string> = {
	info: "bg-[#E8EEF3] text-[#0A3D62] dark:bg-[#162238] dark:text-[#8fc0ea]",
	success: "bg-[#E8F5EC] text-[#1E7B34] dark:bg-emerald-950/50 dark:text-emerald-300",
	warning: "bg-[#FFF3E8] text-[#B45309] dark:bg-amber-950/50 dark:text-amber-300",
	danger: "bg-[#FDE8EA] text-[#C42B3A] dark:bg-red-950/50 dark:text-red-300",
};

function eventTime(at: string | Date): number {
	const date = at instanceof Date ? at : new Date(at);
	const time = date.getTime();
	return Number.isFinite(time) ? time : Number.NEGATIVE_INFINITY;
}

function timeParts(at: string | Date): { iso: string; label: string } {
	const date = at instanceof Date ? at : new Date(at);
	if (!Number.isFinite(date.getTime())) return { iso: "", label: "—" };
	return { iso: date.toISOString(), label: EVENT_TIME.format(date) };
}

/**
 * Incidents and device events on a vertical time rail.
 *
 * The list is a real ordered list, newest first, and every entry carries a
 * `<time>` plus a written tone ("Warning", not only an amber dot). The rail is
 * decorative; the hidden table repeats the period, title and detail in the same
 * order for a screen reader.
 */
export function Timeline({
	title,
	summary,
	labels,
	events,
	toneLabels,
	className,
	plotClassName,
	isLoading,
	loadingLabel,
	error,
}: TimelineProps) {
	const range = useChartRange();
	const visible = range
		? filterByRange(events, (event) => event.at, range.range, range.now)
		: events;
	const ordered = [...visible].sort((a, b) => {
		const diff = eventTime(b.at) - eventTime(a.at);
		if (Number.isNaN(diff) || diff === 0) return a.id.localeCompare(b.id);
		return diff;
	});
	// One formatting pass: the visible rail and the hidden table must agree.
	const entries = ordered.map((event) => ({
		event,
		tone: event.tone ?? "info",
		time: timeParts(event.at),
	}));

	return (
		<ChartFrame
			title={title}
			summary={summary}
			emptyLabel={labels.empty}
			isEmpty={ordered.length === 0}
			className={className}
			plotClassName={plotClassName}
			isLoading={isLoading}
			loadingLabel={loadingLabel}
			error={error}
			table={
				<table>
					<caption>{summary}</caption>
					<thead>
						<tr>
							<th scope="col">{labels.period}</th>
							<th scope="col">{labels.event ?? labels.name}</th>
							<th scope="col">{labels.detail ?? labels.value}</th>
						</tr>
					</thead>
					<tbody>
						{entries.map(({ event, time }) => (
							<tr key={event.id}>
								<th scope="row">{time.label}</th>
								<td>{event.title}</td>
								<td>{event.detail ?? "—"}</td>
							</tr>
						))}
					</tbody>
				</table>
			}
		>
			<ol
				data-testid="chart-timeline"
				className="space-y-4 border-l border-[#0A3D62]/15 pl-6 dark:border-white/10"
			>
				{entries.map(({ event, tone, time }) => (
					<li key={event.id} className="relative">
						<span
							aria-hidden="true"
							className={cn(
								"absolute top-1 -left-[29px] h-2.5 w-2.5 rounded-full",
								DOT_TONES[tone],
							)}
						/>
						<div className="flex flex-wrap items-center gap-x-2 gap-y-1">
							<span
								className={cn(
									"rounded-full px-2 py-0.5 text-[10px] font-black tracking-wider uppercase",
									BADGE_TONES[tone],
								)}
							>
								{toneLabels?.[tone] ?? DEFAULT_TONE_LABELS[tone]}
							</span>
							<time
								dateTime={time.iso}
								className="text-[11px] font-bold text-[#3D5568] dark:text-gray-300"
							>
								{time.label}
							</time>
						</div>
						<p className="mt-1 text-sm font-bold text-[#0A3D62] dark:text-gray-100">
							{event.title}
						</p>
						{event.detail ? (
							<p className="mt-0.5 text-xs leading-snug font-semibold text-[#3D5568] dark:text-gray-400">
								{event.detail}
							</p>
						) : null}
					</li>
				))}
			</ol>
		</ChartFrame>
	);
}
