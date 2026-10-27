"use client";

import { clearChatHistory } from "@/components/chat/chat-storage";
import { useChatWidget } from "@/components/chat/chat-widget-provider";
import { DarkModeToggle } from "@/components/dark-mode-toggle";
import { HelpButton } from "@/components/help/help-button";
import { LocaleSwitcher } from "@/components/locale-switcher";
import { NotificationBell } from "@/components/notification-bell";
import { PondSelector } from "@/components/pond-selector";
import { useRouter } from "@/i18n/routing";
import { clearOfflineData } from "@/lib/offline/db";
import { clearDashboardSnapshot } from "@/lib/pwa/snapshot";
import { createClient } from "@/lib/supabase/client";
import { Globe, LogOut, Shield, ShieldAlert, X } from "lucide-react";
import { useLocale } from "next-intl";
import { useState } from "react";

interface HeaderActionsProps {
	ponds?: { id: string; name: string }[];
	activePondId?: string;
	pondName?: string;
	lastSeenAt?: string | null;
	esp32Status?: "online" | "offline" | "missing";
	/** Resolved server-side from the `help.centre` feature flag. */
	helpEnabled?: boolean;
	/** Resolved by the dashboard layout so the header does not fetch after hydration. */
	initialUser?: {
		email: string;
		role: string | null;
		displayName: string | null;
		isTenantAdmin: boolean;
		isPlatformAdmin: boolean;
	};
}

function formatRelativeTime(dateStr: string | null): string {
	if (!dateStr) return "NEVER";
	const date = new Date(dateStr);
	const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
	if (seconds < 60) return "JUST NOW";
	const minutes = Math.floor(seconds / 60);
	if (minutes < 60) return `${minutes} ${minutes === 1 ? "MINUTE" : "MINUTES"} AGO`;
	const hours = Math.floor(minutes / 60);
	if (hours < 24) return `${hours} ${hours === 1 ? "HOUR" : "HOURS"} AGO`;
	const days = Math.floor(hours / 24);
	return `${days} ${days === 1 ? "DAY" : "DAYS"} AGO`;
}

