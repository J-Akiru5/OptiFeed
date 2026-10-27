import { OptiFeedLogo } from "@/components/OptiFeedLogo";
import { HelpButton } from "@/components/help/help-button";
import { SuperadminBottomNav } from "@/components/superadmin-bottom-nav";
import { SuperadminSidebar } from "@/components/superadmin-sidebar";
import { FOCUS_RING_ON_DARK } from "@/components/superadmin/ui";
import { UserAvatar } from "@/components/user-avatar";
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
 * Copy comes from the `superadmin.shell` catalogue (T-10) and the shell paints
 * the light brand surface regardless of the OS colour scheme, so the shell, the
 * pages, `loading.tsx` and `error.tsx` stay on the same palette.
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
	const avatar = (
		<UserAvatar
			src={avatarUrls[currentUser.id] ?? null}
			name={currentUser.displayName ?? currentUser.farmId}
			size="md"
			className="rounded-full bg-[#E85A2A]"
		/>
	);

	return (
		<div className="flex min-h-screen flex-col bg-[#F4F7F6]">
			<a
				href="#main-content"
				className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-xl focus:bg-white focus:px-4 focus:py-2 focus:text-sm focus:font-black focus:text-[#0A3D62] focus:shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#E85A2A]"
			>
				{t("skipToContent")}
			</a>

			<header className="sticky top-0 z-30 flex h-16 w-full shrink-0 items-center justify-between gap-3 bg-[#0A3D62] px-4 shadow-md md:px-8">
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
					<span className="ml-2 hidden items-center gap-1.5 rounded-full bg-[#E85A2A] px-2.5 py-1 text-[10px] font-black uppercase tracking-wider text-white md:inline-flex">
						{t("platform")}
					</span>
				</div>

				<div className="flex shrink-0 items-center gap-3">
					{helpEnabled && <HelpButton audience="superadmin" />}
					{hasFarmDashboard && (
						<Link
							href="/dashboard"
							className={cn(
								"rounded-lg px-2 py-1 text-sm font-bold text-white/80 transition-colors hover:text-white",
								FOCUS_RING_ON_DARK,
							)}
						>
							{t("openFarmDashboard")}
						</Link>
					)}
					{/* The profile page lives under /dashboard, which redirects platform admins
					    without a farm back here (E18); link it only for those who have one. */}
					{hasFarmDashboard ? (
						<Link
							href="/dashboard/settings/profile"
							aria-label={t("profile")}
							className={cn("rounded-full", FOCUS_RING_ON_DARK)}
						>
							{avatar}
						</Link>
					) : (
						avatar
					)}
				</div>
			</header>

			<div className="flex min-h-[calc(100vh-4rem)] w-full flex-1">
				<SuperadminSidebar showFarmDashboard={hasFarmDashboard} />
				{/* min-w-0 lets a wide table scroll inside its own card instead of
				    widening the page. */}
				<main
					id="main-content"
					tabIndex={-1}
					className="relative z-10 min-w-0 flex-1 p-4 pb-24 md:p-8 md:pb-24 lg:pb-8"
				>
					{children}
				</main>
			</div>

			<SuperadminBottomNav />
		</div>
	);
}
