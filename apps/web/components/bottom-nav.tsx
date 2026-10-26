"use client";

import { Link, usePathname } from "@/i18n/routing";
import { cn } from "@/lib/utils";
import { CalendarDays, Clock, Fish, LayoutDashboard, Settings, TrendingUp } from "lucide-react";
import { useTranslations } from "next-intl";

export function BottomNav() {
	const t = useTranslations("nav");
	const pathname = usePathname();

	const navItems = [
		{ href: "/dashboard", label: t("dashboard"), icon: LayoutDashboard },
		{ href: "/dashboard/schedule", label: t("schedule"), icon: Clock },
		{ href: "/dashboard/log-sample", label: t("logSample"), icon: Fish },
		{ href: "/dashboard/harvest", label: t("harvest"), icon: CalendarDays },
		{ href: "/dashboard/growth", label: t("growth"), icon: TrendingUp },
		{ href: "/dashboard/settings", label: t("settings"), icon: Settings },
	];

	return (
		<nav
			aria-label={t("navLabel")}
			className="lg:hidden fixed bottom-0 left-0 right-0 bg-white dark:bg-gray-900 border-t border-gray-200 dark:border-gray-700 z-40 shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.05)] pb-[env(safe-area-inset-bottom)]"
		>
			<ul className="flex items-center px-1">
				{navItems.map((item) => {
					// We need to account for nested paths or exact matches.
					// For dashboard home it should be exact. For others, startsWith is fine, but exact is safer.
					const isActive =
						item.href === "/dashboard" ? pathname === "/dashboard" : pathname.startsWith(item.href);

					return (
						<li key={item.href} className="flex-1 min-w-0">
							<Link
								href={item.href}
								aria-current={isActive ? "page" : undefined}
								className={cn(
									"flex min-h-11 flex-col items-center justify-center gap-1.5 px-1 py-3 transition-colors focus-visible:outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[#0A3D62] dark:focus-visible:outline-[#8fc0ea]",
									isActive
										? "text-[#C2410C] dark:text-[#ff8a5c]"
										: "text-[#3D5568] hover:text-[#0A3D62] dark:text-gray-300 dark:hover:text-white",
								)}
							>
								<item.icon
									aria-hidden="true"
									size={20}
									className={cn(isActive && "fill-[#C2410C]/10 dark:fill-[#ff8a5c]/10")}
								/>
								<span className="text-[10px] font-bold text-center leading-tight">
									{item.label}
								</span>
							</Link>
						</li>
					);
				})}
			</ul>
		</nav>
	);
}
