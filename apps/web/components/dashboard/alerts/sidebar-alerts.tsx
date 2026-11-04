"use client";

import { HealthNotice } from "@/components/feeder/health-notice";
import { Link, usePathname } from "@/i18n/routing";
import type { DashboardAlert } from "@/lib/dashboard/alerts";
import { type DeviceHealthView, deviceHealthNeedsAction } from "@/lib/device-health-model";
import { cn } from "@/lib/utils";
import {
	ArrowRight,
	CheckCircle2,
	CircleAlert,
	OctagonAlert,
	ShieldAlert,
	TriangleAlert,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useId } from "react";
import { useDashboardAlerts } from "./dashboard-alerts-context";

const ALERT_ICON: Record<DashboardAlert["tone"], LucideIcon> = {
	danger: OctagonAlert,
	warning: TriangleAlert,
	info: CircleAlert,
};

const ALERT_TONE: Record<DashboardAlert["tone"], string> = {
	danger: "text-[#C42B3A] dark:text-red-400",
	warning: "text-[#B45309] dark:text-amber-400",
	info: "text-[#0A3D62] dark:text-[#8fc0ea]",
};

/**
 * The dashboard's alerts in the sidebar footer (#819).
 *
 * Only the dashboard publishes a snapshot and this component also checks the
 * pathname, so the shared console shell does not grow a dashboard-only footer
 * on History, Schedule or Settings. The sidebar is the desktop surface; below
 * `lg` the page keeps its own stacked alert section.
 */
export function SidebarAlerts({ collapsed }: { collapsed: boolean }) {
	const pathname = usePathname();
	const { snapshot } = useDashboardAlerts();

	if (pathname !== "/dashboard" || !snapshot.synced) return null;

	return (
		<SidebarAlertList
			alerts={snapshot.alerts}
			health={snapshot.health}
			hardwareHref={snapshot.hardwareHref}
			collapsed={collapsed}
		/>
	);
}

export interface SidebarAlertListProps {
	alerts: readonly DashboardAlert[];
	health: DeviceHealthView | null;
	/** The hardware page for the primary feeder, or null when there is no device. */
	hardwareHref: string | null;
	collapsed: boolean;
}

/**
 * Presentational footer shared by the real sidebar and the tests. Every alert
 * is one real link. In the collapsed rail the icon stays and the label moves
 * to `aria-label`, so the destination is still reachable with a keyboard and
 * still named for a screen reader.
 */
export function SidebarAlertList({
	alerts,
	health,
	hardwareHref,
	collapsed,
}: SidebarAlertListProps) {
	const tNav = useTranslations("nav");
	const tAlerts = useTranslations("dashboard.home.controlRoom.alerts");
	const tHero = useTranslations("dashboard.feederHero");
	const titleId = useId();
	const needsHealth = health ? deviceHealthNeedsAction(health) : false;
	const empty = alerts.length === 0 && !needsHealth;
	const healthLabel = health?.unavailable
		? tHero("healthUnknownTitle")
		: health?.safeMode
			? tHero("healthSafeModeTitle")
			: tHero("healthFaultsTitle");

	return (
		<section aria-labelledby={titleId} data-testid="sidebar-alerts" className="space-y-2">
			<p
				id={titleId}
				className={cn(
					"px-1 text-[10px] font-extrabold uppercase tracking-widest text-[#3D5568] dark:text-gray-400",
					collapsed && "sr-only",
				)}
			>
				{tNav("alerts")}
			</p>

			{needsHealth && health ? (
				collapsed ? (
					hardwareHref ? (
						<Link
							href={hardwareHref}
							aria-label={`${healthLabel}. ${tAlerts("openHardware")}`}
							title={healthLabel}
							className="flex min-h-11 w-full items-center justify-center rounded-xl border border-amber-200 bg-amber-50 text-amber-700 transition-colors hover:bg-amber-100 focus-visible:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0A3D62] dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-300 dark:focus-visible:outline-[#8fc0ea]"
						>
							<ShieldAlert aria-hidden="true" className="h-4 w-4" />
						</Link>
					) : (
						<span className="flex min-h-11 w-full items-center justify-center rounded-xl border border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-300">
							<ShieldAlert aria-hidden="true" className="h-4 w-4" />
							<span className="sr-only">{healthLabel}</span>
						</span>
					)
				) : hardwareHref ? (
					<Link
						href={hardwareHref}
						className="block rounded-2xl focus-visible:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0A3D62] dark:focus-visible:outline-[#8fc0ea]"
					>
						<HealthNotice health={health} tone="themed" />
						<span className="mt-1 inline-flex min-h-8 items-center gap-1 px-1 text-[10px] font-black text-[#C2410C] dark:text-[#ff8a5c]">
							{tAlerts("openHardware")} <ArrowRight aria-hidden="true" className="h-3 w-3" />
						</span>
					</Link>
				) : (
					<HealthNotice health={health} tone="themed" />
				)
			) : null}

			{empty ? (
				<div className="flex items-start gap-2 rounded-xl border border-[#1E7B34]/20 bg-[#1E7B34]/5 p-2.5 dark:border-green-900/40 dark:bg-green-900/10">
					<CheckCircle2
						aria-hidden="true"
						className="mt-0.5 h-4 w-4 shrink-0 text-[#1E7B34] dark:text-green-400"
					/>
					<div className={cn("min-w-0", collapsed && "sr-only")}>
						<p className="text-[11px] font-black leading-snug text-[#0A3D62] dark:text-gray-100">
							{tAlerts("emptyTitle")}
						</p>
						<p className="mt-0.5 text-[10px] font-semibold leading-snug text-[#3D5568] dark:text-gray-400">
							{tAlerts("emptyDetail")}
						</p>
					</div>
				</div>
			) : null}

			{alerts.length > 0 && (
				<ul className="space-y-1.5">
					{alerts.map((alert) => {
						const Icon = ALERT_ICON[alert.tone];
						return (
							<li key={alert.id}>
								<Link
									href={alert.href}
									aria-label={collapsed ? `${alert.title}. ${alert.linkLabel}` : undefined}
									title={collapsed ? alert.title : undefined}
									className={cn(
										"group flex min-h-11 w-full items-start gap-2 rounded-xl border border-[#0A3D62]/10 bg-white px-2.5 py-2 transition-colors hover:border-[#0A3D62]/25 hover:bg-[#F4F7F6] focus-visible:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0A3D62] dark:border-gray-700/50 dark:bg-gray-800/60 dark:hover:border-gray-600 dark:hover:bg-gray-800 dark:focus-visible:outline-[#8fc0ea]",
										collapsed && "justify-center",
									)}
								>
									<Icon
										aria-hidden="true"
										className={cn("mt-0.5 h-4 w-4 shrink-0", ALERT_TONE[alert.tone])}
									/>
									<span className={cn("min-w-0 flex-1", collapsed && "sr-only")}>
										<span className="block text-[11px] font-black leading-snug text-[#0A3D62] dark:text-gray-100">
											{alert.title}
										</span>
										<span className="mt-0.5 block text-[10px] font-semibold leading-snug text-[#3D5568] dark:text-gray-400">
											{alert.detail}
										</span>
										<span className="mt-1 inline-flex items-center gap-1 text-[10px] font-black text-[#C2410C] dark:text-[#ff8a5c]">
											{alert.linkLabel}{" "}
											<ArrowRight aria-hidden="true" className="h-3 w-3 shrink-0" />
										</span>
									</span>
								</Link>
							</li>
						);
					})}
				</ul>
			)}
		</section>
	);
}
