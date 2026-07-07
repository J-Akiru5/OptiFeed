import { ChatBubble } from "@/components/chat-bubble";
import { LocaleSwitcher } from "@/components/locale-switcher";
import { NotificationBell } from "@/components/notification-bell";
import { NotificationProvider } from "@/components/notification-provider";
import { Link } from "@/i18n/routing";
import prisma from "@/lib/prisma";

// TODO(karl): Build the real dashboard navigation with active states, icons, and access-control logic.
export default async function DashboardLayout({
	children,
}: {
	children: React.ReactNode;
}) {
	// Fetch demo pond and initial unread notification count
	const pond = await prisma.pond.findFirst({
		where: { ownerId: "demo-farmer-1" },
	});

	const initialUnreadCount = pond
		? await prisma.notification.count({
				where: { pondId: pond.id, read: false },
			})
		: 0;

	return (
		<div className="flex min-h-full flex-col">
			<NotificationProvider pondId={pond?.id || ""} initialUnreadCount={initialUnreadCount}>
				<header className="flex items-center justify-between border-b border-[var(--ofd-base)]/10 bg-white px-4 py-3">
					<div className="flex items-center gap-4">
						<Link href="/dashboard" className="text-xl font-bold text-[var(--ofd-base)]">
							OptiFeed
						</Link>
						<nav className="hidden items-center gap-2 md:flex">
							<Link href="/dashboard" className="min-h-[var(--ofd-touch-min)] px-3">
								Dashboard
							</Link>
							<Link href="/dashboard/schedule" className="min-h-[var(--ofd-touch-min)] px-3">
								Schedule
							</Link>
							<Link href="/dashboard/log-sample" className="min-h-[var(--ofd-touch-min)] px-3">
								Log Sample
							</Link>
							<Link href="/dashboard/history" className="min-h-[var(--ofd-touch-min)] px-3">
								History
							</Link>
							<Link href="/dashboard/growth" className="min-h-[var(--ofd-touch-min)] px-3">
								Growth
							</Link>
							<Link href="/dashboard/settings" className="min-h-[var(--ofd-touch-min)] px-3">
								Settings
							</Link>
							<Link href="/dashboard/notifications" className="min-h-[var(--ofd-touch-min)] px-3">
								Notifications
							</Link>
						</nav>
					</div>
					<div className="flex items-center gap-2">
						<NotificationBell />
						<LocaleSwitcher />
					</div>
				</header>
				<main className="flex-1 p-4 md:p-6">{children}</main>
			</NotificationProvider>
			<ChatBubble />
		</div>
	);
}
