"use client";

import { Link, usePathname } from "@/i18n/routing";
import { cn } from "@/lib/utils";
import { CalendarDays, Cpu, Droplets, FileText, Home, Users } from "lucide-react";
import { useTranslations } from "next-intl";

/**
 * Admin console navigation below `lg`, where AdminSidebar is hidden.
 * Hierarchy and Settings stay in the sidebar.
 */
export function AdminBottomNav() {
	const t = useTranslations("dashboard.adminShell");
	const pathname = usePathname();

	const navItems = [
		{ href: "/admin", label: t("nav.overview"), icon: Home },
		{ href: "/admin/calendar", label: t("nav.calendar"), icon: CalendarDays },
		{ href: "/admin/users", label: t("nav.users"), icon: Users },
		{ href: "/admin/ponds", label: t("nav.ponds"), icon: Droplets },
		{ href: "/admin/devices", label: t("nav.devices"), icon: Cpu },
		{ href: "/admin/audit", label: t("nav.audit"), icon: FileText },
	];

	return (
		<nav
			aria-label={t("mobileNavLabel")}
			className="ofd-band fixed right-0 bottom-0 left-0 z-40 border-t border-white/10 pb-[env(safe-area-inset-bottom)] shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.15)] lg:hidden"
		>
			<ul className="flex items-stretch px-1">
				{navItems.map((item) => {
					const isActive =
						item.href === "/admin"
							? pathname === "/admin" || pathname === "/admin/"
							: pathname.startsWith(item.href);

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
