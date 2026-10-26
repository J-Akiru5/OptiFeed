"use client";

import { cn } from "@/lib/utils";
import type { ElementType } from "react";

type CredibilityItem = {
	key: string;
	icon: ElementType;
	label: string;
};

type CredibilityTickerProps = {
	items: CredibilityItem[];
	/** Label shown above the ticker e.g. "Built and evaluated at" */
	builtAtLabel: string;
};

/**
 * Two-column bottom-to-top ticker for the hero credibility strip.
 *
 * Each column independently cycles through all items using a pure-CSS
 * @keyframes animation. Column B is offset by ~40% of the cycle so they're
 * never showing the same item simultaneously.
 *
 * The border between the hero and this strip is replaced by the Wave component
 * (rendered by the parent), so this component has no top border.
 */
export function CredibilityTicker({ items, builtAtLabel }: CredibilityTickerProps) {
	const total = items.length;
	// How tall each "slot" is in rem. Must match the CSS var --ticker-row-h.
	const rowH = 2; // rem

	return (
		<div className="relative overflow-hidden">
			{/* Label */}
			<p className="px-5 pt-3 pb-2 text-[10px] font-semibold tracking-[0.18em] text-white/35 uppercase sm:px-8 lg:px-10">
				{builtAtLabel}
			</p>

			{/* Two-column ticker */}
			<div
				className="flex gap-x-8 overflow-hidden px-5 pb-4 sm:px-8 lg:px-10 [mask-image:linear-gradient(to_bottom,transparent,black_18%,black_82%,transparent)]"
				style={{ height: `${rowH * 2}rem` }}
				aria-hidden="true"
			>
				{/* Column A — starts at item 0 */}
				<TickerColumn items={items} total={total} rowH={rowH} offset={0} />
				{/* Column B — offset by ~2 items so it's never in sync with A */}
				<TickerColumn items={items} total={total} rowH={rowH} offset={2} />
			</div>
		</div>
	);
}

/** A single vertically-scrolling column that cycles through all items. */
function TickerColumn({
	items,
	total,
	rowH,
	offset,
}: {
	items: CredibilityItem[];
	total: number;
	rowH: number;
	offset: number;
}) {
	// Duplicate the list so the CSS loop is seamless (the animation translates
	// by exactly -50%, landing back on an identical copy).
	const doubled = [...items, ...items];
	// Total strip height: 2× the list (we translate by -50% to loop).
	const stripH = rowH * total * 2;
	// Duration scales with item count so the pace feels consistent.
	const duration = total * 2.8;
	// Delay to stagger column B relative to A.
	const delay = -(offset * (duration / total));

	return (
		<div className="relative flex-1 overflow-hidden">
			<ul
				className="ticker-col-scroll absolute inset-x-0 top-0 flex flex-col"
				style={
					{
						"--ticker-duration": `${duration}s`,
						"--ticker-delay": `${delay}s`,
						"--ticker-strip-h": `${stripH}rem`,
						"--ticker-row-h": `${rowH}rem`,
					} as React.CSSProperties
				}
			>
				{doubled.map(({ key, icon: Icon, label }, i) => (
					<li
						// biome-ignore lint/suspicious/noArrayIndexKey: duplicated list for CSS loop
						key={`${key}-${i}`}
						className={cn(
							"flex shrink-0 items-center gap-2 text-[12px] font-medium text-white/60 transition-colors",
						)}
						style={{ height: `${rowH}rem` }}
					>
						<Icon className="size-3.5 shrink-0 text-[#FF8A5C]/70" aria-hidden="true" />
						<span className="truncate">{label}</span>
					</li>
				))}
			</ul>
		</div>
	);
}
