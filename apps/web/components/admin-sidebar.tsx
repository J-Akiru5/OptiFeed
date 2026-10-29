"use client";

import { SidebarCollapseToggle, useSidebarCollapse } from "@/components/sidebar-collapse";
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
	const tSidebar = useTranslations("sidebar");
	const pathname = usePathname();
	const { collapsed, animate, toggle } = useSidebarCollapse();

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
			data-collapsed={collapsed ? "true" : undefined}
			className={cn(
				"sticky top-[64px] z-20 hidden h-[calc(100vh-64px)] shrink-0 flex-col overflow-y-auto bg-[#0A3D62] text-white lg:flex",
				collapsed ? "w-[76px] p-3" : "w-64 p-6",
				animate && "transition-[width,padding] duration-200 ease-out motion-reduce:transition-none",
			)}
		>
			<nav id="admin-sidebar-nav" aria-label={t("navLabel")} className="space-y-1">
				<p
					className={cn(
						"mb-3 px-3 text-[10px] font-extrabold tracking-widest text-white/75 uppercase",
						collapsed && "sr-only",
					)}
				>
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
							aria-label={collapsed ? item.label : undefined}
							title={collapsed ? item.label : undefined}
							className={cn(
								"flex min-h-11 w-full items-center rounded-2xl text-[15px] font-bold transition-all focus-visible:ring-2 focus-visible:ring-white focus-visible:outline-none",
								collapsed ? "justify-center p-3" : "gap-3 p-3.5",
								isActive
									? cn("bg-[#C2410C] text-white shadow-md", !collapsed && "translate-x-1")
									: "text-white/75 hover:bg-white/10 hover:text-white",
							)}
						>
							<item.icon aria-hidden="true" className="h-5 w-5 shrink-0" />
							<span className={cn(collapsed && "sr-only")}>{item.label}</span>
						</Link>
					);
				})}
			</nav>

			<div className="mt-auto space-y-1 border-t border-white/10 pt-6">
				<Link
					href="/dashboard"
					aria-label={collapsed ? t("backToDashboard") : undefined}
					title={collapsed ? t("backToDashboard") : undefined}
					className={cn(
						"flex min-h-11 items-center rounded-2xl text-sm font-bold text-white/70 transition-all hover:bg-white/10 hover:text-white focus-visible:ring-2 focus-visible:ring-white focus-visible:outline-none",
						collapsed ? "justify-center p-3" : "gap-3 p-3.5",
					)}
				>
					<BarChart3 aria-hidden="true" className="h-4 w-4 shrink-0" />
					<span className={cn(collapsed && "sr-only")}>{t("backToDashboard")}</span>
				</Link>
				<SidebarCollapseToggle
					collapsed={collapsed}
					onToggle={toggle}
					labelCollapse={tSidebar("collapse")}
					labelExpand={tSidebar("expand")}
					controls="admin-sidebar-nav"
					tone="dark"
				/>
			</div>
		</aside>
	);
}
