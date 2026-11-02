import {
	Activity,
	BarChart3,
	CalendarDays,
	Cpu,
	Droplets,
	FolderTree,
	type LucideIcon,
	Settings,
	Sparkles,
	Users,
} from "lucide-react";

/** Message keys under `superadmin.shell.nav`, one per console section. */
export type SuperadminNavKey =
	| "overview"
	| "calendar"
	| "users"
	| "organizations"
	| "ponds"
	| "devices"
	| "operations"
	| "aiProviders"
	| "settings";

/** Message keys under `superadmin.shell.groups`. */
export type SuperadminNavGroupKey = "commandCenter" | "ecosystem" | "platformControl";

export type SuperadminNavItem = { href: string; key: SuperadminNavKey; icon: LucideIcon };

export type SuperadminNavGroup = {
	key: SuperadminNavGroupKey;
	items: readonly SuperadminNavItem[];
};

/**
 * The platform console sidebar, grouped by what the operator is doing (plan
 * M3C.1, decision T24). Every URL is the one the flat nine-item list used, so
 * no link, bookmark or audit trail changes.
 *
 * Command Center holds only Overview until its pages exist: Incidents (M3C.5)
 * and Fleet monitor (M3C.4) join it when they ship, not before, so the sidebar
 * never links to a page that is not there. Audit stays a tab under Operations.
 */
export const SUPERADMIN_NAV_GROUPS: readonly SuperadminNavGroup[] = [
	{
		key: "commandCenter",
		items: [{ href: "/superadmin", key: "overview", icon: BarChart3 }],
	},
	{
		key: "ecosystem",
		items: [
			{ href: "/superadmin/orgs", key: "organizations", icon: FolderTree },
			{ href: "/superadmin/users", key: "users", icon: Users },
			{ href: "/superadmin/ponds", key: "ponds", icon: Droplets },
			{ href: "/superadmin/devices", key: "devices", icon: Cpu },
			{ href: "/superadmin/calendar", key: "calendar", icon: CalendarDays },
		],
	},
	{
		key: "platformControl",
		items: [
			{ href: "/superadmin/operations", key: "operations", icon: Activity },
			{ href: "/superadmin/ai-providers", key: "aiProviders", icon: Sparkles },
			{ href: "/superadmin/settings", key: "settings", icon: Settings },
		],
	},
];

/**
 * Whether a sidebar link is the current page. The overview matches exactly
 * (every console URL starts with it); the others match their own path and
 * anything beneath it, on a segment boundary so `/superadmin/orgs-archive`
 * would not light up Organizations.
 */
export function isNavItemActive(href: string, pathname: string): boolean {
	const path = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
	if (href === "/superadmin") return path === "/superadmin";
	return path === href || path.startsWith(`${href}/`);
}
