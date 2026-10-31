"use client";

import { usePathname } from "@/i18n/routing";
import { useTranslations } from "next-intl";

/** Which shell the band belongs to. */
export type MobileShell = "farmer" | "admin" | "platform";

type Route = { prefix: string; key: string };

/**
 * Route → message key. Longest prefix wins, so `/dashboard/settings/pond`
 * resolves to Settings rather than Dashboard and `/admin/ponds/new` stays
 * Ponds. The keys are the existing navigation labels, so the band title is
 * translated wherever the sidebar is.
 */
const FARMER_ROUTES: Route[] = [
	{ prefix: "/dashboard/notifications", key: "notifications" },
	{ prefix: "/dashboard/schedule", key: "schedule" },
	{ prefix: "/dashboard/log-sample", key: "logSample" },
	{ prefix: "/dashboard/calendar", key: "calendar" },
	{ prefix: "/dashboard/history", key: "history" },
	{ prefix: "/dashboard/growth", key: "growth" },
	{ prefix: "/dashboard/audit", key: "audit" },
	{ prefix: "/dashboard/settings", key: "settings" },
	{ prefix: "/dashboard/app-settings", key: "settings" },
	{ prefix: "/dashboard/profile-settings", key: "settings" },
	{ prefix: "/dashboard", key: "dashboard" },
];

const ADMIN_ROUTES: Route[] = [
	{ prefix: "/admin/hierarchy", key: "hierarchy" },
	{ prefix: "/admin/calendar", key: "calendar" },
	{ prefix: "/admin/users", key: "users" },
	{ prefix: "/admin/ponds", key: "ponds" },
	{ prefix: "/admin/devices", key: "devices" },
	{ prefix: "/admin/audit", key: "audit" },
	{ prefix: "/admin/settings", key: "settings" },
	{ prefix: "/admin", key: "overview" },
];

const PLATFORM_ROUTES: Route[] = [
	{ prefix: "/superadmin/ai-providers", key: "aiProviders" },
	{ prefix: "/superadmin/operations", key: "operations" },
	{ prefix: "/superadmin/calendar", key: "calendar" },
	{ prefix: "/superadmin/users", key: "users" },
	{ prefix: "/superadmin/orgs", key: "organizations" },
	{ prefix: "/superadmin/ponds", key: "ponds" },
	{ prefix: "/superadmin/devices", key: "devices" },
	{ prefix: "/superadmin/settings", key: "settings" },
	{ prefix: "/superadmin", key: "overview" },
];

const ROUTES: Record<MobileShell, Route[]> = {
	farmer: FARMER_ROUTES,
	admin: ADMIN_ROUTES,
	platform: PLATFORM_ROUTES,
};

const NAMESPACES: Record<MobileShell, string> = {
	farmer: "nav",
	admin: "dashboard.adminShell.nav",
	platform: "superadmin.shell.nav",
};

/** Message key for a pathname, or `""` when the route has no label yet. */
export function pageTitleKey(shell: MobileShell, pathname: string): string {
	const match = ROUTES[shell]
		.filter((route) => pathname === route.prefix || pathname.startsWith(`${route.prefix}/`))
		.sort((a, b) => b.prefix.length - a.prefix.length)[0];
	return match?.key ?? "";
}

/**
 * The title the mobile band shows for the current page.
 *
 * It duplicates the page's own `<h1>` for sighted readers (the h1 stays in the
 * markup for assistive tech), so the band marks its copy `aria-hidden`.
 */
export function useMobilePageTitle(shell: MobileShell): string {
	const pathname = usePathname();
	// One translator per shell keeps the hook unconditional.
	const t = useTranslations(NAMESPACES[shell]);
	const key = pageTitleKey(shell, pathname);
	return key ? t(key) : "";
}
