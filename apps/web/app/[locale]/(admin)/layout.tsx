import { OptiFeedLogo } from "@/components/OptiFeedLogo";
import { AdminBottomNav } from "@/components/admin-bottom-nav";
import { AdminSidebar } from "@/components/admin-sidebar";
import { AnnouncementBanner } from "@/components/announcements/announcement-banner";
import { ChatWidget } from "@/components/chat/chat-widget";
import { ChatWidgetProvider } from "@/components/chat/chat-widget-provider";
import { HelpButton } from "@/components/help/help-button";
import { MobileHeader } from "@/components/mobile/mobile-header";
import { GlobalSearch, SearchTrigger } from "@/components/search/global-search";
import { UserAvatar } from "@/components/user-avatar";
import { Link } from "@/i18n/routing";
import { requirePasswordChanged } from "@/lib/auth/session";
import { requireTenantAdmin } from "@/lib/auth/tenant-admin";
import { getSignedAvatarUrls } from "@/lib/avatars";
import { getActiveAnnouncement } from "@/lib/settings/announcement";
import { isFeatureEnabled } from "@/lib/settings/flags";
import { getTranslations } from "next-intl/server";
import Image from "next/image";

export default async function AdminLayout({
	children,
}: {
	children: React.ReactNode;
}) {
	const currentUser = await requirePasswordChanged();
	await requireTenantAdmin();
	const [t, avatarUrls, helpEnabled, announcement] = await Promise.all([
		getTranslations("dashboard.adminShell"),
		getSignedAvatarUrls([{ id: currentUser.id, avatarPath: currentUser.avatarPath }]),
		isFeatureEnabled("help.centre"),
		getActiveAnnouncement(),
	]);

	const assistantRole = "owner" as const;

	return (
		<ChatWidgetProvider role={assistantRole}>
			<div className="flex h-dvh flex-col overflow-hidden bg-[#F4F7F6] dark:bg-gray-950">
				<a
					href="#admin-main"
					className="sr-only focus:not-sr-only focus:absolute focus:top-4 focus:left-4 focus:z-50 focus:rounded-lg focus:bg-white focus:px-4 focus:py-2 focus:text-sm focus:font-bold focus:text-[#0A3D62] dark:focus:bg-gray-900 dark:focus:text-[#8fc0ea]"
				>
					{t("skipToContent")}
				</a>

				{/* Header */}
				<header className="sticky top-0 z-30 w-full shrink-0 bg-[#0A3D62] shadow-md">
					<GlobalSearch shell="admin" />
					<MobileHeader shell="admin" isTenantAdmin subtitle={t("panelLabel")}>
						{helpEnabled && <HelpButton audience="owner" className="h-11 w-11" />}
						<Link
							href="/dashboard/settings/profile"
							aria-label={t("profile")}
							className="rounded-full transition-all focus-visible:ring-2 focus-visible:ring-white focus-visible:outline-none"
						>
							<UserAvatar
								src={avatarUrls[currentUser.id] ?? null}
								name={currentUser.displayName ?? currentUser.farmId}
								size="md"
								className="rounded-full bg-[#C2410C]"
							/>
						</Link>
					</MobileHeader>

					<div className="hidden h-16 w-full items-center justify-between gap-3 px-4 md:px-8 lg:flex">
						<div className="flex min-w-0 items-center gap-3">
							<Link
								href="/admin"
								aria-label={t("home")}
								className="flex items-center justify-center rounded-lg transition-all focus-visible:ring-2 focus-visible:ring-white focus-visible:outline-none"
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
							<span className="ml-2 hidden items-center gap-1.5 rounded-full bg-[#C2410C] px-2.5 py-1 text-[10px] font-black tracking-wider text-white uppercase md:inline-flex">
								{t("badge")}
							</span>
						</div>

						<div className="flex shrink-0 items-center gap-3">
							<SearchTrigger />
							{helpEnabled && <HelpButton audience="owner" />}
							<Link
								href="/dashboard"
								className="rounded-lg px-2 py-1 text-sm font-bold text-white/80 transition-colors hover:text-white focus-visible:ring-2 focus-visible:ring-white focus-visible:outline-none"
							>
								{t("dashboardLink")}
							</Link>
							<Link
								href="/dashboard/settings/profile"
								aria-label={t("profile")}
								className="rounded-full transition-all focus-visible:ring-2 focus-visible:ring-white focus-visible:outline-none"
							>
								<UserAvatar
									src={avatarUrls[currentUser.id] ?? null}
									name={currentUser.displayName ?? currentUser.farmId}
									size="md"
									className="rounded-full bg-[#C2410C]"
								/>
							</Link>
						</div>
					</div>
				</header>

				<div className="flex min-h-0 w-full flex-1 overflow-hidden">
					<AdminSidebar />
					<main
						id="admin-main"
						tabIndex={-1}
						className="ofd-main relative z-10 min-h-0 min-w-0 flex-1 overflow-y-auto p-4 focus-visible:outline-none md:p-8"
					>
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
				</div>

				<AdminBottomNav />
				<ChatWidget />
			</div>
		</ChatWidgetProvider>
	);
}
