"use client";

import { DarkModeToggle } from "@/components/dark-mode-toggle";
import { SearchTrigger } from "@/components/search/global-search";
import { cn } from "@/lib/utils";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { QuickMenu } from "./quick-menu";
import { type MobileShell, useMobilePageTitle } from "./use-page-title";

/**
 * The 44 px pill every icon control in the band wears, so search, the theme
 * switch and the overflow menu read as one cluster instead of three sizes. The
 * size is the WCAG 2.5.8 target minimum, which the pond switcher's 16 px text
 * button did not meet.
 */
const BAND_PILL =
	"h-11 w-11 rounded-full border border-white/15 bg-white/10 text-white hover:bg-white/20 [&_svg]:h-[18px] [&_svg]:w-[18px]";

/**
 * The coloured header band every shell shows below `lg` (E26).
 *
 * One band, three shells: the PakaonAI navy gradient from the design tokens,
 * the current page's title (duplicated from the page's own `<h1>`, so it is
 * `aria-hidden` for assistive tech), and one control cluster — theme, search
 * and the overflow menu.
 *
 * **One row, like the platform bars.** A phone app bar is a single 44–64 px
 * row: Material's small app bar is 64 dp and its two-tier medium/large variants
 * are deprecated in M3 Expressive, and iOS is 44 pt inline (96 pt only while a
 * large title is expanded). Shipping apps keep destinations in the bottom bar
 * and put at most two or three actions up here — WhatsApp, Slack, Instagram and
 * Spotify all do. This band used to stack a second row (pond name, device
 * status, help, bell, avatar) on top of that, which cost 120 px of an 842 px
 * viewport for controls the page did not need at all times.
 *
 * The pond switcher and the shell's own controls therefore live in the quick
 * menu's sheet, which already implements the portal, `aria-modal`, Escape and
 * Tab wrap. They keep their white-on-navy styling there because the sheet
 * renders them on a navy card.
 *
 * The theme switch lives here rather than only in the desktop row: below `lg`
 * that row is `display: none`, so its toggle measured 0 px wide and a phone
 * had no way to change the mode at all.
 *
 * Desktop keeps its own header row: nothing here renders at `lg` and up.
 */
export function MobileHeader({
	shell,
	isTenantAdmin,
	subtitle,
	children,
	className,
}: {
	shell: MobileShell;
	isTenantAdmin: boolean;
	/** Pond name / farm line, shown in the overflow sheet above the menu. */
	subtitle?: ReactNode;
	/** The shell's own controls (help, profile), shown in the same sheet. */
	children?: ReactNode;
	className?: string;
}) {
	const title = useMobilePageTitle(shell);
	const tShell = useTranslations("superadmin.shell");
	const tAdmin = useTranslations("dashboard.adminShell");
	const eyebrow =
		shell === "admin" ? tAdmin("badge") : shell === "platform" ? tShell("platform") : "PakaonAI";

	return (
		<div className={cn("ofd-band pt-[env(safe-area-inset-top)] lg:hidden", className)}>
			<div className="flex items-center gap-2 px-3 py-2.5">
				<div className="min-w-0 flex-1">
					<p
						aria-hidden="true"
						className="truncate text-[9px] leading-none font-black tracking-[0.16em] text-[var(--ofd-band-ink-muted)] uppercase"
					>
						{eyebrow}
					</p>
					<p
						aria-hidden="true"
						className="mt-1 truncate text-lg leading-none font-black text-[var(--ofd-band-ink)]"
					>
						{title}
					</p>
				</div>
				<div className="flex shrink-0 items-center gap-1.5">
					<DarkModeToggle className={BAND_PILL} />
					<SearchTrigger variant="icon" />
					<QuickMenu
						shell={shell}
						isTenantAdmin={isTenantAdmin}
						trigger="more"
						variant="pill"
						bandContext={subtitle}
						bandActions={children}
					/>
				</div>
			</div>
		</div>
	);
}
