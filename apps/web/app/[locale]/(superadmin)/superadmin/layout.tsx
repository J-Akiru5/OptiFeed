import { OptiFeedLogo } from "@/components/OptiFeedLogo";
import { ChatWidget } from "@/components/chat/chat-widget";
import { ChatWidgetProvider } from "@/components/chat/chat-widget-provider";
import { DarkModeToggle } from "@/components/dark-mode-toggle";
import { FabStack } from "@/components/fab-stack";
import { HelpButton } from "@/components/help/help-button";
import { MobileHeader } from "@/components/mobile/mobile-header";
import { GlobalSearch, SearchTrigger } from "@/components/search/global-search";
import { SuperadminBottomNav } from "@/components/superadmin-bottom-nav";
import { SuperadminSidebar } from "@/components/superadmin-sidebar";
import { SuperadminAccountMenu } from "@/components/superadmin/account-menu";
import { FOCUS_RING_ON_DARK } from "@/components/superadmin/ui";
import { Link } from "@/i18n/routing";
import { requirePlatformAdmin } from "@/lib/auth/require-platform-admin";
import { requirePasswordChanged } from "@/lib/auth/session";
import { hasActiveTenantMembership } from "@/lib/auth/tenant-membership";
import { getSignedAvatarUrls } from "@/lib/avatars";
import { isFeatureEnabled } from "@/lib/settings/flags";
import { cn } from "@/lib/utils";
import { getTranslations } from "next-intl/server";
import Image from "next/image";

/**
 * Platform console shell. Gated on the PlatformAdmin row, not UserRole —
 * an account can hold role=ADMIN and still be denied here, and a role=VIEWER
 * superadmin is allowed here. Mirrors (admin)/layout.tsx.
 *
 * Copy comes from the `superadmin.shell` catalogue (T-10). The shell chrome is
 * branded navy in both themes; the content surface follows the shared
 * `optifeed:theme` preference through the top-bar toggle (#477), so the pages,
 * `loading.tsx` and `error.tsx` paint from the same `dark:` palette.
 *
 * The farm-dashboard link is offered only to a platform admin who is also an
 * active tenant member (E18, #199): everyone else has no tenant dashboard to
 * open, and the `/dashboard` gate would send them straight back here.
 */
export default async function SuperadminLayout({
	children,
}: {
	children: React.ReactNode;
}) {
	const currentUser = await requirePasswordChanged();
	await requirePlatformAdmin();
	const [t, avatarUrls, hasFarmDashboard, helpEnabled] = await Promise.all([
		getTranslations("superadmin.shell"),
		getSignedAvatarUrls([{ id: currentUser.id, avatarPath: currentUser.avatarPath }]),
		hasActiveTenantMembership(currentUser.id),
		isFeatureEnabled("help.centre"),
	]);
	const accountUser = {
		displayName: currentUser.displayName ?? currentUser.farmId,
		email: currentUser.contactEmail ?? currentUser.email,
		farmId: currentUser.farmId,
		role: currentUser.role,
		avatarUrl: avatarUrls[currentUser.id] ?? null,
	};

	const assistantRole = "superadmin" as const;

	return (
		<ChatWidgetProvider role={assistantRole}>
			<div className="flex h-dvh flex-col overflow-hidden bg-console-page">
				<a
					href="#main-content"
					className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-xl focus:bg-console-surface focus:px-4 focus:py-2 focus:text-sm focus:font-black focus:text-console-content focus:shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-console-focus"
				>
					{t("skipToContent")}
				</a>

				<header className="sticky top-0 z-30 w-full shrink-0 bg-console-header shadow-md">
					<GlobalSearch shell="platform" />
					<MobileHeader>
						{/* The band owns the mobile theme switch, so passing one here would
						    render a second, differently sized toggle next to it. */}
						{helpEnabled && <HelpButton audience="superadmin" className="h-11 w-11" />}
						<SuperadminAccountMenu user={accountUser} hasFarmDashboard={hasFarmDashboard} />
					</MobileHeader>

					<div className="hidden h-16 w-full items-center justify-between gap-3 px-4 md:px-8 lg:flex">
						<div className="flex min-w-0 items-center gap-3">
							<Link
								href="/superadmin"
								aria-label={t("homeLabel")}
								className={cn(
									"flex shrink-0 items-center justify-center rounded-lg transition-all",
									FOCUS_RING_ON_DARK,
								)}
							>
								<OptiFeedLogo size={32} variant="ondark" />
							</Link>
							<Image
								src="/pakaonai-logo-kit/png/pakaonai-wordmark-color.png"
								alt="PakaonAI"
								width={110}
								height={26}
								className="h-[26px] w-auto shrink-0 object-contain brightness-0 invert"
							/>
							<span className="ml-2 hidden items-center gap-1.5 rounded-full bg-console-accent px-2.5 py-1 text-[10px] font-black uppercase tracking-wider text-console-accent-foreground md:inline-flex">
								{t("platform")}
							</span>
						</div>

						<div className="flex shrink-0 items-center gap-3">
							<SearchTrigger />
							<DarkModeToggle />
							{helpEnabled && <HelpButton audience="superadmin" />}
							{hasFarmDashboard && (
								<Link
									href="/dashboard"
									className={cn(
										"rounded-lg px-2 py-1 text-sm font-bold text-console-header-ink-muted transition-colors hover:text-console-header-ink",
										FOCUS_RING_ON_DARK,
									)}
								>
									{t("openFarmDashboard")}
								</Link>
							)}
							{/* The console's own account surface (#560): profile, password and
							    sign out work for a platform admin without a tenant membership. */}
							<SuperadminAccountMenu user={accountUser} hasFarmDashboard={hasFarmDashboard} />
						</div>
					</div>
				</header>

				<div className="flex min-h-0 w-full flex-1 overflow-hidden">
					<SuperadminSidebar showFarmDashboard={hasFarmDashboard} />
					{/* min-w-0 lets a wide table scroll inside its own card instead of
				    widening the page. `.ofd-console-pane` owns the padding scale for
				    every breakpoint. */}
					<main
						id="main-content"
						tabIndex={-1}
						className="ofd-console-pane relative z-10 min-h-0 min-w-0 flex-1 overflow-y-auto"
					>
						{children}
					</main>
				</div>

				<SuperadminBottomNav />
				<ChatWidget />
				<FabStack />
			</div>
		</ChatWidgetProvider>
	);
}