export function HeaderActions({
	ponds = [],
	activePondId = "",
	pondName = "ILO-POND-01",
	lastSeenAt = null,
	esp32Status = "missing",
	helpEnabled = true,
	initialUser,
}: HeaderActionsProps) {
	const [showProfileMenu, setShowProfileMenu] = useState(false);
	const userEmail = initialUser?.email ?? null;
	const isTenantAdmin = initialUser?.isTenantAdmin ?? false;
	const isPlatformAdmin = initialUser?.isPlatformAdmin ?? false;
	const router = useRouter();
	const locale = useLocale();
	const { clearMessages } = useChatWidget();

	const handleLogout = async () => {
		setShowProfileMenu(false);
		clearMessages();
		clearChatHistory();
		clearDashboardSnapshot();
		await clearOfflineData();
		const supabase = createClient();
		await supabase.auth.signOut();
		router.replace("/login");
	};

	return (
		<div className="flex items-center gap-2 md:gap-3 relative">
			<div className="text-right hidden sm:block">
				{ponds.length > 1 ? (
					<PondSelector ponds={ponds} activePondId={activePondId} />
				) : (
					<p className="text-xs font-bold text-white uppercase">{pondName}</p>
				)}
				<p className="text-[10px] text-white/60 uppercase tracking-wider" suppressHydrationWarning>
					LAST SYNCED: {formatRelativeTime(lastSeenAt)}
				</p>
			</div>

			<DarkModeToggle />
			<LocaleSwitcher />

			{helpEnabled && (
				<HelpButton audience={isTenantAdmin ? "owner" : "farmer"} className="hidden sm:flex" />
			)}

			<NotificationBell />

			<button
				type="button"
				onClick={() => setShowProfileMenu((v) => !v)}
				className="w-9 h-9 bg-[#E85A2A] rounded-full flex items-center justify-center font-extrabold text-sm text-white border border-white/20 shadow-sm transition hover:bg-[#f06d42] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
				aria-label="Open profile and settings menu"
				aria-expanded={showProfileMenu}
			>
				{userEmail ? userEmail.split("@")[0].slice(0, 2).toUpperCase() : "\u00B7\u00B7"}
			</button>

			{/* Profile dropdown */}
			{showProfileMenu && (
				<div className="absolute top-12 right-0 z-50 w-[calc(100vw-2rem)] sm:w-auto sm:min-w-[320px] rounded-[28px] border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-4 text-[#0A3D62] dark:text-gray-100 shadow-xl origin-top-right animate-in zoom-in-95 duration-200">
					<div className="flex items-start justify-between gap-3 border-b border-gray-100 dark:border-gray-700 pb-4">
						<div className="flex items-center gap-3">
							<div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[#E85A2A] text-lg font-black text-white">
								{userEmail ? userEmail.split("@")[0].slice(0, 2).toUpperCase() : "\u00B7\u00B7"}
							</div>
							<div>
								<p className="text-base font-black">
									{userEmail ? userEmail.split("@")[0] : "User"}
								</p>
								<p className="text-xs font-bold text-[#3D5568] dark:text-gray-400">Pond Operator</p>
								<p className="mt-0.5 font-mono text-[11px] font-bold text-[#3D5568] dark:text-gray-400 uppercase">
									{ponds.find((p) => p.id === activePondId)?.name ?? pondName}
								</p>
							</div>
						</div>
						<button
							type="button"
							onClick={() => setShowProfileMenu(false)}
							className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gray-100 text-[#3D5568] hover:bg-gray-200 transition-colors"
							aria-label="Close profile menu"
						>
							<X className="h-4 w-4" />
						</button>
					</div>

					<div className="mt-4 grid grid-cols-2 gap-2 text-xs">
						<div className="rounded-2xl bg-[#F4F7F6] dark:bg-gray-800 p-3">
							<p className="font-black uppercase tracking-wide text-[#3D5568] dark:text-gray-400">
								Language
							</p>
							<p className="mt-1 text-lg font-black uppercase text-[#0A3D62] dark:text-[#5b9bd5]">
								{locale}
							</p>
						</div>
						<div className="rounded-2xl bg-[#F4F7F6] dark:bg-gray-800 p-3">
							<p className="font-black uppercase tracking-wide text-[#3D5568] dark:text-gray-400">
								Device
							</p>
							<p
								className={`mt-1 text-sm font-black uppercase ${
									esp32Status === "online"
										? "text-[#1E7B34]"
										: esp32Status === "offline"
											? "text-[#C42B3A]"
											: "text-gray-500"
								}`}
							>
								{esp32Status}
							</p>
						</div>
					</div>

					<div className="mt-4 space-y-2">
						{isTenantAdmin && (
							<button
								type="button"
								onClick={() => {
									setShowProfileMenu(false);
									router.push("/admin");
								}}
								className="flex min-h-14 w-full items-center justify-between rounded-2xl border border-[#E85A2A]/30 bg-[#E85A2A]/5 dark:bg-[#E85A2A]/10 px-4 font-black text-[#E85A2A] transition hover:bg-[#E85A2A]/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#E85A2A]"
							>
								<span className="flex items-center gap-3">
									<Shield className="h-5 w-5" /> Admin Panel
								</span>
								<svg
									className="h-5 w-5"
									fill="none"
									viewBox="0 0 24 24"
									stroke="currentColor"
									role="img"
									aria-label="Navigate"
								>
									<path
										strokeLinecap="round"
										strokeLinejoin="round"
										strokeWidth={2}
										d="M9 5l7 7-7 7"
									/>
								</svg>
							</button>
						)}
						{isPlatformAdmin && (
							<button
								type="button"
								onClick={() => {
									setShowProfileMenu(false);
									router.push("/superadmin");
								}}
								className="flex min-h-14 w-full items-center justify-between rounded-2xl border border-[#0A3D62]/20 bg-[#0A3D62]/5 dark:bg-[#0A3D62]/20 px-4 font-black text-[#0A3D62] dark:text-[#8ec5ef] transition hover:bg-[#0A3D62]/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0A3D62]"
							>
								<span className="flex items-center gap-3">
									<ShieldAlert className="h-5 w-5" /> Platform Console
								</span>
								<svg
									className="h-5 w-5"
									fill="none"
									viewBox="0 0 24 24"
									stroke="currentColor"
									role="img"
									aria-label="Navigate"
								>
									<path
										strokeLinecap="round"
										strokeLinejoin="round"
										strokeWidth={2}
										d="M9 5l7 7-7 7"
									/>
								</svg>
							</button>
						)}
						<button
							type="button"
							onClick={() => {
								router.replace(
									{ pathname: "/dashboard" },
									{ locale: locale === "en" ? "hil" : "en" },
								);
								setShowProfileMenu(false);
							}}
							className="flex min-h-14 w-full items-center justify-between rounded-2xl border border-[#0A3D62]/10 dark:border-gray-600 bg-white dark:bg-gray-800 px-4 font-black text-[#0A3D62] dark:text-gray-100 transition hover:bg-[#F4F7F6] dark:hover:bg-gray-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#E85A2A]"
						>
							<span className="flex items-center gap-3">
								<Globe className="h-5 w-5 text-[#E85A2A] dark:text-[#ff8a5c]" /> Switch language
							</span>
							<span className="rounded-lg bg-[#0A3D62]/10 dark:bg-gray-700 px-2 py-1 text-xs uppercase">
								{locale}
							</span>
						</button>
						<button
							type="button"
							onClick={handleLogout}
							className="flex min-h-14 w-full items-center justify-between rounded-2xl border border-red-100 dark:border-red-900/50 bg-red-50 dark:bg-red-900/20 px-4 font-black text-[#C42B3A] dark:text-red-400 transition hover:bg-red-100 dark:hover:bg-red-900/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#C42B3A]"
						>
							<span className="flex items-center gap-3">
								<LogOut className="h-5 w-5" /> Sign out
							</span>
							<svg
								className="h-5 w-5"
								fill="none"
								viewBox="0 0 24 24"
								stroke="currentColor"
								role="img"
								aria-label="Navigate"
							>
								<path
									strokeLinecap="round"
									strokeLinejoin="round"
									strokeWidth={2}
									d="M9 5l7 7-7 7"
								/>
							</svg>
						</button>
					</div>
				</div>
			)}
		</div>
	);
}
