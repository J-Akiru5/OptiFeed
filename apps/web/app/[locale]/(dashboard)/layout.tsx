import { BackToDashboard } from "@/components/BackToDashboard";
import { LiveClock } from "@/components/LiveClock";
import { OptiFeedLogo } from "@/components/OptiFeedLogo";
import { AnnouncementBanner } from "@/components/announcements/announcement-banner";
import { BottomNav } from "@/components/bottom-nav";
import { ChatWidget } from "@/components/chat/chat-widget";
import { ChatWidgetProvider } from "@/components/chat/chat-widget-provider";
import { DashboardContentShell } from "@/components/chat/dashboard-content-shell";
import { DashboardLiveRefresh } from "@/components/dashboard-live-refresh";
import { FabStack } from "@/components/fab-stack";
import { CompactHeaderActions, HeaderActions } from "@/components/header-actions";
import { MobileHeader } from "@/components/mobile/mobile-header";
import { NotificationProvider } from "@/components/notification-provider";
import { OnboardingProvider } from "@/components/onboarding-provider";
import { PondSelector } from "@/components/pond-selector";
import { OfflineSync } from "@/components/pwa/offline-sync";
import { GlobalSearch } from "@/components/search/global-search";
import { Sidebar } from "@/components/sidebar";
import { ViewAsBanner } from "@/components/superadmin/view-as-banner";
import { Link } from "@/i18n/routing";
import { getViewAsBanner } from "@/lib/actions/platform/impersonation";
import { redirectPlatformAdminFromDashboard } from "@/lib/auth/dashboard-landing";
import { isCurrentPlatformAdmin } from "@/lib/auth/require-platform-admin";
import { getCurrentPondOwnerId, requirePasswordChanged } from "@/lib/auth/session";
import { isCurrentTenantAdmin } from "@/lib/auth/tenant-admin";
import { getViewAsState } from "@/lib/auth/view-as";
import { getSignedAvatarUrls } from "@/lib/avatars";
import { loadPondHopper } from "@/lib/device-hopper";
import { getActivePondId, listSelectablePonds } from "@/lib/pond-selection";
import prisma from "@/lib/prisma";
import { getActiveAnnouncement } from "@/lib/settings/announcement";
import { isFeatureEnabled } from "@/lib/settings/flags";
import { getTranslations } from "next-intl/server";
import Image from "next/image";

