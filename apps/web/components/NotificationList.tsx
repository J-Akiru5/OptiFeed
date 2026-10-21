"use client";

import { acknowledgeNotification, markAllNotificationsRead } from "@/lib/actions/notifications";
import { formatDateTimeLocal } from "@/lib/date-local";
import {
	AlertCircle,
	AlertTriangle,
	Check,
	CheckCircle2,
	FileText,
	Info,
	WifiOff,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useTransition } from "react";

interface NotificationItem {
	id: string;
	tier: string;
	message: string;
	category: string | null;
	read: boolean;
	autoCleared: boolean;
	acknowledgedAt: string | null;
	createdAt: string;
}

const tierConfig: Record<string, { icon: LucideIcon; className: string }> = {
	CRITICAL: {
		icon: WifiOff,
		className:
			"border-[#C42B3A]/20 dark:border-red-800 bg-red-50 dark:bg-red-900/30 text-[#C42B3A] dark:text-red-300",
	},
	WARNING: {
		icon: AlertTriangle,
		className:
			"border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300",
	},
	SUCCESS: {
		icon: CheckCircle2,
		className:
			"border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-900/30 text-green-700 dark:text-green-300",
	},
	INFO: {
		icon: Info,
		className:
			"border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300",
	},
};

const categoryConfig: Record<string, { label: string; className: string }> = {
	connectivity: {
		label: "Connectivity",
		className:
			"bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-800",
	},
	feeding: {
		label: "Feeding",
		className:
			"bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-800",
	},
	pellet: {
		label: "Pellet",
		className:
			"bg-orange-100 dark:bg-orange-900/40 text-orange-700 dark:text-orange-300 border-orange-200 dark:border-orange-800",
	},
	pge: {
		label: "PGE",
		className:
			"bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300 border-purple-200 dark:border-purple-800",
	},
	schedule: {
		label: "Schedule",
		className:
			"bg-teal-100 dark:bg-teal-900/40 text-teal-700 dark:text-teal-300 border-teal-200 dark:border-teal-800",
	},
	system: {
		label: "System",
		className:
			"bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 border-gray-200 dark:border-gray-600",
	},
};

interface NotificationListProps {
	initialNotifications: NotificationItem[];
	pondId: string;
}

export function NotificationList({ initialNotifications }: NotificationListProps) {
	const t = useTranslations("dashboard.notifications");
	const tTiers = useTranslations("dashboard.notifications.tiers");
	const tDates = useTranslations("dates");
	const [isPendingAck, startAckTransition] = useTransition();
	const [isPendingMarkAll, startMarkAllTransition] = useTransition();

	const formatDate = (dateStr: string) => {
		const loc = formatDateTimeLocal(new Date(dateStr), tDates);
		return `${loc.date}, ${loc.time}`;
	};

	const handleAcknowledge = (id: string) => {
		startAckTransition(async () => {
			await acknowledgeNotification(id);
		});
	};

	const handleMarkAllRead = () => {
		startMarkAllTransition(async () => {
			await markAllNotificationsRead();
		});
	};

	return (
		<div className="mt-6 space-y-3">
			{initialNotifications.length === 0 ? (
				<div className="flex flex-col items-center justify-center py-20 text-gray-400">
					<CheckCircle2 size={48} className="mb-4 opacity-30" />
					<p className="text-lg font-medium">{t("allClear")}</p>
					<p className="text-sm">{t("empty")}</p>
				</div>
			) : (
				initialNotifications.map((notification) => {
					const tier = tierConfig[notification.tier] || tierConfig.INFO;
					const Icon = tier.icon;
					const cat = notification.category ? categoryConfig[notification.category] : null;

					return (
						<div
							key={notification.id}
							className={`flex w-full items-start gap-3 rounded-3xl border p-4 text-left shadow-sm transition hover:shadow-md ${
								!notification.read
									? "border-[#0A3D62]/20 dark:border-gray-600 bg-white dark:bg-gray-800"
									: "border-[#0A3D62]/5 dark:border-gray-700/60 bg-gray-50/50 dark:bg-gray-800/40"
							}`}
						>
							<span
								className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border ${tier.className}`}
							>
								<Icon className="h-5 w-5" />
							</span>
							<span className="min-w-0 flex-1">
								<span className="flex flex-wrap items-center gap-2">
									<span
										className={`rounded-full border px-2.5 py-1 text-[10px] font-black uppercase ${tier.className}`}
									>
										{tTiers(notification.tier as "CRITICAL" | "WARNING" | "SUCCESS" | "INFO")}
									</span>
									{cat && (
										<span
											className={`rounded-full border px-2 py-0.5 text-[9px] font-bold uppercase ${cat.className}`}
										>
											{cat.label}
										</span>
									)}
									<span className="text-xs font-bold text-[#3D5568] dark:text-gray-400">
										{formatDate(notification.createdAt)}
									</span>
									{notification.autoCleared && (
										<span className="rounded-full border border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-900/40 px-2 py-0.5 text-[9px] font-bold uppercase text-green-700 dark:text-green-300">
											Auto-cleared
										</span>
									)}
									{notification.acknowledgedAt && (
										<span className="rounded-full border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-900/40 px-2 py-0.5 text-[9px] font-bold uppercase text-blue-700 dark:text-blue-300">
											Acknowledged
										</span>
									)}
								</span>
								<span className="mt-2 block text-base font-black text-[#0A3D62] dark:text-[#5b9bd5]">
									{notification.message.split("!")[0] || "Alert"}
								</span>
								<span className="mt-1 block text-sm font-semibold leading-relaxed text-[#3D5568] dark:text-gray-300">
									{notification.message}
								</span>
							</span>
							<div className="flex shrink-0 flex-col gap-2">
								{!notification.acknowledgedAt && (
									<button
										type="button"
										onClick={() => handleAcknowledge(notification.id)}
										disabled={isPendingAck}
										className="flex items-center gap-1 rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-900/40 px-3 py-1.5 text-xs font-bold text-blue-700 dark:text-blue-300 transition-colors hover:bg-blue-100 dark:hover:bg-blue-900/60 disabled:opacity-50"
									>
										<Check size={14} />
										{t("acknowledge")}
									</button>
								)}
								<a
									href="/dashboard/audit"
									className="flex items-center gap-1 rounded-lg border border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-700 px-3 py-1.5 text-xs font-bold text-gray-600 dark:text-gray-300 transition-colors hover:bg-gray-100 dark:hover:bg-gray-600"
								>
									<FileText size={14} />
									Audit
								</a>
							</div>
						</div>
					);
				})
			)}

			{initialNotifications.length > 0 && (
				<div className="flex justify-end pt-2">
					<button
						type="button"
						onClick={handleMarkAllRead}
						disabled={isPendingMarkAll}
						className="rounded-lg bg-[#F4F7F6] dark:bg-gray-800 px-4 py-2 text-sm font-bold text-[#0A3D62] dark:text-[#5b9bd5] transition-colors hover:bg-[#E8EDED] dark:hover:bg-gray-700 disabled:opacity-50"
					>
						{t("markRead")}
					</button>
				</div>
			)}
		</div>
	);
}
