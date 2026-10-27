"use client";

import { Link, usePathname } from "@/i18n/routing";
import { cn } from "@/lib/utils";
import { Bell, Clock, Compass, Fish, User } from "lucide-react";
import { useTranslations } from "next-intl";

/**
 * The farmer app's five-tab bottom bar (E26).
 *
 * Five destinations, not the previous six: Overview, Schedule, Biomass Log,
 * Alerts and Me. Ponds and feeders have no farmer list page of their own (the
 * pond list lives in the tenant admin console), so the fifth slot is the
 * biomass log — the action farmers take most often — and Alerts replaces the
 * separate History tab. Every other page (History, Growth, Harvest, Audit,
 * Settings) stays one tap away in the "+" quick menu, which is reachable from
 * every screen, so nothing becomes unreachable.
 *
 * The bar is fixed, above the device safe area, and the page passes
 * `--ofd-bottom-nav-h` to its own bottom padding (`.ofd-main`) so no content is
 * hidden behind it.
 */
const TABS = [
	{ href: "/dashboard", key: "overview", icon: Compass },
	{ href: "/dashboard/schedule", key: "schedule", icon: Clock },
	{ href: "/dashboard/log-sample", key: "logSample", icon: Fish },
	{ href: "/dashboard/notifications", key: "alerts", icon: Bell },
	{ href: "/dashboard/settings", key: "me", icon: User },
] as const;

export function BottomNav() {
	const t = useTranslations("nav");
	const pathname = usePathname();

	return (
		<nav
			aria-label={t("navLabel")}
			className="fixed right-0 bottom-0 left-0 z-40 border-t border-gray-200 bg-white pb-[env(safe-area-inset-bottom)] shadow-[0_-4px_10px_-4px_rgba(0,0,0,0.12)] lg:hidden dark:border-gray-700 dark:bg-gray-900"
		>
			<ul className="flex items-stretch px-1">
				{TABS.map((tab) => {
					const isActive =
						tab.href === "/dashboard"
							? pathname === "/dashboard"
							: pathname === tab.href || pathname.startsWith(`${tab.href}/`);

					return (
						<li key={tab.key} className="min-w-0 flex-1">
							<Link
								href={tab.href}
								aria-current={isActive ? "page" : undefined}
								className={cn(
									"relative flex min-h-14 flex-col items-center justify-center gap-1 rounded-xl px-1 py-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0A3D62] focus-visible:ring-inset dark:focus-visible:ring-[#8fc0ea]",
									isActive
										? "text-[#C2410C] dark:text-[#ff8a5c]"
										: "text-[#3D5568] hover:text-[#0A3D62] dark:text-gray-300 dark:hover:text-white",
								)}
							>
								{/* Active tab in the brand action colour, with a bar as well as the
								    colour so the state does not rely on hue alone. */}
								<span
									aria-hidden="true"
									className={cn(
										"absolute top-0 h-0.5 w-8 rounded-full transition-opacity",
										isActive ? "bg-[#C2410C] opacity-100 dark:bg-[#ff8a5c]" : "opacity-0",
									)}
								/>
								<tab.icon
									aria-hidden="true"
									size={22}
									className={cn(isActive && "fill-[#C2410C]/15 dark:fill-[#ff8a5c]/15")}
								/>
								<span
									className={cn(
										"w-full truncate text-center text-[10px] leading-tight",
										isActive ? "font-black" : "font-bold",
									)}
								>
									{t(tab.key)}
								</span>
							</Link>
						</li>
					);
				})}
			</ul>
		</nav>
	);
}
