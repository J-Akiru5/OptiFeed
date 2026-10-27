import { OptiFeedLogo } from "@/components/OptiFeedLogo";
import { AdminBottomNav } from "@/components/admin-bottom-nav";
import { AdminSidebar } from "@/components/admin-sidebar";
import { HelpButton } from "@/components/help/help-button";
import { UserAvatar } from "@/components/user-avatar";
import { Link } from "@/i18n/routing";
import { requirePasswordChanged } from "@/lib/auth/session";
import { requireTenantAdmin } from "@/lib/auth/tenant-admin";
import { getSignedAvatarUrls } from "@/lib/avatars";
import { getTranslations } from "next-intl/server";
import Image from "next/image";

export default async function AdminLayout({
	children,
}: {
	children: React.ReactNode;
}) {
	const currentUser = await requirePasswordChanged();
	await requireTenantAdmin();
	const [t, avatarUrls] = await Promise.all([
		getTranslations("dashboard.adminShell"),
		getSignedAvatarUrls([{ id: currentUser.id, avatarPath: currentUser.avatarPath }]),
	]);

	return (
		<div className="flex min-h-screen flex-col bg-[#F4F7F6] dark:bg-gray-950">
			<a
				href="#admin-main"
				className="sr-only focus:not-sr-only focus:absolute focus:top-4 focus:left-4 focus:z-50 focus:rounded-lg focus:bg-white focus:px-4 focus:py-2 focus:text-sm focus:font-bold focus:text-[#0A3D62] dark:focus:bg-gray-900 dark:focus:text-[#8fc0ea]"
			>
				{t("skipToContent")}
			</a>

			{/* Header */}
			<header className="sticky top-0 z-30 flex h-16 w-full shrink-0 items-center justify-between gap-3 bg-[#0A3D62] px-4 shadow-md md:px-8">
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
					<HelpButton audience="owner" />
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
			</header>

			<div className="flex min-h-[calc(100vh-4rem)] w-full flex-1">
				<AdminSidebar />
				<main
					id="admin-main"
					tabIndex={-1}
					className="relative z-10 min-w-0 flex-1 p-4 pb-24 focus-visible:outline-none md:p-8 md:pb-24 lg:pb-8"
				>
					{children}
				</main>
			</div>

			<AdminBottomNav />
		</div>
	);
}
