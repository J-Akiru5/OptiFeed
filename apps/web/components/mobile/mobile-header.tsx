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
 * switch and the quick menu read as one cluster instead of three sizes. The
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
 * and the "+" quick menu. The second row carries whatever the shell needs next
 * to the page identity: the pond name for a farmer, help and the profile menu
 * for the consoles.
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
	/** Pond name / farm line shown under the title. */
	subtitle?: ReactNode;
	/** Right-hand controls for the second row (bell, help, profile). */
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
			<div className="flex items-center gap-2 px-4 pt-2.5">
				<div className="min-w-0 flex-1">
					<p
						aria-hidden="true"
						className="truncate text-[9px] leading-none font-black tracking-[0.16em] text-[var(--ofd-band-ink-muted)] uppercase"
					>
						{eyebrow}
					</p>
					<p
						aria-hidden="true"
						className="mt-1 truncate text-xl leading-tight font-black text-[var(--ofd-band-ink)]"
					>
						{title}
					</p>
				</div>
				<div className="flex shrink-0 items-center gap-1.5">
					<DarkModeToggle className={BAND_PILL} />
					<SearchTrigger variant="icon" />
					<QuickMenu shell={shell} isTenantAdmin={isTenantAdmin} trigger="plus" />
				</div>
			</div>

			<div className="mt-1 flex items-center justify-between gap-2 px-4 pb-2">
				<div className="min-w-0 flex-1 text-[11px] font-bold text-[var(--ofd-band-ink-muted)]">
					{subtitle}
				</div>
				{children ? <div className="flex shrink-0 items-center gap-1.5">{children}</div> : null}
			</div>
		</div>
	);
}
