import { CARD } from "@/components/superadmin/ui";
import { cn } from "@/lib/utils";
import { ArrowDown, ArrowRight, ArrowUp, type LucideIcon } from "lucide-react";
import { Sparkline } from "./sparkline";

/**
 * One number on the Command Center (issue #479, M3C.8).
 *
 * The label, the formatted value and the delta text all arrive from the page;
 * nothing here formats a locale, fetches a figure or invents a threshold. The
 * delta pill carries an arrow *and* the text, so direction survives a
 * greyscale print or a colour-vision difference. `series` is optional: when a
 * caller has no trend yet the card ends at the hint rather than drawing a
 * misleading flat line.
 */

type DeltaDirection = "up" | "down" | "flat";

const DELTA_TONES: Record<DeltaDirection, string> = {
	up: "bg-[#E8F5EC] text-[#1E7B34] dark:bg-emerald-950/50 dark:text-[#4ADE80]",
	down: "bg-[#FDE8EA] text-[#C42B3A] dark:bg-red-950/50 dark:text-[#F87171]",
	flat: "bg-[#F4F7F6] text-[#3D5568] dark:bg-[#162238] dark:text-[#94A3B8]",
};

const DELTA_ICONS: Record<DeltaDirection, LucideIcon> = {
	up: ArrowUp,
	down: ArrowDown,
	flat: ArrowRight,
};

export function KpiTile({
	label,
	value,
	delta,
	hint,
	icon: Icon,
	series,
	sparklineLabel,
	className,
}: {
	label: string;
	value: string;
	delta?: { value: string; direction: DeltaDirection; label?: string };
	hint?: string;
	icon?: LucideIcon;
	series?: number[];
	sparklineLabel?: string;
	className?: string;
}) {
	const DeltaIcon = delta ? DELTA_ICONS[delta.direction] : null;

	return (
		<div className={cn(CARD, "flex flex-col gap-3 p-5", className)}>
			<div className="flex items-start justify-between gap-2">
				<p className="text-[10px] font-extrabold uppercase tracking-wider text-[#3D5568] dark:text-slate-400">
					{label}
				</p>
				{Icon && (
					<Icon
						className="h-4 w-4 shrink-0 text-[#0A3D62]/70 dark:text-slate-400"
						aria-hidden="true"
					/>
				)}
			</div>

			<div className="flex flex-wrap items-baseline gap-2">
				<p className="text-3xl font-black tabular-nums text-[#0A3D62] dark:text-slate-100">
					{value}
				</p>
				{delta?.label && <span className="sr-only">{delta.label}</span>}
				{delta && DeltaIcon && (
					<p
						data-delta={delta.direction}
						className={cn(
							"inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-black tabular-nums",
							DELTA_TONES[delta.direction],
						)}
					>
						<DeltaIcon className="h-3 w-3 shrink-0" aria-hidden="true" />
						{delta.value}
					</p>
				)}
			</div>

			{hint && (
				<p className="text-[11px] leading-snug text-[#3D5568] dark:text-slate-400">{hint}</p>
			)}

			{series && series.length > 0 && (
				<Sparkline points={series} label={sparklineLabel ?? label} tone="accent" className="mt-1" />
			)}
		</div>
	);
}
