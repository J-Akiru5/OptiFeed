"use client";

import { cn } from "@/lib/utils";

/**
 * Keyboard-reachable chart legend (#629).
 *
 * Recharts' built-in legend is decorative: clicking a series is optional and a
 * keyboard user cannot reach it. This legend is a row of native buttons with
 * `aria-pressed`, so a series can be hidden or restored with Enter/Space, and a
 * static list when the chart has no toggle.
 */

export type ChartLegendItem = {
	key: string;
	label: string;
	color: string;
	/** Optional total or current value shown after the label. */
	value?: string;
	/** Swatch shape; dots for lines, squares for areas/bars. */
	shape?: "dot" | "square";
};

export function ChartLegend({
	items,
	hidden,
	onToggle,
	className,
}: {
	items: ReadonlyArray<ChartLegendItem>;
	/** Keys currently hidden. */
	hidden?: ReadonlySet<string>;
	/** When omitted the legend is a static list. */
	onToggle?: (key: string) => void;
	className?: string;
}) {
	if (items.length === 0) return null;

	return (
		<ul className={cn("mt-3 flex flex-wrap gap-x-4 gap-y-1.5", className)}>
			{items.map((item) => {
				const isHidden = hidden?.has(item.key) ?? false;
				const swatch = (
					<span
						aria-hidden="true"
						className={cn(
							"h-2.5 w-2.5 shrink-0",
							item.shape === "square" ? "rounded-sm" : "rounded-full",
							isHidden && "opacity-40",
						)}
						style={{ backgroundColor: item.color }}
					/>
				);
				const text = (
					<>
						{swatch}
						<span className={cn(isHidden && "line-through opacity-60")}>{item.label}</span>
						{item.value ? (
							<span className="tabular-nums text-[#0A3D62] dark:text-gray-100">{item.value}</span>
						) : null}
					</>
				);

				return (
					<li key={item.key}>
						{onToggle ? (
							<button
								type="button"
								aria-pressed={!isHidden}
								onClick={() => onToggle(item.key)}
								className="flex min-h-8 items-center gap-1.5 rounded-lg px-1 text-[11px] font-bold text-[#3D5568] transition-colors hover:bg-[#F4F7F6] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0A3D62] dark:text-gray-300 dark:hover:bg-gray-800 dark:focus-visible:outline-[#8fc0ea]"
							>
								{text}
							</button>
						) : (
							<span className="flex items-center gap-1.5 text-[11px] font-bold text-[#3D5568] dark:text-gray-300">
								{text}
							</span>
						)}
					</li>
				);
			})}
		</ul>
	);
}
