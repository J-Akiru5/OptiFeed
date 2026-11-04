"use client";

import { OptiFeedLogo } from "@/components/OptiFeedLogo";
import { DarkModeToggle } from "@/components/dark-mode-toggle";
import { SearchTrigger } from "@/components/search/global-search";
import { useRouter } from "@/i18n/routing";
import { cn } from "@/lib/utils";
import { ChevronLeft } from "lucide-react";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { type MobileShell, useMobileRouteInfo } from "./use-page-title";

/**
 * The 44 px pill the icon controls in the band wear, so the theme switch and
 * the shell's own control read as one cluster. The size is the WCAG 2.5.8
 * target minimum, which the pond switcher's 16 px text button did not meet.
 */
const BAND_PILL =
	"h-11 w-11 shrink-0 rounded-full border border-white/15 bg-white/10 text-white hover:bg-white/20 [&_svg]:h-[18px] [&_svg]:w-[18px]";

/**
 * The mobile app bar every shell shows below `lg` (E26).
 *
 * **A Material contextual app bar, not a compressed desktop header.** Android
 * distinguishes two states: a `top` app bar that names the app and carries its
 * global actions, and a contextual one that replaces the brand with a back
 * arrow and the current screen's title (`m3.material.io/components/app-bars`).
 * Both are one row of 44–64 dp; ours renders 56 dp plus the status-bar inset.
 *
 * - **Destination screens** (Overview, Schedule, Biomass Log, Alerts) show the
 *   PakaonAI mark and wordmark.
 * - **Detail screens** show `←` and the screen title, then the same actions.
 * - **Search is an action, not a field.** The expanded search field made the bar
 *   look like a desktop header and left no room for anything else; tapping the
 *   icon opens the dedicated global-search sheet, which is how Android apps
 *   treat search on a phone (WhatsApp keeps it in the bar as an action, Slack
 *   moved it into the navigation).
 *
 * The theme switch is optional (`showTheme`): the farmer band keeps only search,
 * notifications and the account control, and offers the switch in the account
 * menu instead.
 *
 * Edge-to-edge: the bar renders its own background under a transparent status
 * bar, with `pt-[env(safe-area-inset-top)]` reserving the inset, matching the
 * `viewport-fit=cover` + `interactive-widget=resizes-content` viewport.
 *
 * Desktop keeps its own header row: nothing here renders at `lg` and up.
 */
export function MobileHeader({
	shell,
	children,
	showTheme = true,
	className,
}: {
	shell: MobileShell;
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
	const router = useRouter();
	const t = useTranslations("dashboard.mobile");
	const route = useMobileRouteInfo(shell);

	const goBack = () => {
		// Android's back gesture pops history; only fall back to the shell root
		// when this tab was opened directly and there is nothing to pop.
		if (typeof window !== "undefined" && window.history.length > 1) router.back();
		else router.push(route.parentHref);
	};

	return (
		<div className={cn("ofd-band pt-[env(safe-area-inset-top)] lg:hidden", className)}>
			<div className="flex items-center gap-1.5 px-2.5 py-1.5">
				{route.isTopLevel ? (
					<span className="flex shrink-0 items-center gap-1.5 pl-0.5">
						<OptiFeedLogo size={26} variant="ondark" />
						<span className="hidden text-sm leading-none font-black text-[var(--ofd-band-ink)] min-[360px]:inline">
							PakaonAI
						</span>
					</span>
				) : (
					<>
						<button
							type="button"
							onClick={goBack}
							aria-label={t("back")}
							data-mobile-back
							className={cn(
								BAND_PILL,
								"-ml-0.5 border-transparent bg-transparent hover:bg-white/15",
							)}
						>
							<ChevronLeft aria-hidden="true" className="h-5 w-5" />
						</button>
						{/* The page's own <h1> stays the heading for assistive tech; this copy
						    is the visible screen identity only. */}
						<p
							aria-hidden="true"
							className="min-w-0 flex-1 truncate text-base leading-none font-black text-[var(--ofd-band-ink)]"
						>
							{route.title}
						</p>
					</>
				)}

				<SearchTrigger variant="icon" className={cn(!route.isTopLevel && "ml-auto")} />

				{showTheme ? <DarkModeToggle className={BAND_PILL} /> : null}
				{children}
			</div>
		</div>
	);
}
