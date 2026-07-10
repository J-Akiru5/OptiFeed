"use client";

import { Link } from "@/i18n/routing";
import { Bell } from "lucide-react";
import { useTranslations } from "next-intl";
import { useNotifications } from "./notification-provider";

export function NotificationBell() {
	const { unreadCount: count } = useNotifications();
	const t = useTranslations("dashboard.notifications");

	return (
		<Link
			href="/dashboard/notifications"
			className="relative w-9 h-9 flex items-center justify-center bg-white/10 hover:bg-white/20 rounded-full transition-all border border-white/10 text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
			title={t("title")}
			aria-label={t("title")}
		>
			<Bell className="w-4 h-4" />
			{count > 0 && (
				<span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-[#C42B3A] px-1 text-[9px] font-black leading-none text-white ring-2 ring-[#0A3D62]">
					{count > 99 ? "99+" : count}
				</span>
			)}
		</Link>
	);
}
