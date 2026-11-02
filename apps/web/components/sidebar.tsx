"use client";

import { SidebarCollapseToggle, useSidebarCollapse } from "@/components/sidebar-collapse";
import { MonitoringCard } from "@/components/status/monitoring-card";
import type { MonitoringConnection, MonitoringHealth } from "@/components/status/monitoring-status";
import { Link, usePathname } from "@/i18n/routing";
import { cn } from "@/lib/utils";
import {
	CalendarRange,
	Clock,
	FileText,
	History,
	Home,
	PlusCircle,
	Settings,
	TrendingUp,
} from "lucide-react";
import { useTranslations } from "next-intl";

interface SidebarProps {
	hopperLevelPct?: number | null;
	/** When the last hopper-level reading arrived. */
	hopperLevelUpdatedAt?: Date | null;
	/** The device's hopper capacity, so kg remaining matches the reading. */
	hopperCapacityG?: number | null;
	/** The device's configured grams per feeding (#263). */
	gramsPerFeeding?: number | null;
	/** Meals per day from the active pond/schedule. */
	feedsPerDay?: number | null;
	/** True when the ESP32 has not checked in within OFFLINE_THRESHOLD_MS. */
	isOffline?: boolean;
	/** True when the unit is online but the hopper sensor is not answering (#574). */
	isSensorOffline?: boolean;
	/** The resolved three-state connection, including "missing" (#575). */
	connection?: MonitoringConnection;
	/** Safe mode / active faults for the consolidated monitoring card (#575). */
	health?: MonitoringHealth | null;
	/**
	 * False for a platform admin outside view-as (E18, #199): the hopper widget
	 * is farm hardware chrome a platform admin does not have.
	 */
	showHopperWidget?: boolean;
}

export function Sidebar({
	hopperLevelPct = null,
	hopperLevelUpdatedAt = null,
	hopperCapacityG = null,
	gramsPerFeeding = null,
	feedsPerDay = null,
	isOffline = false,
	isSensorOffline = false,
	connection,
	health = null,
	showHopperWidget = true,
}: SidebarProps) {
	const t = useTranslations("nav");
	const tSidebar = useTranslations("sidebar");
	const pathname = usePathname();
	const { collapsed, animate, toggle } = useSidebarCollapse();

	// Callers that only know the two-state prop keep the old behaviour; the
	// dashboard layout passes the full three-state result from loadPondHopper.
	const resolvedConnection = connection ?? (isOffline ? "offline" : "online");

	const navItems = [
		{ href: "/dashboard", label: t("dashboard"), icon: Home },
		{ href: "/dashboard/schedule", label: t("schedule"), icon: Clock },
		{ href: "/dashboard/log-sample", label: t("logSample"), icon: PlusCircle },
		{ href: "/dashboard/history", label: t("history"), icon: History },
		{ href: "/dashboard/growth", label: t("growth"), icon: TrendingUp },
		{ href: "/dashboard/calendar", label: t("calendar"), icon: CalendarRange },
		{ href: "/dashboard/audit", label: t("audit"), icon: FileText },
		{ href: "/dashboard/settings", label: t("settings"), icon: Settings, onboard: "settings" },
	];

	return (
		<aside
			data-collapsed={collapsed ? "true" : undefined}
			className={cn(
				"hidden h-full shrink-0 flex-col overflow-y-auto border-r border-[#0A3D62]/10 bg-white scrollbar-none dark:border-gray-700/50 dark:bg-gray-900 lg:flex",
				collapsed ? "w-[76px] p-3" : "w-64 p-6",
				animate && "transition-[width,padding] duration-200 ease-out motion-reduce:transition-none",
			)}
		>
			<nav id="farmer-sidebar-nav" aria-label={t("navLabel")} className="space-y-1">
				<p
					className={cn(
						"text-[10px] font-extrabold uppercase text-[#3D5568] dark:text-gray-400 tracking-widest px-3 mb-3",
						collapsed && "sr-only",
					)}
				>
					{t("operatorMenu")}
				</p>
				{navItems.map((item) => {
					// Exact match for dashboard home, startsWith for child routes
					const isActive =
						item.href === "/dashboard" ? pathname === "/dashboard" : pathname.startsWith(item.href);

					return (
						<Link
							key={item.href}
							href={item.href}
							data-onboard={item.onboard}
							aria-current={isActive ? "page" : undefined}
							aria-label={collapsed ? item.label : undefined}
							title={collapsed ? item.label : undefined}
							className={cn(
								"flex min-h-11 w-full items-center rounded-2xl text-[15px] font-bold transition-all focus-visible:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0A3D62] dark:focus-visible:outline-[#8fc0ea]",
								collapsed ? "justify-center p-3" : "gap-3 p-3.5",
								isActive
									? cn("bg-[#0A3D62] text-white shadow-md", !collapsed && "transform translate-x-1")
									: "text-[#3D5568] hover:bg-[#F4F7F6] dark:text-gray-300 dark:hover:bg-gray-800",
							)}
						>
							<item.icon aria-hidden="true" className="w-5 h-5 shrink-0" />
							<span className={cn(collapsed && "sr-only")}>{item.label}</span>
						</Link>
					);
				})}
			</nav>

			<div className="mt-auto space-y-4">
				{/* #575: one card for the hopper reading, connection state and
				    fault/safe-mode line. The whole card opens the hopper chart (#286). */}
				{showHopperWidget && (
					<MonitoringCard
						hopperLevelPct={hopperLevelPct}
						hopperLevelUpdatedAt={hopperLevelUpdatedAt}
						hopperCapacityG={hopperCapacityG}
						gramsPerFeeding={gramsPerFeeding}
						feedsPerDay={feedsPerDay}
						isOffline={isOffline}
						sensorOffline={isSensorOffline}
						connection={resolvedConnection}
						health={health}
						collapsed={collapsed}
					/>
				)}

				<div className="border-t border-[#0A3D62]/10 pt-4 dark:border-gray-700/50">
					<SidebarCollapseToggle
						collapsed={collapsed}
						onToggle={toggle}
						labelCollapse={tSidebar("collapse")}
						labelExpand={tSidebar("expand")}
						controls="farmer-sidebar-nav"
					/>
				</div>
			</div>
		</aside>
	);
}
