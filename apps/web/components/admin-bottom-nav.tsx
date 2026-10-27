"use client";

import { QuickMenu } from "@/components/mobile/quick-menu";
import { Link, usePathname } from "@/i18n/routing";
import { cn } from "@/lib/utils";
import { Cpu, Droplets, Home, Users } from "lucide-react";
import { useTranslations } from "next-intl";

/**
 * Admin console navigation below `lg`, where AdminSidebar is hidden.
 *
 * Four primary sections plus a "More" tab, not the previous six: at 375 px a
 * seven-column bar leaves under 44 px per target, and nine sections on the
 * platform bar left 41 px. "More" opens the same quick menu the header band
 * uses, which carries every remaining section (Calendar, Hierarchy, Audit log,
 * Settings) one tap away.
 */
const primary = [
	{ href: "/admin", key: "overview", icon: Home },
	{ href: "/admin/ponds", key: "ponds", icon: Droplets },
	{ href: "/admin/devices", key: "devices", icon: Cpu },
	{ href: "/admin/users", key: "users", icon: Users },
] as const;

export function AdminBottomNav() {
	const t = useTranslations("dashboard.adminShell");
	const pathname = usePathname();

	const isCurrent = (href: string) =>
		href === "/admin" ? pathname === "/admin" : pathname.startsWith(href);
	const moreActive = !primary.some((item) => isCurrent(item.href));

	return (
		<nav
			aria-label={t("mobileNavLabel")}
			className="ofd-band fixed right-0 bottom-0 left-0 z-40 border-t border-white/10 pb-[env(safe-area-inset-bottom)] shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.15)] lg:hidden"
		>
			<ul className="flex items-stretch px-1">
				{primary.map((item) => {
					const isActive = isCurrent(item.href);

					return (
						<li key={item.href} className="min-w-0 flex-1">
							<Link
								href={item.href}
								aria-current={isActive ? "page" : undefined}
								className={cn(
									"relative flex min-h-14 flex-col items-center justify-center gap-1 rounded-xl px-1 py-2 transition-colors focus-visible:ring-2 focus-visible:ring-white focus-visible:outline-none",
									isActive ? "text-white" : "text-white/75 hover:text-white",
								)}
							>
								{/* Colour alone is not the only active signal: a bar marks it. */}
								<span
									aria-hidden="true"
									className={cn(
										"absolute top-0 h-0.5 w-6 rounded-full bg-[#FF6B35] transition-opacity dark:bg-[#ff8a5c]",
										isActive ? "opacity-100" : "opacity-0",
									)}
								/>
								<item.icon aria-hidden="true" size={22} className="shrink-0" />
								<span
									className={cn(
										"w-full truncate text-center text-[10px] leading-tight",
										isActive ? "font-black" : "font-bold",
									)}
								>
									{t(`nav.${item.key}`)}
								</span>
							</Link>
						</li>
					);
				})}
				<li className="min-w-0 flex-1">
					<QuickMenu
						shell="admin"
						isTenantAdmin
						trigger="more"
						label={t("nav.more")}
						active={moreActive}
					/>
				</li>
			</ul>
		</nav>
	);
}
