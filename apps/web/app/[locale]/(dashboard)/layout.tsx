import { BackToDashboard } from "@/components/BackToDashboard";
import { LiveClock } from "@/components/LiveClock";
import { OptiFeedLogo } from "@/components/OptiFeedLogo";
import { BottomNav } from "@/components/bottom-nav";
import { ChatWidget } from "@/components/chat/chat-widget";
import { ChatWidgetProvider } from "@/components/chat/chat-widget-provider";
import { DashboardContentShell } from "@/components/chat/dashboard-content-shell";
import { FabStack } from "@/components/fab-stack";
import { HeaderActions } from "@/components/header-actions";
import { NotificationProvider } from "@/components/notification-provider";
import { OnboardingProvider } from "@/components/onboarding-provider";
import { OfflineSync } from "@/components/pwa/offline-sync";
import { Sidebar } from "@/components/sidebar";
import { Link } from "@/i18n/routing";
import { isCurrentPlatformAdmin } from "@/lib/auth/require-platform-admin";
import { getCurrentPondOwnerId, getCurrentUser } from "@/lib/auth/session";
import { isCurrentTenantAdmin } from "@/lib/auth/tenant-admin";
import { OFFLINE_THRESHOLD_MS } from "@/lib/constants";
import { getActivePondId } from "@/lib/pond-selection";
import prisma from "@/lib/prisma";
import Image from "next/image";

export default async function DashboardLayout({
	children,
}: {
	children: React.ReactNode;
}) {
	const [ownerId, currentUser, isTenantAdmin, isPlatformAdmin] = await Promise.all([
		getCurrentPondOwnerId(),
		getCurrentUser(),
		isCurrentTenantAdmin(),
		isCurrentPlatformAdmin(),
	]);

	let pondId = "";
	let initialUnreadCount = 0;
	let hopperLevelPct = 0;
	let esp32Status: "online" | "offline" | "missing" = "missing";
	let pondName = "ILO-POND-01";
	let lastSeenAtStr: string | null = null;
	let ponds: { id: string; name: string }[] = [];
	let activePondId = "";

	try {
		const [allPonds, selectedId] = await Promise.all([
			prisma.pond.findMany({
				where: { ownerId, status: "ACTIVE" },
				orderBy: { createdAt: "asc" },
			}),
			getActivePondId(),
		]);

		ponds = allPonds.map((p) => ({ id: p.id, name: p.name }));

		const pond = allPonds.find((p) => p.id === selectedId) ?? allPonds[0];

		if (pond) {
			pondId = pond.id;
			activePondId = pond.id;
			pondName = pond.name;

			const [unreadCount, energyDevice] = await Promise.all([
				prisma.notification.count({
					where: { pondId: pond.id, read: false },
				}),
				prisma.energyDevice.findFirst({
					where: { pondId: pond.id },
					orderBy: { createdAt: "asc" },
				}),
			]);
			initialUnreadCount = unreadCount;

			if (energyDevice) {
				hopperLevelPct = energyDevice.feedLevelPercent ?? 0;
				const now = new Date();
				const isOffline =
					!energyDevice.lastSeenAt ||
					now.getTime() - energyDevice.lastSeenAt.getTime() > OFFLINE_THRESHOLD_MS;
				esp32Status = isOffline ? "offline" : "online";
				lastSeenAtStr = energyDevice.lastSeenAt ? energyDevice.lastSeenAt.toISOString() : null;
			}
		}
	} catch (err) {
		console.error("[DashboardLayout] Prisma error:", err);
	}

	return (
		<ChatWidgetProvider>
			<OfflineSync scope={ownerId} />
			<OnboardingProvider>
				<div className="flex flex-col min-h-screen bg-[#F4F7F6] dark:bg-gray-950">
					<NotificationProvider pondId={pondId} initialUnreadCount={initialUnreadCount}>
						<header className="sticky top-0 z-30 w-full h-16 bg-[#0A3D62] px-4 md:px-8 flex items-center justify-between shadow-md shrink-0">
							<div className="flex items-center gap-3">
								<Link
									href="/dashboard"
									className="flex items-center justify-center transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white rounded-lg"
								>
									<OptiFeedLogo size={32} variant="ondark" />
								</Link>
								<Image
									src="/pakaonai-logo-kit/png/pakaonai-wordmark-color.png"
									alt="PakaonAI"
									width={110}
									height={26}
									className="h-[26px] w-auto object-contain brightness-0 invert"
								/>
								{esp32Status !== "missing" && (
									<div className="hidden md:flex items-center gap-2 border-l border-white/20 pl-3">
										<span
											className={`w-2 h-2 rounded-full shadow-[0_0_8px_currentColor] transition-all duration-500 ${
												esp32Status === "online"
													? "bg-[#1E7B34] text-[#1E7B34]"
													: "bg-[#C42B3A] text-[#C42B3A]"
											}`}
										/>
										<span className="text-[10px] text-white/50 uppercase tracking-wider">
											ESP32 {esp32Status}
										</span>
									</div>
								)}
								<LiveClock />
							</div>

							<HeaderActions
								ponds={ponds}
								activePondId={activePondId}
								pondName={pondName}
								lastSeenAt={lastSeenAtStr}
								esp32Status={esp32Status}
								initialUser={
									currentUser
										? {
												email: currentUser.email,
												role: currentUser.role,
												displayName: currentUser.displayName,
												isTenantAdmin,
												isPlatformAdmin,
											}
										: undefined
								}
							/>
						</header>

						<DashboardContentShell>
							<Sidebar hopperLevelPct={hopperLevelPct} isOffline={esp32Status === "offline"} />
							<main className="flex-1 p-4 md:p-8 pb-24 md:pb-8 relative z-10">
								<BackToDashboard />
								{children}
							</main>
						</DashboardContentShell>
					</NotificationProvider>

					<ChatWidget />
					<BottomNav />
					<FabStack />
				</div>
			</OnboardingProvider>
		</ChatWidgetProvider>
	);
}
