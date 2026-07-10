import { BottomNav } from "@/components/bottom-nav";
import { ChatBubble } from "@/components/chat-bubble";
import { LocaleSwitcher } from "@/components/locale-switcher";
import { NotificationBell } from "@/components/notification-bell";
import { NotificationProvider } from "@/components/notification-provider";
import { Link } from "@/i18n/routing";
import prisma from "@/lib/prisma";
import { getTranslations } from "next-intl/server";

// TODO(karl): Build the real dashboard navigation with active states, icons, and access-control logic.
export default async function DashboardLayout({
	children,
}: {
	children: React.ReactNode;
}) {
	const t = await getTranslations("nav");
	// Fetch demo pond and initial unread notification count
	// Wrapped in try/catch — a Prisma error must never cause a layout crash (which Next.js renders as 404)
	let pondId = "";
	let initialUnreadCount = 0;

	try {
		const pond = await prisma.pond.findFirst({
			where: { ownerId: "demo-farmer-1" },
		});

		if (pond) {
			pondId = pond.id;
			initialUnreadCount = await prisma.notification.count({
				where: { pondId: pond.id, read: false },
			});
		}
	} catch (err) {
		// Log the error but allow the layout (and child pages) to render normally
		console.error("[DashboardLayout] Prisma error:", err);
	}

	return (
		<div className="flex min-h-full flex-col">
			<NotificationProvider pondId={pondId} initialUnreadCount={initialUnreadCount}>
				<header className="flex items-center justify-between border-b border-[var(--ofd-base)]/10 bg-white px-4 py-3">
					<div className="flex items-center gap-4">
						<Link href="/dashboard" className="text-xl font-bold text-[var(--ofd-base)]">
							OptiFeed
						</Link>
						<nav className="hidden items-center gap-2 md:flex">
							<Link href="/dashboard" className="min-h-[var(--ofd-touch-min)] px-3">
								{t("dashboard")}
							</Link>
							<Link href="/dashboard/schedule" className="min-h-[var(--ofd-touch-min)] px-3">
								{t("schedule")}
							</Link>
							<Link href="/dashboard/log-sample" className="min-h-[var(--ofd-touch-min)] px-3">
								{t("logSample")}
							</Link>
							<Link href="/dashboard/history" className="min-h-[var(--ofd-touch-min)] px-3">
								{t("history")}
							</Link>
							<Link href="/dashboard/growth" className="min-h-[var(--ofd-touch-min)] px-3">
								{t("growth")}
							</Link>
							<Link href="/dashboard/settings" className="min-h-[var(--ofd-touch-min)] px-3">
								{t("settings")}
							</Link>
							<Link href="/dashboard/notifications" className="min-h-[var(--ofd-touch-min)] px-3">
								{t("notifications")}
							</Link>
						</nav>
					</div>
					<div className="flex items-center gap-2">
						<NotificationBell />
						<LocaleSwitcher />
					</div>
				</header>
				<main className="flex-1 p-4 md:p-6 pb-24 md:pb-6">{children}</main>
			</NotificationProvider>
			<ChatBubble />
			<BottomNav />
		</div>
	);
}
