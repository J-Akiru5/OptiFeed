"use client";

import { Link } from "@/i18n/routing";
import { markAllNotificationsRead } from "@/lib/actions/notifications";
import { useNotifications } from "./notification-provider";

// TODO(karl): Implement dropdown once the notifications feature is built.
export function NotificationBell() {
	const { unreadCount, markAllAsReadClient } = useNotifications();

	const handleClick = async () => {
		if (unreadCount > 0) {
			// Optimistically clear the badge immediately
			markAllAsReadClient();
			// Then persist to DB
			await markAllNotificationsRead();
		}
	};

	return (
		<Link
			href="/dashboard/notifications"
			onClick={handleClick}
			aria-label="Notifications"
			className="relative flex h-[var(--ofd-touch-min)] w-[var(--ofd-touch-min)] items-center justify-center transition-transform hover:scale-110 active:scale-95"
		>
			<span className="text-2xl">🔔</span>
			{unreadCount > 0 && (
				<span className="absolute top-1 right-1 flex h-5 min-w-[20px] items-center justify-center rounded-full bg-red-500 px-1.5 text-xs font-bold text-white shadow-sm ring-2 ring-white">
					{unreadCount > 99 ? "99+" : unreadCount}
				</span>
			)}
		</Link>
	);
}
