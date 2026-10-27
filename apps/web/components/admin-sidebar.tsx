"use client";

import { Link, usePathname } from "@/i18n/routing";
import { cn } from "@/lib/utils";
import {
	BarChart3,
	CalendarDays,
	Cpu,
	Droplets,
	FileText,
	FolderTree,
	Home,
	Settings,
	Users,
} from "lucide-react";
import { useTranslations } from "next-intl";

export function AdminSidebar() {
	const t = useTranslations("dashboard.adminShell");
	const pathname = usePathname();

	const navItems = [
		{ href: "/admin", label: t("nav.overview"), icon: Home },
		{ href: "/admin/calendar", label: t("nav.calendar"), icon: CalendarDays },
		{ href: "/admin/users", label: t("nav.users"), icon: Users },
		{ href: "/admin/ponds", label: t("nav.ponds"), icon: Droplets },
		{ href: "/admin/devices", label: t("nav.devices"), icon: Cpu },
		{ href: "/admin/hierarchy", label: t("nav.hierarchy"), icon: FolderTree },
		{ href: "/admin/audit", label: t("nav.audit"), icon: FileText },
		{ href: "/admin/settings", label: t("nav.settings"), icon: Settings },
	];

	return (
		<aside
			aria-label={t("sidebarLabel")}
			className="sticky top-[64px] z-20 hidden h-[calc(100vh-64px)] w-64 shrink-0 flex-col overflow-y-auto bg-[#0A3D62] p-6 text-white lg:flex"
		>
			<nav aria-label={t("navLabel")} className="space-y-1">
				<p className="mb-3 px-3 text-[10px] font-extrabold tracking-widest text-white/75 uppercase">
					{t("panelLabel")}
				</p>
				{navItems.map((item) => {
					const isActive =
						item.href === "/admin"
							? pathname === "/admin" || pathname === "/admin/"
							: pathname.startsWith(item.href);

					return (
						<Link
							key={item.href}
							href={item.href}
							aria-current={isActive ? "page" : undefined}
							className={cn(
								"flex w-full items-center gap-3 rounded-2xl p-3.5 text-[15px] font-bold transition-all focus-visible:ring-2 focus-visible:ring-white focus-visible:outline-none",
								isActive
									? "translate-x-1 bg-[#C2410C] text-white shadow-md"
									: "text-white/75 hover:bg-white/10 hover:text-white",
							)}
						>
							<item.icon aria-hidden="true" className="h-5 w-5 shrink-0" />
							{item.label}
						</Link>
					);
				})}
			</nav>

			<div className="mt-auto border-t border-white/10 pt-6">
				<Link
					href="/dashboard"
					className="flex items-center gap-3 rounded-2xl p-3.5 text-sm font-bold text-white/70 transition-all hover:bg-white/10 hover:text-white focus-visible:ring-2 focus-visible:ring-white focus-visible:outline-none"
				>
					<BarChart3 aria-hidden="true" className="h-4 w-4" />
					{t("backToDashboard")}
				</Link>
			</div>
		</aside>
	);
}
