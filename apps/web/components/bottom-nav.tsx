"use client";

import { Link, usePathname } from "@/i18n/routing";
import { cn } from "@/lib/utils";
import { Clock, Fish, History, LayoutDashboard, Settings, TrendingUp } from "lucide-react";
import { useTranslations } from "next-intl";

export function BottomNav() {
	const t = useTranslations("nav");
	const pathname = usePathname();

	const navItems = [
		{ href: "/dashboard", label: t("dashboard"), icon: LayoutDashboard },
		{ href: "/dashboard/schedule", label: t("schedule"), icon: Clock },
		{ href: "/dashboard/log-sample", label: t("logSample"), icon: Fish },
		{ href: "/dashboard/history", label: t("history"), icon: History },
		{ href: "/dashboard/growth", label: t("growth"), icon: TrendingUp },
		{ href: "/dashboard/settings", label: t("settings"), icon: Settings },
	];

	return (
		<nav className="md:hidden fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 z-40 shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.05)] pb-[env(safe-area-inset-bottom)]">
			<ul
				className="flex items-center overflow-x-auto px-2 [&::-webkit-scrollbar]:hidden"
				style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
			>
				{navItems.map((item) => {
					// We need to account for nested paths or exact matches.
					// For dashboard home it should be exact. For others, startsWith is fine, but exact is safer.
					const isActive =
						item.href === "/dashboard" ? pathname === "/dashboard" : pathname.startsWith(item.href);

					return (
						<li key={item.href} className="flex-1 min-w-[76px] shrink-0">
							<Link
								href={item.href}
								className={cn(
									"flex flex-col items-center justify-center gap-1.5 py-3 px-1 transition-colors",
									isActive ? "text-[#E85A2A]" : "text-[#3D5568] hover:text-[#0A3D62]",
								)}
							>
								<item.icon size={20} className={cn(isActive && "fill-[#E85A2A]/10")} />
								<span className="text-[10px] font-bold text-center leading-tight whitespace-nowrap">
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
