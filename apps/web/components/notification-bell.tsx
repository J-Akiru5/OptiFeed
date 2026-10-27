"use client";

import { Link } from "@/i18n/routing";
import { cn } from "@/lib/utils";
import { Bell } from "lucide-react";
import { useTranslations } from "next-intl";
import { useNotifications } from "./notification-provider";

export function NotificationBell({ className }: { className?: string }) {
	const { unreadCount: count } = useNotifications();
	const t = useTranslations("dashboard.notifications");

	return (
		<Link
			href="/dashboard/notifications"
			className={cn(
				"relative flex h-9 w-9 items-center justify-center rounded-full border border-white/10 bg-white/10 text-white transition-all hover:bg-white/20 focus-visible:ring-2 focus-visible:ring-white focus-visible:outline-none",
				className,
			)}
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
