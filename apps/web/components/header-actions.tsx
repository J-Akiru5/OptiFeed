"use client";

import { clearChatHistory } from "@/components/chat/chat-storage";
import { useChatWidget } from "@/components/chat/chat-widget-provider";
import { LocaleSwitcher } from "@/components/locale-switcher";
import { NotificationBell } from "@/components/notification-bell";
import { useRouter } from "@/i18n/routing";
import { createClient } from "@/lib/supabase/client";
import { Globe, LogOut, X } from "lucide-react";
import { useLocale } from "next-intl";
import { useEffect, useState } from "react";

interface HeaderActionsProps {
	pondName?: string;
	lastSeenAt?: string | null;
	esp32Status?: "online" | "offline" | "missing";
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
	pondName = "ILO-POND-01",
	lastSeenAt = null,
	esp32Status = "missing",
}: HeaderActionsProps) {
	const [showProfileMenu, setShowProfileMenu] = useState(false);
	const [userEmail, setUserEmail] = useState<string | null>(null);
	const router = useRouter();
	const locale = useLocale();
	const { clearMessages } = useChatWidget();

	useEffect(() => {
		createClient()
			.auth.getUser()
			.then(({ data }) => {
				setUserEmail(data.user?.email ?? null);
			});
	}, []);

	const handleLogout = async () => {
		setShowProfileMenu(false);
		clearMessages();
		clearChatHistory();
		const supabase = createClient();
		await supabase.auth.signOut();
		router.replace("/login");
	};

	return (
		<div className="flex items-center gap-2 md:gap-3 relative">
			<div className="text-right hidden sm:block">
				<p className="text-xs font-bold text-white uppercase">{pondName}</p>
				<p className="text-[10px] text-white/60 uppercase tracking-wider" suppressHydrationWarning>
					LAST SYNCED: {formatRelativeTime(lastSeenAt)}
				</p>
			</div>

			<LocaleSwitcher />

			<button
				type="button"
				className="w-9 h-9 flex items-center justify-center bg-white/10 hover:bg-white/20 rounded-full transition-all border border-white/10 text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
				title="Force hardware synchronization"
			>
				<span className="w-4 h-4 flex items-center justify-center">
					<svg
						xmlns="http://www.w3.org/2000/svg"
						width="16"
						height="16"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						strokeWidth="2"
						strokeLinecap="round"
						strokeLinejoin="round"
						role="img"
						aria-label="Sync"
					>
						<path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8" />
						<path d="M21 3v5h-5" />
					</svg>
				</span>
			</button>

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
				<div className="absolute top-12 right-0 z-50 w-[calc(100vw-2rem)] sm:w-auto sm:min-w-[320px] rounded-[28px] border border-gray-200 bg-white p-4 text-[#0A3D62] shadow-xl origin-top-right animate-in zoom-in-95 duration-200">
					<div className="flex items-start justify-between gap-3 border-b border-gray-100 pb-4">
						<div className="flex items-center gap-3">
							<div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[#E85A2A] text-lg font-black text-white">
								{userEmail ? userEmail.split("@")[0].slice(0, 2).toUpperCase() : "\u00B7\u00B7"}
							</div>
							<div>
								<p className="text-base font-black">
									{userEmail ? userEmail.split("@")[0] : "User"}
								</p>
								<p className="text-xs font-bold text-[#3D5568]">Pond Operator</p>
								<p className="mt-0.5 font-mono text-[11px] font-bold text-[#3D5568] uppercase">
									{pondName}
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
						<div className="rounded-2xl bg-[#F4F7F6] p-3">
							<p className="font-black uppercase tracking-wide text-[#3D5568]">Language</p>
							<p className="mt-1 text-lg font-black uppercase text-[#0A3D62]">{locale}</p>
						</div>
						<div className="rounded-2xl bg-[#F4F7F6] p-3">
							<p className="font-black uppercase tracking-wide text-[#3D5568]">Device</p>
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
						<button
							type="button"
							onClick={() => {
								router.replace(
									{ pathname: "/dashboard" },
									{ locale: locale === "en" ? "hil" : "en" },
								);
								setShowProfileMenu(false);
							}}
							className="flex min-h-14 w-full items-center justify-between rounded-2xl border border-[#0A3D62]/10 bg-white px-4 font-black text-[#0A3D62] transition hover:bg-[#F4F7F6] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#E85A2A]"
						>
							<span className="flex items-center gap-3">
								<Globe className="h-5 w-5 text-[#E85A2A]" /> Switch language
							</span>
							<span className="rounded-lg bg-[#0A3D62]/10 px-2 py-1 text-xs uppercase">
								{locale}
							</span>
						</button>
						<button
							type="button"
							onClick={handleLogout}
							className="flex min-h-14 w-full items-center justify-between rounded-2xl border border-red-100 bg-red-50 px-4 font-black text-[#C42B3A] transition hover:bg-red-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#C42B3A]"
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
