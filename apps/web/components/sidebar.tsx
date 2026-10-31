"use client";

import { FeedLevelDisplay } from "@/components/feed-level-display";
import { SidebarCollapseToggle, useSidebarCollapse } from "@/components/sidebar-collapse";
import { Link, usePathname } from "@/i18n/routing";
import { getFeedLevelDisplay } from "@/lib/feed-level";
import { cn } from "@/lib/utils";
import {
	CalendarRange,
	Clock,
	Cpu,
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
	showHopperWidget = true,
}: SidebarProps) {
	const t = useTranslations("nav");
	const tSidebar = useTranslations("sidebar");
	const pathname = usePathname();
	const { collapsed, animate, toggle } = useSidebarCollapse();

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

	// An offline device keeps its last known reading (decision E4, #192), but the
	// remaining-feed estimate is only meaningful while the device is online.
	const level = getFeedLevelDisplay({
		levelPercent: hopperLevelPct,
		updatedAt: hopperLevelUpdatedAt,
		isDeviceOffline: isOffline,
		hopperCapacityG,
		gramsPerFeeding: gramsPerFeeding ?? 0,
		feedsPerDay: feedsPerDay ?? 0,
	});

	// Same estimate as the dashboard card (#263): level × the device's capacity,
	// divided by the device's grams per feeding. No hard-coded capacity or dose.
	const remainingKg =
		level.state === "live" && level.remainingGrams !== null
			? (level.remainingGrams / 1000).toFixed(1)
			: null;
	const scheduledFeedings = remainingKg !== null ? (level.feedingsRemaining ?? 0) : 0;

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
				{/* Hopper level widget: the whole card opens the hopper chart (#286). */}
				{showHopperWidget &&
					(collapsed ? (
						<Link
							href="/dashboard/history#hopper-level"
							aria-label={t("viewHopperLevel")}
							title={t("viewHopperLevel")}
							className="flex min-h-11 w-full flex-col items-center justify-center gap-1 rounded-2xl border border-[#0A3D62]/10 bg-[#0A3D62]/5 p-2 transition-colors hover:border-[#0A3D62]/25 hover:bg-[#0A3D62]/10 dark:border-gray-700/50 dark:bg-gray-800/60 dark:hover:border-gray-600 dark:hover:bg-gray-800 focus-visible:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0A3D62] dark:focus-visible:outline-[#8fc0ea]"
						>
							<Cpu aria-hidden="true" className="w-4 h-4 text-[#C2410C] dark:text-[#ff8a5c]" />
							<span className="font-mono text-[10px] font-bold tabular-nums text-[#0A3D62] dark:text-gray-200">
								{level.percent !== null ? `${level.percent}%` : "—"}
							</span>
						</Link>
					) : (
						<Link
							href="/dashboard/history#hopper-level"
							aria-label={t("viewHopperLevel")}
							className="block bg-[#0A3D62]/5 dark:bg-gray-800/60 rounded-2xl p-4 border border-[#0A3D62]/10 dark:border-gray-700/50 space-y-3 transition-colors hover:border-[#0A3D62]/25 hover:bg-[#0A3D62]/10 dark:hover:border-gray-600 dark:hover:bg-gray-800 focus-visible:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0A3D62] dark:focus-visible:outline-[#8fc0ea]"
						>
							<p className="text-[10px] uppercase font-extrabold text-[#3D5568] dark:text-gray-400 tracking-widest flex items-center gap-1.5">
								<Cpu
									aria-hidden="true"
									className="w-3.5 h-3.5 text-[#C2410C] dark:text-[#ff8a5c]"
								/>{" "}
								{t("hopperLevel")}
							</p>
							<div className="flex items-center justify-between text-xs font-extrabold text-[#0A3D62] dark:text-[#5b9bd5]">
								<span>{t("pondFeedPellet")}</span>
							</div>
							<FeedLevelDisplay
								levelPercent={hopperLevelPct}
								updatedAt={hopperLevelUpdatedAt}
								isOffline={isOffline}
								size="sm"
							/>
							{remainingKg !== null && (
								<div className="text-[10px] text-[#3D5568] dark:text-gray-400 leading-tight font-mono">
									{t("hopperRemaining", { kg: remainingKg, count: scheduledFeedings })}
								</div>
							)}
						</Link>
					))}

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
