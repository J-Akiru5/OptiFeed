import { OptiFeedLogo } from "@/components/OptiFeedLogo";
import { BottomNav } from "@/components/bottom-nav";
import { ChatBubble } from "@/components/chat-bubble";
import { HeaderActions } from "@/components/header-actions";
import { NotificationProvider } from "@/components/notification-provider";
import { Sidebar } from "@/components/sidebar";
import { Link } from "@/i18n/routing";
import prisma from "@/lib/prisma";

export default async function DashboardLayout({
	children,
}: {
	children: React.ReactNode;
}) {
	// Fetch demo pond and initial unread notification count
	// Wrapped in try/catch — a Prisma error must never cause a layout crash (which Next.js renders as 404)
	let pondId = "";
	let initialUnreadCount = 0;
	let hopperLevelPct = 0;

	try {
		const pond = await prisma.pond.findFirst({
			where: { ownerId: "demo-farmer-1" },
			include: { devices: true },
		});

		if (pond) {
			pondId = pond.id;
			if (pond.devices.length > 0) {
				hopperLevelPct = pond.devices[0].hopperLevelPct;
			}
			initialUnreadCount = await prisma.notification.count({
				where: { pondId: pond.id, read: false },
			});
		}
	} catch (err) {
		// Log the error but allow the layout (and child pages) to render normally
		console.error("[DashboardLayout] Prisma error:", err);
	}

	return (
		<div className="flex flex-col min-h-screen bg-[#F4F7F6]">
			<NotificationProvider pondId={pondId} initialUnreadCount={initialUnreadCount}>
				{/* Header — dark blue across all breakpoints */}
				<header className="sticky top-0 z-30 w-full h-16 bg-[#0A3D62] px-4 md:px-8 flex items-center justify-between shadow-md shrink-0">
					{/* Left: connectivity dot + wordmark */}
					<div className="flex items-center gap-3">
						<Link
							href="/dashboard"
							className="flex items-center justify-center transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white rounded-lg"
						>
							<OptiFeedLogo size={32} />
						</Link>
						<span className="font-extrabold text-lg md:text-xl tracking-tight text-white">
							Opti<span className="text-[#E85A2A]">Feed</span>
						</span>
						<div className="hidden md:flex items-center gap-2 border-l border-white/20 pl-3">
							<span className="w-2 h-2 rounded-full shadow-[0_0_8px_currentColor] transition-all duration-500 bg-[#1E7B34]" />
							<span className="text-[10px] text-white/50 uppercase tracking-wider">
								ESP32 Online
							</span>
						</div>
					</div>

					{/* Right: Actions */}
					<HeaderActions />
				</header>

				<div className="flex w-full flex-1 min-h-[calc(100vh-4rem)]">
					<Sidebar hopperLevelPct={hopperLevelPct} />
					<main className="flex-1 p-4 md:p-8 pb-24 md:pb-8 relative z-10">{children}</main>
				</div>
			</NotificationProvider>

			<ChatBubble />
			<BottomNav />
		</div>
	);
}
