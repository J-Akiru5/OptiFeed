"use client";

import { FeedLevelDisplay } from "@/components/feed-level-display";
import { Link, usePathname } from "@/i18n/routing";
import { HOPPER_CAPACITY_KG } from "@/lib/constants";
import { resolveFeedLevelDisplay } from "@/lib/feed-level-display";
import { cn } from "@/lib/utils";
import {
	CalendarDays,
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
	isOffline = false,
	showHopperWidget = true,
}: SidebarProps) {
	const t = useTranslations("nav");
	const pathname = usePathname();

	const navItems = [
		{ href: "/dashboard", label: t("dashboard"), icon: Home },
		{ href: "/dashboard/schedule", label: t("schedule"), icon: Clock },
		{ href: "/dashboard/log-sample", label: t("logSample"), icon: PlusCircle },
		{ href: "/dashboard/history", label: t("history"), icon: History },
		{ href: "/dashboard/growth", label: t("growth"), icon: TrendingUp },
		{ href: "/dashboard/harvest", label: t("harvest"), icon: CalendarDays },
		{ href: "/dashboard/audit", label: t("audit"), icon: FileText },
		{ href: "/dashboard/settings", label: t("settings"), icon: Settings, onboard: "settings" },
	];

	// An offline device keeps its last known reading (decision E4, #192), but the
	// remaining-kg estimate is only meaningful while the device is online.
	const level = resolveFeedLevelDisplay({
		levelPercent: hopperLevelPct,
		updatedAt: hopperLevelUpdatedAt,
		isOffline,
	});

	// Math for remaining metrics
	const capacityKg = HOPPER_CAPACITY_KG;
	const remainingKg =
		level.state === "live" ? (capacityKg * (level.percent / 100)).toFixed(1) : null;
	const scheduledFeedings =
		remainingKg !== null ? Math.floor(Number.parseFloat(remainingKg) / 0.35) : 0;

	return (
		<aside className="hidden lg:flex w-64 bg-white dark:bg-gray-900 border-r border-[#0A3D62]/10 dark:border-gray-700/50 flex-col p-6 shrink-0 sticky top-[64px] h-[calc(100vh-64px)] z-20 overflow-y-auto scrollbar-none">
			<nav aria-label={t("navLabel")} className="space-y-1">
				<p className="text-[10px] font-extrabold uppercase text-[#3D5568] dark:text-gray-400 tracking-widest px-3 mb-3">
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
							className={cn(
								"flex min-h-11 w-full items-center gap-3 rounded-2xl p-3.5 text-[15px] font-bold transition-all focus-visible:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0A3D62] dark:focus-visible:outline-[#8fc0ea]",
								isActive
									? "bg-[#0A3D62] text-white shadow-md transform translate-x-1"
									: "text-[#3D5568] hover:bg-[#F4F7F6] dark:text-gray-300 dark:hover:bg-gray-800",
							)}
						>
							<item.icon aria-hidden="true" className="w-5 h-5 shrink-0" />
							{item.label}
						</Link>
					);
				})}
			</nav>

			{/* Hopper level widget */}
			{showHopperWidget && (
				<div className="bg-[#0A3D62]/5 dark:bg-gray-800/60 rounded-2xl p-4 border border-[#0A3D62]/10 dark:border-gray-700/50 space-y-3 mt-auto">
					<p className="text-[10px] uppercase font-extrabold text-[#3D5568] dark:text-gray-400 tracking-widest flex items-center gap-1.5">
						<Cpu aria-hidden="true" className="w-3.5 h-3.5 text-[#C2410C] dark:text-[#ff8a5c]" />{" "}
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
				</div>
			)}
		</aside>
	);
}
