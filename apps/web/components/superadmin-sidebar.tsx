"use client";

import { FOCUS_RING_ON_DARK } from "@/components/superadmin/ui";
import { Link, usePathname, useRouter } from "@/i18n/routing";
import { clearOfflineData } from "@/lib/offline/db";
import { clearDashboardSnapshot } from "@/lib/pwa/snapshot";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import {
	BarChart3,
	CalendarDays,
	Cpu,
	Droplets,
	FolderTree,
	Loader2,
	LogOut,
	Settings,
	Sparkles,
	Users,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";

const navItems = [
	{ href: "/superadmin", key: "overview", icon: BarChart3 },
	{ href: "/superadmin/calendar", key: "calendar", icon: CalendarDays },
	{ href: "/superadmin/users", key: "users", icon: Users },
	{ href: "/superadmin/orgs", key: "organizations", icon: FolderTree },
	{ href: "/superadmin/ponds", key: "ponds", icon: Droplets },
	{ href: "/superadmin/devices", key: "devices", icon: Cpu },
	{ href: "/superadmin/ai-providers", key: "aiProviders", icon: Sparkles },
	{ href: "/superadmin/settings", key: "settings", icon: Settings },
] as const;

/**
 * Platform console navigation.
 *
 * Devices is the hardware registry (plan v2, M3F) and, since M5.2, the remote
 * feeder control surface: every remote command goes through the tenant command
 * implementation with the same server caps, a required reason, step-up and one
 * audit row (decision D1). Ponds remains visibility only.
 *
 * AI Providers is the one configuration surface, and it is platform-level only:
 * it controls the model chain every tenant shares, not any farm's data.
 *
 * The farm-dashboard link renders only for a platform admin who is also an
 * active tenant member (E18, #199); the layout resolves that from Membership.
 */
export function SuperadminSidebar({ showFarmDashboard = false }: { showFarmDashboard?: boolean }) {
	const t = useTranslations("superadmin.shell");
	const pathname = usePathname();
	const router = useRouter();
	const supabase = createClient();
	const [isSigningOut, setIsSigningOut] = useState(false);

	// Self-contained rather than reusing LogoutButton: that component reads
	// useChatWidget(), which only exists inside the dashboard's provider tree.
	const handleSignOut = async () => {
		setIsSigningOut(true);
		clearDashboardSnapshot();
		await clearOfflineData();
		await supabase.auth.signOut();
		router.replace("/");
	};

	return (
		<aside className="sticky top-[64px] z-20 hidden h-[calc(100vh-64px)] w-64 shrink-0 flex-col overflow-y-auto bg-[#0A3D62] p-6 text-white scrollbar-none lg:flex">
			<nav aria-label={t("navLabel")} className="space-y-1">
				<p className="mb-3 px-3 text-[10px] font-extrabold uppercase tracking-widest text-white/80">
					{t("console")}
				</p>
				{navItems.map((item) => {
					const isActive =
						item.href === "/superadmin"
							? pathname === "/superadmin" || pathname === "/superadmin/"
							: pathname.startsWith(item.href);

					return (
						<Link
							key={item.href}
							href={item.href}
							aria-current={isActive ? "page" : undefined}
							className={cn(
								"flex w-full items-center gap-3 rounded-2xl p-3.5 text-[15px] font-bold transition-colors",
								FOCUS_RING_ON_DARK,
								isActive
									? "bg-[#E85A2A] text-white shadow-md ring-1 ring-white/20"
									: "text-white/80 hover:bg-white/10 hover:text-white",
							)}
						>
							<item.icon className="h-5 w-5 shrink-0" aria-hidden="true" />
							{t(`nav.${item.key}`)}
						</Link>
					);
				})}
			</nav>

			<div className="mt-auto border-t border-white/10 pt-6">
				{showFarmDashboard && (
					<Link
						href="/dashboard"
						className={cn(
							"flex items-center gap-3 rounded-2xl p-3.5 text-sm font-bold text-white/80 transition-colors hover:bg-white/10 hover:text-white",
							FOCUS_RING_ON_DARK,
						)}
					>
						<BarChart3 className="h-4 w-4 shrink-0" aria-hidden="true" />
						{t("openFarmDashboard")}
					</Link>
				)}
				<button
					type="button"
					onClick={handleSignOut}
					disabled={isSigningOut}
					className={cn(
						"flex w-full items-center gap-3 rounded-2xl p-3.5 text-sm font-bold text-white/80 transition-colors hover:bg-white/10 hover:text-white disabled:opacity-50",
						FOCUS_RING_ON_DARK,
					)}
				>
					{isSigningOut ? (
						<Loader2 className="h-4 w-4 shrink-0 animate-spin" aria-hidden="true" />
					) : (
						<LogOut className="h-4 w-4 shrink-0" aria-hidden="true" />
					)}
					{t("signOut")}
				</button>
			</div>
		</aside>
	);
}
