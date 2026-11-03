"use client";

import { Mascot } from "@/components/assistant/mascot";
import { showsPakoy } from "@/lib/pakoy-alerts";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { AlertCircle, CheckCircle2, Info, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { createContext, useContext, useEffect, useState } from "react";

/** How long a non-critical toast stays up before it dismisses itself. */
const TOAST_DURATION_MS = 5000;

/** Headline used by both the visual card and its live-region announcement. */
function toastTitle(tier: string): string {
	if (tier === "SUCCESS") return "Success";
	if (tier === "WARNING") return "Warning";
	return "New Notification";
}

interface NotificationPayload {
	id: string;
	tier: string;
	message: string;
	/** Present on the realtime row; drives Pakoy's icon (#221). */
	category?: string | null;
	/** Episode lifecycle, present on realtime UPDATE payloads. */
	acknowledgedAt?: string | null;
	resolvedAt?: string | null;
	autoCleared?: boolean;
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
	// Paused while a pointer or keyboard focus is inside the toast, so a message
	// being read is not yanked away mid-sentence.
	const [toastPaused, setToastPaused] = useState(false);

	// One timer per message. Keying the effect on `activeToast` clears the
	// previous message's timer, so a stale timeout can no longer dismiss a newer
	// toast (#757), and hovering/focusing re-arms a full window on leave.
	useEffect(() => {
		if (!activeToast || toastPaused) return;
		const timer = window.setTimeout(() => setActiveToast(null), TOAST_DURATION_MS);
		return () => window.clearTimeout(timer);
	}, [activeToast, toastPaused]);

	// The layout recomputes the badge on every server render. Without this the
	// provider kept incrementing its mount-time value forever, so a
	// revalidation (or a "Mark all as read") never reached the bell (#219).
	useEffect(() => {
		setUnreadCount(initialUnreadCount);
	}, [initialUnreadCount]);

	useEffect(() => {
		if (!pondId) return;

		const supabase = createClient();
		const filter = `pondId=eq.${pondId}`;
		// Last tier+message shown per notification id. UPDATE events also fire for
		// read/acknowledged writes, which must not re-alert; a tier or message
		// change is the escalation that must (#747).
		const shown = new Map<string, string>();
		const signature = (notification: NotificationPayload) =>
			`${notification.tier}:${notification.message}`;

		const showAlert = (notification: NotificationPayload, isUpdate: boolean) => {
			if (isUpdate) {
				// Acknowledgements and episode resolutions are not new alerts;
				// checking the row fields also covers a page loaded after the row
				// was created, when the local signature map is still empty.
				if (notification.acknowledgedAt || notification.resolvedAt) return;
				if (notification.autoCleared) return;
				if (shown.get(notification.id) === signature(notification)) return;
			}
			shown.set(notification.id, signature(notification));

			// Only a genuinely new row changes the badge; the next server render
			// reconciles it after an escalation (which reopens the row).
			if (!isUpdate) setUnreadCount((prev) => prev + 1);

			if (notification.tier === "CRITICAL") {
				setActiveBanner(notification);
			} else {
				setActiveToast(notification);
				// The effect above owns dismissal: one timer per message, cleared
				// when a newer toast replaces this one and paused on hover/focus.
				setToastPaused(false);
			}
		};

		const channel = supabase
			.channel("realtime-notifications")
			.on(
				"postgres_changes",
				{ event: "INSERT", schema: "public", table: "Notification", filter },
				(payload) => showAlert(payload.new as NotificationPayload, false),
			)
			.on(
				"postgres_changes",
				{ event: "UPDATE", schema: "public", table: "Notification", filter },
				(payload) => showAlert(payload.new as NotificationPayload, true),
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
						aria-atomic="true"
						className="bg-red-600 text-white px-4 py-3 shadow-lg flex items-center justify-between border-b-4 border-red-800"
					>
						<div className="flex items-center gap-3">
							{showsPakoy(activeBanner.category) ? (
								<Mascot size={32} className="shrink-0" />
							) : (
								<AlertCircle className="shrink-0 animate-pulse" size={24} />
							)}
							<p className="font-medium text-sm md:text-base">
								<span className="font-bold mr-2 uppercase tracking-wide">Critical Alert:</span>
								{activeBanner.message}
							</p>
						</div>
						<button
							type="button"
							onClick={() => setActiveBanner(null)}
							aria-label={t("dismissNotification")}
							className="p-1 hover:bg-red-700 rounded-md transition-colors"
						>
							<X size={20} aria-hidden="true" />
						</button>
					</div>
				</div>
			)}

			{/* Main App Content */}
			{children}

			{/* Always mounted so a message inserted later is announced: screen
			    readers do not reliably announce content in a region that appears
			    at the same time as the text. The visual card below is silent. */}
			<output className="sr-only" aria-live="polite" aria-atomic="true">
				{activeToast ? `${toastTitle(activeToast.tier)}: ${activeToast.message}` : ""}
			</output>

			{/* Toast Portal */}
			{activeToast && (
				<div
					data-testid="notification-toast"
					onMouseEnter={() => setToastPaused(true)}
					onMouseLeave={() => setToastPaused(false)}
					onFocus={() => setToastPaused(true)}
					onBlur={() => setToastPaused(false)}
					className="fixed bottom-6 right-[var(--ofd-fab-inset)] z-[100] animate-in slide-in-from-bottom-5 fade-in duration-300 max-w-sm w-full"
				>
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
						{showsPakoy(activeToast.category) ? (
							<Mascot size={26} className="shrink-0" />
						) : (
							<>
								{activeToast.tier === "SUCCESS" && (
									<CheckCircle2 className="text-green-500 shrink-0 mt-0.5" size={20} />
								)}
								{activeToast.tier === "WARNING" && (
									<AlertCircle className="text-amber-500 shrink-0 mt-0.5" size={20} />
								)}
								{activeToast.tier === "INFO" && (
									<Info className="text-blue-500 shrink-0 mt-0.5" size={20} />
								)}
							</>
						)}

						<div className="flex-1">
							<p className="font-semibold text-gray-900 text-sm">{toastTitle(activeToast.tier)}</p>
							<p className="text-sm text-gray-600 mt-0.5 leading-snug">{activeToast.message}</p>
						</div>

						<button
							type="button"
							onClick={() => setActiveToast(null)}
							aria-label={t("dismissNotification")}
							className="text-gray-400 hover:text-gray-600 p-1"
						>
							<X size={16} aria-hidden="true" />
						</button>
					</div>
				</div>
			)}
		</NotificationContext.Provider>
	);
}
