"use client";

import { cn } from "@/lib/utils";
import type { ElementType } from "react";

type CredibilityItem = {
	key: string;
	icon: ElementType;
	label: string;
};

type CredibilityBadgesProps = {
	items: CredibilityItem[];
	builtAtLabel: string;
};

/**
 * Compact pill-badge strip for the hero credibility section.
 * Renders each item as a small frosted-glass chip with an icon.
 * Each badge fades + slides in with a staggered delay on load.
 */
export function CredibilityBadges({ items, builtAtLabel }: CredibilityBadgesProps) {
	return (
		<div className="flex flex-col gap-3 px-5 py-5 sm:px-8 lg:px-10 lg:flex-row lg:items-center lg:gap-6">
			<p className="shrink-0 text-[10px] font-semibold tracking-[0.18em] text-white/35 uppercase">
				{builtAtLabel}
			</p>

			<ul className="flex flex-wrap items-center gap-2">
				{items.map(({ key, icon: Icon, label }, i) => (
					<li
						key={key}
						className={cn(
							"credibility-badge-in",
							"flex items-center gap-1.5 rounded-full",
							"border border-white/10 bg-white/[0.06]",
							"px-3 py-1.5",
							"text-[11px] font-medium text-white/60",
							"backdrop-blur-sm",
							"transition-colors hover:border-white/20 hover:bg-white/[0.10] hover:text-white/80",
						)}
						style={{ animationDelay: `${i * 0.07}s` }}
					>
						<Icon className="size-3 shrink-0 text-[#FF8A5C]/70" aria-hidden="true" />
						{label}
					</li>
				))}
			</ul>
		</div>
	);
}