export default async function DashboardLayout({
	children,
}: {
	children: React.ReactNode;
}) {
	const [
		ownerId,
		currentUser,
		isTenantAdmin,
		isPlatformAdmin,
		viewAs,
		viewAsState,
		helpEnabled,
		announcement,
	] = await Promise.all([
		getCurrentPondOwnerId(),
		requirePasswordChanged(),
		isCurrentTenantAdmin(),
		isCurrentPlatformAdmin(),
		getViewAsBanner(),
		getViewAsState(),
		isFeatureEnabled("help.centre"),
		getActiveAnnouncement(),
	]);

	// E18 (#199): a platform admin's home is the platform console. This runs
	// before any pond, notification or device read, and leaves an active
	// read-only view-as session untouched.
	await redirectPlatformAdminFromDashboard({
		isPlatformAdmin,
		viewAsActive: viewAsState.active,
		userId: currentUser.id,
	});

	const tCommon = await getTranslations("dashboard.common");
	const avatarUrls = currentUser
		? await getSignedAvatarUrls([{ id: currentUser.id, avatarPath: currentUser.avatarPath }])
		: {};

	// Farmer pond chrome (pond name/selector, last synced, hopper widget) is
	// tenant identity, and a platform admin has none outside view-as.
	const showPondChrome = !(isPlatformAdmin && !viewAsState.active);

	let pondId = "";
	let initialUnreadCount = 0;
	let hopperLevelPct: number | null = null;
	let hopperLevelUpdatedAt: Date | null = null;
	let hopperCapacityG: number | null = null;
	let hopperGramsPerFeeding: number | null = null;
	let hopperFeedsPerDay: number | null = null;
	let esp32Status: "online" | "weak" | "offline" | "missing" = "missing";
	let pondName = "";
	let lastSeenAtStr: string | null = null;
	let ponds: { id: string; name: string }[] = [];
	let activePondId = "";

	try {
		const [allPonds, selectedId] = await Promise.all([listSelectablePonds(), getActivePondId()]);

		ponds = allPonds.map((p) => ({ id: p.id, name: p.name }));

		const pond = allPonds.find((p) => p.id === selectedId) ?? allPonds[0];

		if (pond) {
			pondId = pond.id;
			activePondId = pond.id;
			pondName = pond.name;
			hopperFeedsPerDay = pond.feedsPerDay ?? null;

			const [unreadCount, hopper] = await Promise.all([
				prisma.notification.count({
					where: { pondId: pond.id, read: false },
				}),
				loadPondHopper(pond.id),
			]);
			initialUnreadCount = unreadCount;

			if (hopper) {
				hopperLevelPct = hopper.levelPercent;
				hopperLevelUpdatedAt = hopper.levelUpdatedAt;
				hopperCapacityG = hopper.hopperCapacityG;
				hopperGramsPerFeeding = hopper.gramsPerFeeding;
				esp32Status = hopper.status;
				lastSeenAtStr = hopper.lastSeenAt ? hopper.lastSeenAt.toISOString() : null;
			}
		}
	} catch (err) {
		console.error("[DashboardLayout] Prisma error:", err);
	}

	const deviceStatusLabel =
		esp32Status === "online"
			? tCommon("deviceOnline")
			: esp32Status === "weak"
				? tCommon("deviceWeak")
				: esp32Status === "offline"
					? tCommon("deviceOffline")
					: tCommon("deviceMissing");

	return (
		<ChatWidgetProvider role={isPlatformAdmin ? "superadmin" : isTenantAdmin ? "owner" : "farmer"}>
			<OfflineSync scope={ownerId} />
			<DashboardLiveRefresh enabled={Boolean(pondId)} />
			<OnboardingProvider>
				<div className="flex h-dvh flex-col overflow-hidden bg-[#F4F7F6] dark:bg-gray-950">
					<a
						href="#main-content"
						className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-3 focus:z-50 focus:rounded-xl focus:bg-white focus:px-4 focus:py-2.5 focus:text-sm focus:font-black focus:text-[#0A3D62] focus:shadow-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0A3D62] dark:bg-gray-900 dark:text-[#8fc0ea]"
					>
						{tCommon("skipToContent")}
					</a>
					{viewAs && (
						<ViewAsBanner
							orgName={viewAs.orgName}
							reason={viewAs.reason}
							expiresAt={viewAs.expiresAt.toISOString()}
						/>
					)}
					<NotificationProvider pondId={pondId} initialUnreadCount={initialUnreadCount}>
						<header className="sticky top-0 z-30 w-full shrink-0 bg-[#0A3D62] shadow-md">
							<GlobalSearch shell="farmer" />
							<MobileHeader
								shell="farmer"
								isTenantAdmin={isTenantAdmin}
								subtitle={
									showPondChrome ? (
										<div className="flex items-center gap-1.5">
											<PondSelector ponds={ponds} activePondId={activePondId} />
											{esp32Status !== "missing" && (
												<>
													<span aria-hidden="true">·</span>
													<span className="shrink-0">{deviceStatusLabel}</span>
												</>
											)}
										</div>
									) : null
								}
							>
								<CompactHeaderActions
									initialUser={
										currentUser
											? {
													email: currentUser.email,
													role: currentUser.role,
													displayName: currentUser.displayName,
													avatarUrl: avatarUrls[currentUser.id] ?? null,
													isTenantAdmin,
													isPlatformAdmin,
												}
											: undefined
									}
									isViewingAs={viewAsState.active}
									helpEnabled={helpEnabled}
								/>
							</MobileHeader>

							<div className="hidden h-16 w-full items-center justify-between px-4 md:px-8 lg:flex">
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
												aria-hidden="true"
												className={`w-2 h-2 rounded-full shadow-[0_0_8px_currentColor] transition-all duration-500 ${
													esp32Status === "online"
														? "bg-[#1E7B34] text-[#1E7B34]"
														: esp32Status === "weak"
															? "bg-[#B45309] text-[#B45309]"
															: "bg-[#C42B3A] text-[#C42B3A]"
												}`}
											/>
											<span className="text-[10px] text-white/70 uppercase tracking-wider">
												{deviceStatusLabel}
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
									isViewingAs={viewAsState.active}
									helpEnabled={helpEnabled}
									initialUser={
										currentUser
											? {
													email: currentUser.email,
													role: currentUser.role,
													displayName: currentUser.displayName,
													avatarUrl: avatarUrls[currentUser.id] ?? null,
													isTenantAdmin,
													isPlatformAdmin,
												}
											: undefined
									}
								/>
							</div>
						</header>

						<DashboardContentShell>
							<Sidebar
								hopperLevelPct={hopperLevelPct}
								hopperLevelUpdatedAt={hopperLevelUpdatedAt}
								hopperCapacityG={hopperCapacityG}
								gramsPerFeeding={hopperGramsPerFeeding}
								feedsPerDay={hopperFeedsPerDay}
								isOffline={esp32Status === "offline"}
								showHopperWidget={showPondChrome}
							/>
							<main
								id="main-content"
								tabIndex={-1}
								className="ofd-main relative z-10 min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-clip p-4 focus:outline-none md:p-8"
							>
								<BackToDashboard />
								{announcement && (
									<div className="mb-4">
										<AnnouncementBanner
											id={announcement.id}
											title={announcement.title}
											body={announcement.body}
											severity={announcement.severity}
										/>
									</div>
								)}
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
