"use client";

import { Mascot } from "@/components/assistant/mascot";
import { ItemCardGrid } from "@/components/ui/item-card";
import { ViewToggle, useListViewPreference } from "@/components/ui/view-toggle";
import { Link, useRouter } from "@/i18n/routing";
import { acknowledgeNotification, markAllNotificationsRead } from "@/lib/actions/notifications";
import { formatDateTimeLocal } from "@/lib/date-local";
import { showsPakoy } from "@/lib/pakoy-alerts";
import { AlertTriangle, Check, CheckCircle2, FileText, Info, WifiOff } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { useNotifications } from "./notification-provider";

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
		className: "border-[#C42B3A]/20 bg-red-50 text-[#C42B3A]",
	},
	WARNING: {
		icon: AlertTriangle,
		className: "border-amber-200 bg-amber-50 text-amber-700",
	},
	SUCCESS: {
		icon: CheckCircle2,
		className: "border-green-200 bg-green-50 text-green-700",
	},
	INFO: {
		icon: Info,
		className: "border-blue-200 bg-blue-50 text-blue-700",
	},
};

const categoryConfig: Record<string, { labelKey: string; className: string }> = {
	connectivity: {
		labelKey: "categoryConnectivity",
		className: "bg-blue-100 text-blue-700 border-blue-200",
	},
	feeding: {
		labelKey: "categoryFeeding",
		className: "bg-amber-100 text-amber-700 border-amber-200",
	},
	hopper_low: {
		labelKey: "categoryHopperLow",
		className: "bg-orange-100 text-orange-700 border-orange-200",
	},
	pellet: {
		labelKey: "categoryPellet",
		className: "bg-orange-100 text-orange-700 border-orange-200",
	},
	pge: { labelKey: "categoryPge", className: "bg-purple-100 text-purple-700 border-purple-200" },
	schedule: {
		labelKey: "categorySchedule",
		className: "bg-teal-100 text-teal-700 border-teal-200",
	},
	system: { labelKey: "categorySystem", className: "bg-gray-100 text-gray-700 border-gray-200" },
};

interface NotificationListProps {
	initialNotifications: NotificationItem[];
	pondId: string;
	/** False for a VIEWER or a read-only view-as session: writes are disabled. */
	canWrite?: boolean;
}

/**
 * Notification feed with the shared List/Card switch (decision E2).
 *
 * The list view is a compact table (message, received, actions); the card view
 * is the richer tile with the tier icon. Both are always rendered so the
 * choice can switch instantly, and both keep the same acknowledge and audit
 * actions.
 */
