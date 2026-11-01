"use client";

import { SidebarCollapseToggle, useSidebarCollapse } from "@/components/sidebar-collapse";
import { FOCUS_RING_ON_DARK } from "@/components/superadmin/ui";
import { Link, usePathname, useRouter } from "@/i18n/routing";
import { clearOfflineData } from "@/lib/offline/db";
import { clearDashboardSnapshot } from "@/lib/pwa/snapshot";
import { createClient } from "@/lib/supabase/client";
import { SUPERADMIN_NAV_GROUPS, isNavItemActive } from "@/lib/superadmin-nav";
import { cn } from "@/lib/utils";
import { BarChart3, Loader2, LogOut } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";

/**
 * Platform console navigation, in three groups (plan M3C.1): Command Center,
 * Ecosystem Management and Platform Control. The groups and their URLs live in
 * `lib/superadmin-nav.ts`.
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
	const tSidebar = useTranslations("sidebar");
	const pathname = usePathname();
	const router = useRouter();
	const { collapsed, animate, toggle } = useSidebarCollapse();
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
		<aside
			data-collapsed={collapsed ? "true" : undefined}
			className={cn(
				"z-20 hidden h-full shrink-0 flex-col overflow-y-auto bg-[#0A3D62] text-white scrollbar-none lg:flex",
				collapsed ? "w-[76px] p-3" : "w-64 p-6",
				animate && "transition-[width,padding] duration-200 ease-out motion-reduce:transition-none",
			)}
		>
			<nav id="superadmin-sidebar-nav" aria-label={t("navLabel")} className="space-y-4">
				{SUPERADMIN_NAV_GROUPS.map((group, index) => {
					const headingId = `superadmin-nav-group-${group.key}`;

					return (
						<div
							key={group.key}
							className={cn(collapsed && index > 0 && "border-t border-white/10 pt-4")}
						>
							<p
								id={headingId}
								className={cn(
									"mb-2 px-3 text-[10px] font-extrabold uppercase tracking-widest text-white/80",
									collapsed && "sr-only",
								)}
							>
								{t(`groups.${group.key}`)}
							</p>
							<ul aria-labelledby={headingId} className="space-y-1">
								{group.items.map((item) => {
									const isActive = isNavItemActive(item.href, pathname);

									return (
										<li key={item.href}>
											<Link
												href={item.href}
												aria-current={isActive ? "page" : undefined}
												aria-label={collapsed ? t(`nav.${item.key}`) : undefined}
												title={collapsed ? t(`nav.${item.key}`) : undefined}
												className={cn(
													"flex min-h-11 w-full items-center rounded-2xl text-[15px] font-bold transition-colors",
													collapsed ? "justify-center p-3" : "gap-3 p-3.5",
													FOCUS_RING_ON_DARK,
													isActive
														? "bg-[#E85A2A] text-white shadow-md ring-1 ring-white/20"
														: "text-white/80 hover:bg-white/10 hover:text-white",
												)}
											>
												<item.icon className="h-5 w-5 shrink-0" aria-hidden="true" />
												<span className={cn(collapsed && "sr-only")}>{t(`nav.${item.key}`)}</span>
											</Link>
										</li>
									);
								})}
							</ul>
						</div>
					);
				})}
			</nav>

			<div className="mt-auto space-y-1 border-t border-white/10 pt-6">
				{showFarmDashboard && (
					<Link
						href="/dashboard"
						aria-label={collapsed ? t("openFarmDashboard") : undefined}
						title={collapsed ? t("openFarmDashboard") : undefined}
						className={cn(
							"flex min-h-11 items-center rounded-2xl text-sm font-bold text-white/80 transition-colors hover:bg-white/10 hover:text-white",
							collapsed ? "justify-center p-3" : "gap-3 p-3.5",
							FOCUS_RING_ON_DARK,
						)}
					>
						<BarChart3 className="h-4 w-4 shrink-0" aria-hidden="true" />
						<span className={cn(collapsed && "sr-only")}>{t("openFarmDashboard")}</span>
					</Link>
				)}
				<button
					type="button"
					onClick={handleSignOut}
					disabled={isSigningOut}
					aria-label={collapsed ? t("signOut") : undefined}
					title={collapsed ? t("signOut") : undefined}
					className={cn(
						"flex min-h-11 w-full items-center rounded-2xl text-sm font-bold text-white/80 transition-colors hover:bg-white/10 hover:text-white disabled:opacity-50",
						collapsed ? "justify-center p-3" : "gap-3 p-3.5",
						FOCUS_RING_ON_DARK,
					)}
				>
					{isSigningOut ? (
						<Loader2 className="h-4 w-4 shrink-0 animate-spin" aria-hidden="true" />
					) : (
						<LogOut className="h-4 w-4 shrink-0" aria-hidden="true" />
					)}
					<span className={cn(collapsed && "sr-only")}>{t("signOut")}</span>
				</button>
				<SidebarCollapseToggle
					collapsed={collapsed}
					onToggle={toggle}
					labelCollapse={tSidebar("collapse")}
					labelExpand={tSidebar("expand")}
					controls="superadmin-sidebar-nav"
					tone="dark"
				/>
			</div>
		</aside>
	);
}
