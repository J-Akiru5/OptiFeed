import {
	Activity,
	BarChart3,
	Building2,
	CalendarDays,
	Cpu,
	Droplets,
	FolderTree,
	type LucideIcon,
	OctagonAlert,
	Radio,
	Settings,
	Sparkles,
	Users,
} from "lucide-react";

/** Message keys under `superadmin.shell.nav`, one per console section. */
export type SuperadminNavKey =
	| "overview"
	| "tenants"
	| "fleet"
	| "incidents"
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
 * M3C.1, decision T24). Every URL the flat nine-item list used is unchanged, so
 * no bookmark or audit trail changes.
 *
 * Command Center holds the operator's first-stop pages: the overview, then the
 * tenant health table (M3C.3), the fleet monitor (M3C.4) and the incident queue
 * (M3C.5) once each page shipped. Audit stays a tab under Operations.
 */
export const SUPERADMIN_NAV_GROUPS: readonly SuperadminNavGroup[] = [
	{
		key: "commandCenter",
		items: [
			{ href: "/superadmin", key: "overview", icon: BarChart3 },
			{ href: "/superadmin/tenants", key: "tenants", icon: Building2 },
			{ href: "/superadmin/fleet", key: "fleet", icon: Radio },
			{ href: "/superadmin/incidents", key: "incidents", icon: OctagonAlert },
		],
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
