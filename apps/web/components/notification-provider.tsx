"use client";

import { Mascot } from "@/components/assistant/mascot";
import { showsPakoy } from "@/lib/pakoy-alerts";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { AlertCircle, CheckCircle2, Info, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { createContext, useContext, useEffect, useState } from "react";

interface NotificationPayload {
	id: string;
	tier: string;
	message: string;
	/** Present on the realtime row; drives Pakoy's icon (#221). */
	category?: string | null;
	/** UPDATE events use this to decide whether the row is a visible alert. */
	read?: boolean;
	autoCleared?: boolean;
	resolvedAt?: string | null;
}

interface NotificationContextType {
	unreadCount: number;
	/** Clear the badge after "Mark all as read". */
	markAllAsReadClient: () => void;
	/** Drop one from the badge after a single notification is acknowledged. */
	markOneAsReadClient: () => void;
	/** Put one back when a single optimistic acknowledgement fails. */
	restoreOneUnreadClient: () => void;
	/** Put the badge back when a bulk optimistic update is rolled back. */
	restoreUnreadCount: (count: number) => void;
}

const NotificationContext = createContext<NotificationContextType>({
	unreadCount: 0,
	markAllAsReadClient: () => {},
	markOneAsReadClient: () => {},
	restoreOneUnreadClient: () => {},
	restoreUnreadCount: () => {},
});

export const useNotifications = () => useContext(NotificationContext);

/** How long a non-critical toast stays before it dismisses itself. */
const TOAST_DURATION_MS = 5_000;

export function NotificationProvider({
	children,
	pondId,
	initialUnreadCount,
}: {
	children: React.ReactNode;
	pondId: string;
	initialUnreadCount: number;
}) {
	const t = useTranslations("dashboard.notifications");
	const [unreadCount, setUnreadCount] = useState(initialUnreadCount);
	const [activeBanner, setActiveBanner] = useState<NotificationPayload | null>(null);
	const [activeToast, setActiveToast] = useState<NotificationPayload | null>(null);
	// Auto-dismiss pauses while the reader is pointing at or tabbing through the
	// toast, so a long message does not disappear mid-read.
	const [toastPaused, setToastPaused] = useState(false);

	// The layout recomputes the badge on every server render. Without this the
	// provider kept incrementing its mount-time value forever, so a
	// revalidation (or a "Mark all as read") never reached the bell (#219).
	useEffect(() => {
		setUnreadCount(initialUnreadCount);
	}, [initialUnreadCount]);

	// One timer per visible toast: the effect cleanup cancels the previous
	// toast's timer when a newer one replaces it, and the id check means a late
	// callback can never dismiss a newer message (#757).
	useEffect(() => {
		if (!activeToast || toastPaused) return;
		const toastId = activeToast.id;
		const timer = setTimeout(() => {
			setActiveToast((current) => (current?.id === toastId ? null : current));
		}, TOAST_DURATION_MS);
		return () => clearTimeout(timer);
	}, [activeToast, toastPaused]);

	useEffect(() => {
		if (!pondId) return;

		const supabase = createClient();

		/** Critical rows get the sticky banner; everything else gets a toast. */
		const showAlert = (notification: NotificationPayload) => {
			if (notification.tier === "CRITICAL") {
				setActiveBanner(notification);
			} else {
				setActiveToast(notification);
			}
		};

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
					setUnreadCount((prev) => prev + 1);
					showAlert(newNotif);
				},
			)
			.on(
				"postgres_changes",
				{
					// Episode escalation updates the open row instead of inserting a
					// second one (#747). Without this subscription an acknowledged
					// WARNING that becomes CRITICAL stayed silent.
					event: "UPDATE",
					schema: "public",
					table: "Notification",
					filter: `pondId=eq.${pondId}`,
				},
				(payload) => {
					const newNotif = payload.new as NotificationPayload;
					// A recovery closes the row (`autoCleared`) and an acknowledgement
					// sets `read`; neither is a new alert. An escalation or re-open
					// leaves `read === false`, which is.
					if (newNotif.read !== false || newNotif.autoCleared || newNotif.resolvedAt) {
						return;
					}

					// The default replica identity exposes only the primary key in
					// `old`. When it is available, a previously read row means the
					// escalation re-opened an acknowledged alert, so the bell gains one.
					// Otherwise the next server render reconciles the count instead of
					// risking a double count on a still-unread row.
					const previous = payload.old as Partial<NotificationPayload> | undefined;
					if (previous?.read === true) {
						setUnreadCount((prev) => prev + 1);
					}
					showAlert(newNotif);
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
		setToastPaused(false);
		setActiveToast(null);
	};

	const dismissToast = () => {
		setToastPaused(false);
		setActiveToast(null);
	};

	const markOneAsReadClient = () => {
		setUnreadCount((prev) => Math.max(0, prev - 1));
	};

	const restoreOneUnreadClient = () => {
		setUnreadCount((prev) => prev + 1);
	};

	const restoreUnreadCount = (count: number) => {
		setUnreadCount(Math.max(0, count));
	};

	return (
		<NotificationContext.Provider
			value={{
				unreadCount,
				markAllAsReadClient,
				markOneAsReadClient,
				restoreOneUnreadClient,
				restoreUnreadCount,
			}}
		>
			{/* Sticky Banner Portal */}
			{activeBanner && (
				<div className="fixed top-0 left-0 w-full z-[100] animate-in slide-in-from-top-4 fade-in duration-300">
					<div
						role="alert"
						aria-live="assertive"
						aria-atomic="true"
						className="bg-red-600 text-white px-4 py-3 shadow-lg flex items-center justify-between border-b-4 border-red-800"
					>
						<div className="flex items-center gap-3">
							{showsPakoy(activeBanner.category) ? (
								<Mascot size={32} className="shrink-0" />
							) : (
								<AlertCircle className="shrink-0 animate-pulse" size={24} aria-hidden="true" />
							)}
							<p className="font-medium text-sm md:text-base">
								<span className="font-bold mr-2 uppercase tracking-wide">{t("criticalAlert")}</span>
								{activeBanner.message}
							</p>
						</div>
						<button
							type="button"
							onClick={() => setActiveBanner(null)}
							aria-label={t("dismiss")}
							className="p-1 hover:bg-red-700 rounded-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
						>
							<X size={20} aria-hidden="true" />
						</button>
					</div>
				</div>
			)}

			{/* Main App Content */}
			{children}

			{/* Toast Portal */}
			{activeToast && (
				<div className="fixed bottom-6 right-[var(--ofd-fab-inset)] z-[100] animate-in slide-in-from-bottom-5 fade-in duration-300 max-w-sm w-full">
					<div
						role={activeToast.tier === "WARNING" ? "alert" : "status"}
						aria-live={activeToast.tier === "WARNING" ? "assertive" : "polite"}
						aria-atomic="true"
						onMouseEnter={() => setToastPaused(true)}
						onMouseLeave={() => setToastPaused(false)}
						onFocus={() => setToastPaused(true)}
						onBlur={() => setToastPaused(false)}
						className={cn(
							"bg-white rounded-xl shadow-2xl border-l-4 p-4 flex items-start gap-3",
							activeToast.tier === "SUCCESS"
								? "border-green-500"
								: activeToast.tier === "WARNING"
									? "border-amber-500"
									: "border-blue-500",
						)}
					>
						{showsPakoy(activeToast.category) ? (
							<Mascot size={26} className="shrink-0" />
						) : (
							<>
								{activeToast.tier === "SUCCESS" && (
									<CheckCircle2
										className="text-green-500 shrink-0 mt-0.5"
										size={20}
										aria-hidden="true"
									/>
								)}
								{activeToast.tier === "WARNING" && (
									<AlertCircle
										className="text-amber-500 shrink-0 mt-0.5"
										size={20}
										aria-hidden="true"
									/>
								)}
								{activeToast.tier === "INFO" && (
									<Info className="text-blue-500 shrink-0 mt-0.5" size={20} aria-hidden="true" />
								)}
							</>
						)}

						<div className="flex-1">
							<p className="font-semibold text-gray-900 text-sm">
								{activeToast.tier === "SUCCESS"
									? t("successLabel")
									: activeToast.tier === "WARNING"
										? t("warningLabel")
										: t("newNotification")}
							</p>
							<p className="text-sm text-gray-600 mt-0.5 leading-snug">{activeToast.message}</p>
						</div>

						<button
							type="button"
							onClick={dismissToast}
							aria-label={t("dismiss")}
							className="text-gray-400 hover:text-gray-600 p-1 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0A3D62]"
						>
							<X size={16} aria-hidden="true" />
						</button>
					</div>
				</div>
			)}
		</NotificationContext.Provider>
	);
}
