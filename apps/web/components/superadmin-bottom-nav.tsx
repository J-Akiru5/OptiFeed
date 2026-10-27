"use client";

import { QuickMenu } from "@/components/mobile/quick-menu";
import { FOCUS_RING_ON_DARK } from "@/components/superadmin/ui";
import { Link, usePathname } from "@/i18n/routing";
import { cn } from "@/lib/utils";
import { BarChart3, CalendarDays, Cpu, FolderTree } from "lucide-react";
import { useTranslations } from "next-intl";

/**
 * Platform console navigation below `lg`, where SuperadminSidebar is hidden.
 *
 * Four primary sections plus a "More" tab. The console grew to nine sections
 * (analytics, calendar, users, organizations, ponds, devices, operations, AI
 * providers, settings) and nine columns at 375 px leave 41 px per target,
 * below the 44 px minimum this redesign must meet. "More" opens the same quick
 * menu as the header band, which lists every section with its full name.
 */
const primary = [
	{ href: "/superadmin", key: "overview", icon: BarChart3 },
	{ href: "/superadmin/calendar", key: "calendar", icon: CalendarDays },
	{ href: "/superadmin/devices", key: "devices", icon: Cpu },
	{ href: "/superadmin/orgs", key: "organizations", icon: FolderTree },
] as const;

export function SuperadminBottomNav() {
	const t = useTranslations("superadmin.shell");
	const pathname = usePathname();

	const isCurrent = (href: string) =>
		href === "/superadmin" ? pathname === "/superadmin" : pathname.startsWith(href);
	const moreActive = !primary.some((item) => isCurrent(item.href));

	return (
		<nav
			aria-label={t("bottomNavLabel")}
			className="ofd-band fixed right-0 bottom-0 left-0 z-40 border-t border-white/10 pb-[env(safe-area-inset-bottom)] shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.15)] lg:hidden"
		>
			<ul className="flex items-stretch px-1">
				{primary.map((item) => {
					const isActive = isCurrent(item.href);

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
								<item.icon size={22} className="shrink-0" aria-hidden="true" />
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
				<li className="min-w-0 flex-1">
					<QuickMenu
						shell="platform"
						isTenantAdmin={false}
						trigger="more"
						label={t("shortNav.more")}
						active={moreActive}
					/>
				</li>
			</ul>
		</nav>
	);
}
