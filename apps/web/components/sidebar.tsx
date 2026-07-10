"use client";

import { Link, usePathname } from "@/i18n/routing";
import { cn } from "@/lib/utils";
import { Clock, Cpu, History, Home, PlusCircle, Settings, TrendingUp } from "lucide-react";
import { useTranslations } from "next-intl";

export function Sidebar({ hopperLevelPct = 82 }: { hopperLevelPct?: number }) {
	const t = useTranslations("nav");
	const pathname = usePathname();

	const navItems = [
		{ href: "/dashboard", label: t("dashboard"), icon: Home },
		{ href: "/dashboard/schedule", label: t("schedule"), icon: Clock },
		{ href: "/dashboard/log-sample", label: t("logSample"), icon: PlusCircle },
		{ href: "/dashboard/history", label: t("history"), icon: History },
		{ href: "/dashboard/growth", label: t("growth"), icon: TrendingUp },
		{ href: "/dashboard/settings", label: t("settings"), icon: Settings },
	];

	// Math for remaining metrics
	const capacityKg = 22.19; // ~22kg full capacity
	const remainingKg = (capacityKg * (hopperLevelPct / 100)).toFixed(1);
	const scheduledFeedings = Math.floor(Number.parseFloat(remainingKg) / 0.35);

	return (
		<aside className="hidden lg:flex w-64 bg-white border-r border-[#0A3D62]/10 flex-col p-6 shrink-0 sticky top-[64px] h-[calc(100vh-64px)] z-20 overflow-y-auto scrollbar-none">
			<div className="space-y-1">
				<p className="text-[10px] font-extrabold uppercase text-[#3D5568] tracking-widest px-3 mb-3">
					Pond Operator Menu
				</p>
				{navItems.map((item) => {
					// Exact match for dashboard home, startsWith for child routes
					const isActive =
						item.href === "/dashboard" ? pathname === "/dashboard" : pathname.startsWith(item.href);

					return (
						<Link
							key={item.href}
							href={item.href}
							className={cn(
								"w-full flex items-center gap-3 p-3.5 rounded-2xl font-bold transition-all text-[15px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#E85A2A]",
								isActive
									? "bg-[#0A3D62] text-white shadow-md transform translate-x-1"
									: "text-[#3D5568] hover:bg-[#F4F7F6]",
							)}
						>
							<item.icon className="w-5 h-5 shrink-0" />
							{item.label}
						</Link>
					);
				})}
			</div>

			{/* Hopper level widget */}
			<div className="bg-[#0A3D62]/5 rounded-2xl p-4 border border-[#0A3D62]/10 space-y-3 mt-auto">
				<p className="text-[10px] uppercase font-extrabold text-[#3D5568] tracking-widest flex items-center gap-1.5">
					<Cpu className="w-3.5 h-3.5 text-[#E85A2A]" /> Hopper level
				</p>
				<div className="flex items-center justify-between text-xs font-extrabold text-[#0A3D62]">
					<span>Pond Feed Pellet</span>
					<span>{hopperLevelPct}%</span>
				</div>
				<div className="w-full bg-[#3D5568]/20 h-2 rounded-full overflow-hidden">
					<div
						className={cn(
							"h-full rounded-full transition-all duration-1000",
							hopperLevelPct < 20 ? "bg-[#E85A2A]" : "bg-[#1E7B34]",
						)}
						style={{ width: `${hopperLevelPct}%` }}
					/>
				</div>
				<div className="text-[10px] text-[#3D5568] leading-tight font-mono">
					Approx. {remainingKg}kg remaining. Enough for {scheduledFeedings} scheduled feedings.
				</div>
			</div>
		</aside>
	);
}
