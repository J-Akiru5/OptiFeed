"use client";

import { FOCUS_RING_ON_DARK } from "@/components/superadmin/ui";
import { Link, usePathname } from "@/i18n/routing";
import { cn } from "@/lib/utils";
import {
	Activity,
	BarChart3,
	CalendarDays,
	Cpu,
	Droplets,
	FolderTree,
	Settings,
	Sparkles,
	Users,
} from "lucide-react";
import { useTranslations } from "next-intl";

/**
 * Platform console navigation below `lg`, where SuperadminSidebar is hidden.
 * Mirrors the sidebar's scope: Devices is the hardware registry plus remote
 * feeder control (M5.2); Ponds remains visibility only; Calendar is the
 * read-only cross-tenant view (E16.2).
 *
 * The labels are shortened so every section fits at 375 px (AI Providers used
 * to be reachable only from the desktop sidebar); the `aria-label` keeps the
 * full section name for screen readers.
 */
const navItems = [
	{ href: "/superadmin", key: "overview", icon: BarChart3 },
	{ href: "/superadmin/calendar", key: "calendar", icon: CalendarDays },
	{ href: "/superadmin/users", key: "users", icon: Users },
	{ href: "/superadmin/orgs", key: "organizations", icon: FolderTree },
	{ href: "/superadmin/ponds", key: "ponds", icon: Droplets },
	{ href: "/superadmin/devices", key: "devices", icon: Cpu },
	{ href: "/superadmin/operations", key: "operations", icon: Activity },
	{ href: "/superadmin/ai-providers", key: "aiProviders", icon: Sparkles },
	{ href: "/superadmin/settings", key: "settings", icon: Settings },
] as const;

export function SuperadminBottomNav() {
	const t = useTranslations("superadmin.shell");
	const pathname = usePathname();

	return (
		<nav
			aria-label={t("bottomNavLabel")}
			className="ofd-band fixed bottom-0 left-0 right-0 z-40 border-t border-white/10 pb-[env(safe-area-inset-bottom)] shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.15)] lg:hidden"
		>
			<ul className="flex items-stretch px-1">
				{navItems.map((item) => {
					const isActive =
						item.href === "/superadmin"
							? pathname === "/superadmin" || pathname === "/superadmin/"
							: pathname.startsWith(item.href);

					return (
						<li key={item.href} className="min-w-0 flex-1">
							<Link
								href={item.href}
								aria-label={t(`nav.${item.key}`)}
								aria-current={isActive ? "page" : undefined}
								className={cn(
									"relative flex min-h-14 flex-col items-center justify-center gap-1 rounded-xl px-1 py-2 transition-colors",
									FOCUS_RING_ON_DARK,
									isActive ? "text-white" : "text-white/80 hover:text-white",
								)}
							>
								<span
									aria-hidden="true"
									className={cn(
										"absolute top-0 h-0.5 w-5 rounded-full bg-[#FF6B35] transition-opacity dark:bg-[#ff8a5c]",
										isActive ? "opacity-100" : "opacity-0",
									)}
								/>
								<item.icon size={20} className="shrink-0" aria-hidden="true" />
								<span
									className={cn(
										"w-full truncate text-center text-[10px] leading-tight",
										isActive ? "font-black" : "font-bold",
									)}
								>
									{t(`shortNav.${item.key}`)}
								</span>
							</Link>
						</li>
					);
				})}
			</ul>
		</nav>
	);
}
