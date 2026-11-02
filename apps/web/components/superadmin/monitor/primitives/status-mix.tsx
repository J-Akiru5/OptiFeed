import { cn } from "@/lib/utils";

/**
 * A status mix donut with a written legend (issue #479, M3C.8).
 *
 * The slices are `stroke-dasharray` offsets on one circle per item, so the
 * graphic needs no chart library and stays a server component. Every figure in
 * the legend is also written out: the chart has an accessible name built from
 * the same items, and a visually hidden list repeats label, value and share so
 * the data survives a screen reader, a greyscale print and a small screen.
 *
 * Colour is never the only carrier of meaning: each legend row prints its
 * label and count, and the hidden list is the authoritative reading order.
 */

type StatusTone = "ok" | "warning" | "danger" | "neutral" | "accent";

const SIZE = 120;
const CENTER = SIZE / 2;
const RADIUS = 54;
const STROKE_WIDTH = 3.5;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

const STROKE_TONES: Record<StatusTone, string> = {
	ok: "stroke-[#1E7B34] dark:stroke-[#4ADE80]",
	warning: "stroke-[#B45309] dark:stroke-[#FBBF24]",
	danger: "stroke-[#C42B3A] dark:stroke-[#F87171]",
	neutral: "stroke-[#3D5568] dark:stroke-[#94A3B8]",
	accent: "stroke-[#C2410C] dark:stroke-[#FF8A5C]",
};

const DOT_TONES: Record<StatusTone, string> = {
	ok: "bg-[#1E7B34] dark:bg-[#4ADE80]",
	warning: "bg-[#B45309] dark:bg-[#FBBF24]",
	danger: "bg-[#C42B3A] dark:bg-[#F87171]",
	neutral: "bg-[#3D5568] dark:bg-[#94A3B8]",
	accent: "bg-[#C2410C] dark:bg-[#FF8A5C]",
};

function percent(value: number, total: number): string {
	if (total <= 0) return "0%";
	return `${Math.round((Math.max(0, value) / total) * 100)}%`;
}

export function StatusMix({
	items,
	totalLabel,
	className,
}: {
	items: { key: string; label: string; value: number; tone: StatusTone }[];
	totalLabel: string;
	className?: string;
}) {
	const total = items.reduce((sum, item) => sum + Math.max(0, item.value), 0);

	let running = 0;
	const segments = items.map((item) => {
		const length = total === 0 ? 0 : (Math.max(0, item.value) / total) * CIRCUMFERENCE;
		const offset = running;
		running += length;
		return { key: item.key, tone: item.tone, length, offset };
	});

	const summary = items.map((item) => `${item.label}: ${item.value}`).join(", ");
	const ariaLabel = summary ? `${totalLabel}: ${total}. ${summary}` : `${totalLabel}: ${total}`;

	return (
		<div className={cn("flex flex-col items-center gap-4 sm:flex-row", className)}>
			<div className="flex shrink-0 flex-col items-center gap-1">
				<div role="img" aria-label={ariaLabel}>
					<svg viewBox={`0 0 ${SIZE} ${SIZE}`} className="h-[120px] w-[120px]" aria-hidden="true">
						<circle
							cx={CENTER}
							cy={CENTER}
							r={RADIUS}
							fill="none"
							strokeWidth={STROKE_WIDTH}
							className="stroke-gray-200 dark:stroke-[#24304A]"
						/>
						{segments.map((segment) => (
							<circle
								key={segment.key}
								cx={CENTER}
								cy={CENTER}
								r={RADIUS}
								fill="none"
								strokeWidth={STROKE_WIDTH}
								strokeDasharray={`${segment.length} ${CIRCUMFERENCE - segment.length}`}
								strokeDashoffset={-segment.offset}
								transform={`rotate(-90 ${CENTER} ${CENTER})`}
								className={STROKE_TONES[segment.tone]}
							/>
						))}
						<text
							x={CENTER}
							y={CENTER}
							textAnchor="middle"
							dominantBaseline="central"
							fill="currentColor"
							className="text-[22px] font-black tabular-nums text-[#0A3D62] dark:text-slate-100"
						>
							{total}
						</text>
					</svg>
				</div>
				<p className="text-[10px] font-extrabold uppercase tracking-wider text-[#3D5568] dark:text-slate-400">
					{totalLabel}
				</p>
			</div>

			<ul className="min-w-0 flex-1 space-y-2">
				{items.map((item) => (
					<li key={item.key} className="flex min-w-0 items-center gap-2 text-[11px] leading-tight">
						<span
							aria-hidden="true"
							className={cn("h-2 w-2 shrink-0 rounded-full", DOT_TONES[item.tone])}
						/>
						<span className="min-w-0 flex-1 truncate font-bold text-[#0A3D62] dark:text-slate-100">
							{item.label}
						</span>
						<span className="tabular-nums font-black text-[#0A3D62] dark:text-slate-100">
							{item.value}
						</span>
						<span className="w-10 text-right tabular-nums font-bold text-[#3D5568] dark:text-slate-400">
							{percent(item.value, total)}
						</span>
					</li>
				))}
			</ul>

			<ul className="sr-only">
				{items.map((item) => (
					<li key={`accessible-${item.key}`}>
						{`${item.label}: ${item.value} (${percent(item.value, total)})`}
					</li>
				))}
			</ul>
		</div>
	);
}
