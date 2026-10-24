"use client";

import { Link, usePathname } from "@/i18n/routing";
import { HOPPER_CAPACITY_KG } from "@/lib/constants";
import { cn } from "@/lib/utils";
import {
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
	hopperLevelPct?: number;
	/** True when the ESP32 has not checked in within OFFLINE_THRESHOLD_MS. */
	isOffline?: boolean;
}

export function Sidebar({ hopperLevelPct = 82, isOffline = false }: SidebarProps) {
	const t = useTranslations("nav");
	const pathname = usePathname();

	const navItems = [
		{ href: "/dashboard", label: t("dashboard"), icon: Home },
		{ href: "/dashboard/schedule", label: t("schedule"), icon: Clock },
		{ href: "/dashboard/log-sample", label: t("logSample"), icon: PlusCircle },
		{ href: "/dashboard/history", label: t("history"), icon: History },
		{ href: "/dashboard/growth", label: t("growth"), icon: TrendingUp },
		{ href: "/dashboard/audit", label: t("audit"), icon: FileText },
		{ href: "/dashboard/settings", label: t("settings"), icon: Settings, onboard: "settings" },
	];

	// An offline device cannot be trusted to still hold the feed it last
	// reported, so the widget rests at 0% instead of freezing on the stale
	// reading (GH-100).
	const displayLevelPct = isOffline ? 0 : hopperLevelPct;

	// Math for remaining metrics
	const capacityKg = HOPPER_CAPACITY_KG;
	const remainingKg = (capacityKg * (displayLevelPct / 100)).toFixed(1);
	const scheduledFeedings = Math.floor(Number.parseFloat(remainingKg) / 0.35);

	return (
		<aside className="hidden lg:flex w-64 bg-white dark:bg-gray-900 border-r border-[#0A3D62]/10 dark:border-gray-700/50 flex-col p-6 shrink-0 sticky top-[64px] h-[calc(100vh-64px)] z-20 overflow-y-auto scrollbar-none">
			<div className="space-y-1">
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
							className={cn(
								"w-full flex items-center gap-3 p-3.5 rounded-2xl font-bold transition-all text-[15px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#E85A2A]",
								isActive
									? "bg-[#0A3D62] text-white shadow-md transform translate-x-1"
									: "text-[#3D5568] hover:bg-[#F4F7F6] dark:text-gray-300 dark:hover:bg-gray-800",
							)}
						>
							<item.icon className="w-5 h-5 shrink-0" />
							{item.label}
						</Link>
					);
				})}
			</div>

			{/* Hopper level widget */}
			<div className="bg-[#0A3D62]/5 dark:bg-gray-800/60 rounded-2xl p-4 border border-[#0A3D62]/10 dark:border-gray-700/50 space-y-3 mt-auto">
				<p className="text-[10px] uppercase font-extrabold text-[#3D5568] dark:text-gray-400 tracking-widest flex items-center gap-1.5">
					<Cpu className="w-3.5 h-3.5 text-[#E85A2A]" /> {t("hopperLevel")}
					{isOffline && (
						<span className="ml-auto rounded-full bg-[#C42B3A]/10 px-1.5 py-0.5 text-[9px] font-bold text-[#C42B3A]">
							{t("deviceOffline")}
						</span>
					)}
				</p>
				<div className="flex items-center justify-between text-xs font-extrabold text-[#0A3D62] dark:text-[#5b9bd5]">
					<span>{t("pondFeedPellet")}</span>
					<span>{displayLevelPct}%</span>
				</div>
				<div className="w-full bg-[#3D5568]/20 dark:bg-gray-700 h-2 rounded-full overflow-hidden">
					<div
						className={cn(
							"h-full rounded-full transition-all duration-1000",
							displayLevelPct < 20 ? "bg-[#E85A2A]" : "bg-[#1E7B34]",
						)}
						style={{ width: `${displayLevelPct}%` }}
					/>
				</div>
				<div className="text-[10px] text-[#3D5568] dark:text-gray-400 leading-tight font-mono">
					{isOffline
						? t("hopperOffline")
						: t("hopperRemaining", { kg: remainingKg, count: scheduledFeedings })}
				</div>
			</div>
		</aside>
	);
}
