"use client";

import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { AlertCircle, CheckCircle2, Info, X } from "lucide-react";
import { createContext, useContext, useEffect, useState } from "react";

interface NotificationPayload {
	id: string;
	tier: string;
	message: string;
}

interface NotificationContextType {
	unreadCount: number;
	markAllAsReadClient: () => void;
}

const NotificationContext = createContext<NotificationContextType>({
	unreadCount: 0,
	markAllAsReadClient: () => {},
});

export const useNotifications = () => useContext(NotificationContext);

export function NotificationProvider({
	children,
	pondId,
	initialUnreadCount,
}: {
	children: React.ReactNode;
	pondId: string;
	initialUnreadCount: number;
}) {
	const [unreadCount, setUnreadCount] = useState(initialUnreadCount);
	const [activeBanner, setActiveBanner] = useState<NotificationPayload | null>(null);
	const [activeToast, setActiveToast] = useState<NotificationPayload | null>(null);

	useEffect(() => {
		if (!pondId) return;

		const supabase = createClient();

		const channel = supabase
			.channel("realtime-notifications")
			.on(
				"postgres_changes",
				{
					event: "INSERT",
					schema: "public",
					table: "Notification",
					filter: `pondId=eq.${pondId}`,
				},
				(payload) => {
					const newNotif = payload.new as NotificationPayload;

					// Always increment unread badge
					setUnreadCount((prev) => prev + 1);

					// Show UI feedback based on tier
					if (newNotif.tier === "CRITICAL") {
						setActiveBanner(newNotif);
					} else {
						setActiveToast(newNotif);
						// Auto-dismiss toast after 5s
						setTimeout(() => {
							setActiveToast(null);
						}, 5000);
					}
				},
			)
			.subscribe();

		return () => {
			supabase.removeChannel(channel);
		};
	}, [pondId]);

	const markAllAsReadClient = () => {
		setUnreadCount(0);
		setActiveBanner(null);
		setActiveToast(null);
	};

	return (
		<NotificationContext.Provider value={{ unreadCount, markAllAsReadClient }}>
			{/* Sticky Banner Portal */}
			{activeBanner && (
				<div className="fixed top-0 left-0 w-full z-[100] animate-in slide-in-from-top-4 fade-in duration-300">
					<div className="bg-red-600 text-white px-4 py-3 shadow-lg flex items-center justify-between border-b-4 border-red-800">
						<div className="flex items-center gap-3">
							<AlertCircle className="shrink-0 animate-pulse" size={24} />
							<p className="font-medium text-sm md:text-base">
								<span className="font-bold mr-2 uppercase tracking-wide">Critical Alert:</span>
								{activeBanner.message}
							</p>
						</div>
						<button
							type="button"
							onClick={() => setActiveBanner(null)}
							className="p-1 hover:bg-red-700 rounded-md transition-colors"
						>
							<X size={20} />
						</button>
					</div>
				</div>
			)}

			{/* Main App Content */}
			{children}

			{/* Toast Portal */}
			{activeToast && (
				<div className="fixed bottom-6 right-6 z-[100] animate-in slide-in-from-bottom-5 fade-in duration-300 max-w-sm w-full">
					<div
						className={cn(
							"bg-white rounded-xl shadow-2xl border-l-4 p-4 flex items-start gap-3",
							activeToast.tier === "SUCCESS"
								? "border-green-500"
								: activeToast.tier === "WARNING"
									? "border-amber-500"
									: "border-blue-500",
						)}
					>
						{activeToast.tier === "SUCCESS" && (
							<CheckCircle2 className="text-green-500 shrink-0 mt-0.5" size={20} />
						)}
						{activeToast.tier === "WARNING" && (
							<AlertCircle className="text-amber-500 shrink-0 mt-0.5" size={20} />
						)}
						{activeToast.tier === "INFO" && (
							<Info className="text-blue-500 shrink-0 mt-0.5" size={20} />
						)}

						<div className="flex-1">
							<p className="font-semibold text-gray-900 text-sm">
								{activeToast.tier === "SUCCESS"
									? "Success"
									: activeToast.tier === "WARNING"
										? "Warning"
										: "New Notification"}
							</p>
							<p className="text-sm text-gray-600 mt-0.5 leading-snug">{activeToast.message}</p>
						</div>

						<button
							type="button"
							onClick={() => setActiveToast(null)}
							className="text-gray-400 hover:text-gray-600 p-1"
						>
							<X size={16} />
						</button>
					</div>
				</div>
			)}
		</NotificationContext.Provider>
	);
}
