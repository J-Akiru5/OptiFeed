"use client";

import { OptiFeedLogo } from "@/components/OptiFeedLogo";
import { DarkModeToggle } from "@/components/dark-mode-toggle";
import { SearchTrigger } from "@/components/search/global-search";
import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

/**
 * The 44 px pill the icon controls in the band wear, so the theme switch and
 * the shell's own control read as one cluster. The size is the WCAG 2.5.8
 * target minimum, which the pond switcher's 16 px text button did not meet.
 */
const BAND_PILL =
	"h-11 w-11 shrink-0 rounded-full border border-white/15 bg-white/10 text-white hover:bg-white/20 [&_svg]:h-[18px] [&_svg]:w-[18px]";

/**
 * The coloured header band every shell shows below `lg` (E26).
 *
 * **One thin row, the way a phone app bar works.** Material's small app bar is
 * a single 64 dp row (its two-tier medium/large variants are deprecated in M3
 * Expressive) and iOS is 44 pt inline. Shipping apps put destinations in the
 * bottom bar and keep the top to the brand, search and the account control —
 * WhatsApp, Slack, Spotify and Instagram all do, and Slack explicitly collapses
 * its header to make room for content.
 *
 * So the band carries: the PakaonAI mark and wordmark, the search field, the
 * theme switch, and whatever account/help control the shell passes as
 * `children`. The pond switcher and device status do **not** live here — they
 * sit in the "More" sheet the bottom bar opens, because a second row here cost
 * 120 px of an 842 px viewport (and moving the shell's own controls into that
 * sheet put an absolutely-positioned account panel inside a modal, which
 * rendered unanchored on top of the list).
 *
 * The theme switch lives here rather than only in the desktop row: below `lg`
 * that row is `display: none`, so its toggle measured 0 px wide and a phone had
 * no way to change the mode at all.
 *
 * Desktop keeps its own header row: nothing here renders at `lg` and up.
 */
export function MobileHeader({
	children,
	showTheme = true,
	className,
}: {
	/** The shell's own control (farmer account menu, console help/profile). */
	children?: ReactNode;
	/**
	 * False when the shell already offers the switch in its account menu. The
	 * farmer band keeps only search, notifications and the account control, so
	 * adding a fourth control here would put the bar back where it started.
	 */
	showTheme?: boolean;
	className?: string;
}) {
	return (
		<div className={cn("ofd-band pt-[env(safe-area-inset-top)] lg:hidden", className)}>
			<div className="flex items-center gap-1.5 px-2.5 py-1.5">
				<span className="flex shrink-0 items-center gap-1.5 pl-0.5">
					<OptiFeedLogo size={26} variant="ondark" />
					<span className="hidden text-sm leading-none font-black text-[var(--ofd-band-ink)] min-[360px]:inline">
						PakaonAI
					</span>
				</span>

				<SearchTrigger
					variant="field"
					className="h-11 w-auto min-w-0 flex-1 border-white/15 bg-white/10"
				/>

				{showTheme ? <DarkModeToggle className={BAND_PILL} /> : null}
				{children}
			</div>
		</div>
	);
}