export function NotificationList({ initialNotifications, canWrite = true }: NotificationListProps) {
	const t = useTranslations("dashboard.notifications");
	const tTiers = useTranslations("dashboard.notifications.tiers");
	const tCommon = useTranslations("dashboard.common");
	const tDates = useTranslations("dates");
	const router = useRouter();
	const {
		unreadCount,
		markAllAsReadClient,
		markOneAsReadClient,
		restoreOneUnreadClient,
		restoreUnreadCount,
	} = useNotifications();
	const [isPendingAck, startAckTransition] = useTransition();
	const [isPendingMarkAll, startMarkAllTransition] = useTransition();
	const { mode, choose, resolved } = useListViewPreference("notifications");
	// Rows handled in this view, so the UI reacts the moment they are clicked
	// instead of waiting for a server round-trip (and rolls back on failure).
	const [handledIds, setHandledIds] = useState<Record<string, boolean>>({});

	/** A row is done once the server says so or the reader handled it here. */
	const isHandled = (notification: NotificationItem) =>
		notification.acknowledgedAt !== null || handledIds[notification.id] === true;

	const formatDate = (dateStr: string) => {
		const loc = formatDateTimeLocal(new Date(dateStr), tDates);
		return `${loc.date}, ${loc.time}`;
	};

	const handleAcknowledge = (notification: NotificationItem) => {
		if (isHandled(notification)) return;

		const wasUnread = !notification.read;
		setHandledIds((prev) => ({ ...prev, [notification.id]: true }));
		if (wasUnread) markOneAsReadClient();

		startAckTransition(async () => {
			try {
				const result = await acknowledgeNotification(notification.id);
				if (!result.success) throw new Error(result.error);
			} catch {
				setHandledIds((prev) => {
					const next = { ...prev };
					delete next[notification.id];
					return next;
				});
				if (wasUnread) restoreOneUnreadClient();
				toast.error(t("actionError"));
			}
		});
	};

	const handleMarkAllRead = () => {
		const previousHandled = handledIds;
		const previousCount = unreadCount;
		const nextHandled = { ...handledIds };
		for (const notification of initialNotifications) {
			if (!isHandled(notification)) nextHandled[notification.id] = true;
		}

		setHandledIds(nextHandled);
		markAllAsReadClient();

		startMarkAllTransition(async () => {
			try {
				const result = await markAllNotificationsRead();
				if (!result.success) throw new Error(result.error);
				// Reconcile the page and the bell with the stored state.
				router.refresh();
			} catch {
				setHandledIds(previousHandled);
				restoreUnreadCount(previousCount);
				toast.error(t("actionError"));
			}
		});
	};

	/** Acknowledge (when still open) plus the link into the event log. */
	const renderActions = (notification: NotificationItem) => (
		<>
			{!isHandled(notification) && (
				<button
					type="button"
					onClick={() => handleAcknowledge(notification)}
					disabled={isPendingAck || !canWrite}
					className="inline-flex min-h-11 items-center gap-1 rounded-lg border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-bold text-blue-700 transition-colors hover:bg-blue-100 focus-visible:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0A3D62] disabled:cursor-not-allowed disabled:opacity-50 dark:border-blue-900/60 dark:bg-blue-950/40 dark:text-blue-200 dark:focus-visible:outline-[#8fc0ea]"
				>
					<Check aria-hidden="true" size={14} />
					{t("acknowledge")}
				</button>
			)}
			<Link
				href="/dashboard/audit"
				className="inline-flex min-h-11 items-center gap-1 rounded-lg border border-gray-200 bg-gray-50 px-3 py-1.5 text-xs font-bold text-gray-700 transition-colors hover:bg-gray-100 focus-visible:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0A3D62] dark:border-gray-700/50 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700 dark:focus-visible:outline-[#8fc0ea]"
			>
				<FileText aria-hidden="true" size={14} />
				{t("auditLink")}
			</Link>
		</>
	);

	/** Tier, category and state pills, shared by both views. */
	const renderBadges = (notification: NotificationItem) => {
		const tier = tierConfig[notification.tier] || tierConfig.INFO;
		const cat = notification.category ? categoryConfig[notification.category] : null;
		return (
			<>
				<span
					className={`rounded-full border px-2.5 py-1 text-[10px] font-black uppercase ${tier.className}`}
				>
					{tTiers.has(notification.tier) ? tTiers(notification.tier) : notification.tier}
				</span>
				{cat && (
					<span
						className={`rounded-full border px-2 py-0.5 text-[9px] font-bold uppercase ${cat.className}`}
					>
						{t.has(cat.labelKey) ? t(cat.labelKey) : (notification.category ?? cat.labelKey)}
					</span>
				)}
				{notification.autoCleared && (
					<span className="rounded-full border border-green-200 bg-green-50 px-2 py-0.5 text-[9px] font-bold uppercase text-green-700">
						{t("autoCleared")}
					</span>
				)}
				{notification.acknowledgedAt && (
					<span className="rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 text-[9px] font-bold uppercase text-blue-700">
						{t("acknowledged")}
					</span>
				)}
			</>
		);
	};

	if (initialNotifications.length === 0) {
		return (
			<ul aria-label={t("listLabel")} className="mt-6 space-y-3">
				<li className="flex flex-col items-center justify-center py-20 text-gray-500 dark:text-gray-400">
					<CheckCircle2 aria-hidden="true" size={48} className="mb-4 opacity-40" />
					<p className="text-lg font-medium">{t("allClear")}</p>
					<p className="text-sm">{t("empty")}</p>
				</li>
			</ul>
		);
	}

	return (
		<div data-list-view={resolved ? mode : undefined} className="mt-6 space-y-3">
			<div className="flex justify-end">
				<ViewToggle
					mode={mode}
					onChange={choose}
					listLabel={tCommon("viewToggle.list")}
					cardsLabel={tCommon("viewToggle.cards")}
					label={tCommon("viewToggle.label")}
				/>
			</div>

			<div className="data-list-table hidden overflow-hidden rounded-2xl border border-[#0A3D62]/10 bg-white shadow-sm md:block dark:border-gray-700/50 dark:bg-gray-900">
				<div className="overflow-x-auto">
					<table className="w-full min-w-[40rem] text-sm">
						<caption className="sr-only">{t("listLabel")}</caption>
						<thead>
							<tr className="border-b border-gray-100 bg-[#F4F7F6] text-left dark:border-gray-700/60 dark:bg-gray-800/60">
								<th
									scope="col"
									className="px-4 py-3 text-[10px] font-black tracking-wider text-[#3D5568] uppercase dark:text-gray-400"
								>
									{t("alert")}
								</th>
								<th
									scope="col"
									className="px-4 py-3 text-[10px] font-black tracking-wider text-[#3D5568] uppercase dark:text-gray-400"
								>
									{t("receivedAt")}
								</th>
								<th
									scope="col"
									className="px-4 py-3 text-right text-[10px] font-black tracking-wider text-[#3D5568] uppercase dark:text-gray-400"
								>
									{t("actions")}
								</th>
							</tr>
						</thead>
						<tbody>
							{initialNotifications.map((notification) => {
								const tier = tierConfig[notification.tier] || tierConfig.INFO;
								const Icon = tier.icon;
								return (
									<tr
										key={notification.id}
										className={`border-b border-gray-50 last:border-0 dark:border-gray-800 ${
											isHandled(notification) ? "opacity-70" : ""
										}`}
									>
										<td className="px-4 py-3">
											<div className="flex items-start gap-3">
												<span
													aria-hidden="true"
													className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border ${tier.className}`}
												>
													{showsPakoy(notification.category) ? (
														<Mascot size={26} />
													) : (
														<Icon className="h-4 w-4" />
													)}
												</span>
												<div className="min-w-0">
													<div className="flex flex-wrap items-center gap-2">
														{renderBadges(notification)}
													</div>
													<p className="mt-1 font-black text-[#0A3D62] dark:text-[#5b9bd5]">
														{notification.message.split("!")[0] || t("alert")}
													</p>
													<p className="text-xs text-[#3D5568] dark:text-gray-300">
														{notification.message}
													</p>
												</div>
											</div>
										</td>
										<td className="px-4 py-3 text-xs whitespace-nowrap text-[#3D5568] dark:text-gray-300">
											{formatDate(notification.createdAt)}
										</td>
										<td className="px-4 py-3">
											<div className="flex flex-wrap items-center justify-end gap-2">
												{renderActions(notification)}
											</div>
										</td>
									</tr>
								);
							})}
						</tbody>
					</table>
				</div>
			</div>

			<ItemCardGrid label={t("listLabel")}>
				{initialNotifications.map((notification) => {
					const tier = tierConfig[notification.tier] || tierConfig.INFO;
					const Icon = tier.icon;

					return (
						<li
							key={notification.id}
							className={`flex w-full items-start gap-3 rounded-3xl border p-4 text-left shadow-sm transition hover:shadow-md ${
								!isHandled(notification)
									? "border-[#0A3D62]/20 bg-white dark:bg-gray-900"
									: "border-[#0A3D62]/5 bg-gray-50/50 dark:bg-gray-800/50"
							}`}
						>
							<span
								aria-hidden="true"
								className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border ${tier.className}`}
							>
								{showsPakoy(notification.category) ? (
									<Mascot size={34} />
								) : (
									<Icon className="h-5 w-5" />
								)}
							</span>
							<span className="min-w-0 flex-1">
								<span className="flex flex-wrap items-center gap-2">
									{renderBadges(notification)}
									<span className="text-xs font-bold text-[#3D5568] dark:text-gray-300">
										{formatDate(notification.createdAt)}
									</span>
								</span>
								<span className="mt-2 block text-base font-black text-[#0A3D62] dark:text-[#5b9bd5]">
									{notification.message.split("!")[0] || t("alert")}
								</span>
								<span className="mt-1 block text-sm font-semibold leading-relaxed text-[#3D5568] dark:text-gray-300">
									{notification.message}
								</span>
								<span className="mt-3 flex flex-wrap gap-2">{renderActions(notification)}</span>
							</span>
						</li>
					);
				})}
			</ItemCardGrid>

			<div className="flex justify-end pt-2">
				<button
					type="button"
					onClick={handleMarkAllRead}
					disabled={isPendingMarkAll || !canWrite}
					className="inline-flex min-h-11 items-center rounded-lg bg-[#F4F7F6] px-4 py-2 text-sm font-bold text-[#0A3D62] transition-colors hover:bg-[#E8EDED] focus-visible:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0A3D62] disabled:cursor-not-allowed disabled:opacity-50 dark:bg-gray-800 dark:text-[#5b9bd5] dark:hover:bg-gray-700 dark:focus-visible:outline-[#8fc0ea]"
				>
					{t("markRead")}
				</button>
			</div>
		</div>
	);
}
