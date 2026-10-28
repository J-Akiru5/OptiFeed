import type { Permission } from "@/lib/auth/permissions";
import type { SearchAudience, SearchRow, SearchShell } from "./types";

/**
 * The page half of global search (#270).
 *
 * Route knowledge already lives in the sidebars, the quick menu and the bottom
 * bars; there is no shared route-constant module to reuse, so this is the one
 * catalogue the palette searches. Every entry also names who may open it, and
 * the server filters on that before returning it: the dialog never has to
 * decide whether a page is allowed.
 *
 * `titleKey` points at labels that already exist where possible, so the page
 * name in search is the same word as in the navigation.
 */
export type SearchPage = {
	id: string;
	href: string;
	titleKey: string;
	/** Which nav surface the page belongs to, used to order suggestions. */
	shelf: SearchShell;
	audiences: readonly SearchAudience[];
	/** An extra grant the destination needs (member management, pond writes). */
	permission?: Permission;
	/** English aliases (for example "superadmin") that the label does not contain. */
	keywords?: readonly string[];
};

const FARMER_AUDIENCE = ["farmer", "tenantAdmin"] as const;

export const SEARCH_PAGES: readonly SearchPage[] = [
	// ─── Farmer (also open to every tenant admin) ────────────────────────────
	{
		id: "dashboard",
		href: "/dashboard",
		titleKey: "nav.dashboard",
		shelf: "farmer",
		audiences: FARMER_AUDIENCE,
	},
	{
		id: "schedule",
		href: "/dashboard/schedule",
		titleKey: "nav.schedule",
		shelf: "farmer",
		audiences: FARMER_AUDIENCE,
	},
	{
		id: "log-sample",
		href: "/dashboard/log-sample",
		titleKey: "nav.logSample",
		shelf: "farmer",
		audiences: FARMER_AUDIENCE,
	},
	{
		id: "sampling-batches",
		href: "/dashboard/log-sample/batches",
		titleKey: "dashboard.logSample.savedBatches",
		shelf: "farmer",
		audiences: FARMER_AUDIENCE,
	},
	{
		id: "history",
		href: "/dashboard/history",
		titleKey: "nav.history",
		shelf: "farmer",
		audiences: FARMER_AUDIENCE,
	},
	{
		id: "growth",
		href: "/dashboard/growth",
		titleKey: "nav.growth",
		shelf: "farmer",
		audiences: FARMER_AUDIENCE,
	},
	{
		id: "growth-history",
		href: "/dashboard/growth/history",
		titleKey: "dashboard.growth.history.title",
		shelf: "farmer",
		audiences: FARMER_AUDIENCE,
	},
	{
		id: "calendar",
		href: "/dashboard/calendar",
		titleKey: "nav.calendar",
		shelf: "farmer",
		audiences: FARMER_AUDIENCE,
	},
	{
		id: "notifications",
		href: "/dashboard/notifications",
		titleKey: "nav.notifications",
		shelf: "farmer",
		audiences: FARMER_AUDIENCE,
	},
	{
		id: "audit",
		href: "/dashboard/audit",
		titleKey: "nav.audit",
		shelf: "farmer",
		audiences: FARMER_AUDIENCE,
	},
	{
		id: "settings",
		href: "/dashboard/settings",
		titleKey: "nav.settings",
		shelf: "farmer",
		audiences: FARMER_AUDIENCE,
	},
	{
		id: "settings-pond",
		href: "/dashboard/settings/pond",
		titleKey: "dashboard.settings.pondTitle",
		shelf: "farmer",
		audiences: FARMER_AUDIENCE,
	},
	{
		id: "settings-hardware",
		href: "/dashboard/settings/hardware",
		titleKey: "dashboard.settings.hardwareCardTitle",
		shelf: "farmer",
		audiences: FARMER_AUDIENCE,
		keywords: ["feeder", "device", "hopper", "calibration"],
	},
	{
		id: "settings-profile",
		href: "/dashboard/settings/profile",
		titleKey: "dashboard.settings.profileCardTitle",
		shelf: "farmer",
		audiences: FARMER_AUDIENCE,
	},
	{
		id: "settings-data",
		href: "/dashboard/settings/data",
		titleKey: "dashboard.settings.dataCardTitle",
		shelf: "farmer",
		audiences: FARMER_AUDIENCE,
		keywords: ["export", "import", "backup", "csv"],
	},

	// ─── Tenant admin console ────────────────────────────────────────────────
	{
		id: "admin-overview",
		href: "/admin",
		titleKey: "dashboard.adminShell.nav.overview",
		shelf: "admin",
		audiences: ["tenantAdmin"],
		keywords: ["admin", "console", "overview"],
	},
	{
		id: "admin-calendar",
		href: "/admin/calendar",
		titleKey: "dashboard.adminShell.nav.calendar",
		shelf: "admin",
		audiences: ["tenantAdmin"],
	},
	{
		id: "admin-users",
		href: "/admin/users",
		titleKey: "dashboard.adminShell.nav.users",
		shelf: "admin",
		audiences: ["tenantAdmin"],
	},
	{
		id: "admin-members",
		href: "/admin/settings",
		titleKey: "search.pages.members",
		shelf: "admin",
		audiences: ["tenantAdmin"],
		permission: "manage_members",
		keywords: ["permissions", "team", "invite", "roles"],
	},
	{
		id: "admin-ponds",
		href: "/admin/ponds",
		titleKey: "dashboard.adminShell.nav.ponds",
		shelf: "admin",
		audiences: ["tenantAdmin"],
	},
	{
		id: "admin-add-pond",
		href: "/admin/ponds/new",
		titleKey: "dashboard.mobile.actions.addPond",
		shelf: "admin",
		audiences: ["tenantAdmin"],
		permission: "manage_farms_ponds",
	},
	{
		id: "admin-devices",
		href: "/admin/devices",
		titleKey: "dashboard.adminShell.nav.devices",
		shelf: "admin",
		audiences: ["tenantAdmin"],
		keywords: ["feeder", "hardware", "mac"],
	},
	{
		id: "admin-hierarchy",
		href: "/admin/hierarchy",
		titleKey: "dashboard.adminShell.nav.hierarchy",
		shelf: "admin",
		audiences: ["tenantAdmin"],
	},
	{
		id: "admin-audit",
		href: "/admin/audit",
		titleKey: "dashboard.adminShell.nav.audit",
		shelf: "admin",
		audiences: ["tenantAdmin"],
	},
	{
		id: "admin-settings",
		href: "/admin/settings",
		titleKey: "dashboard.adminShell.nav.settings",
		shelf: "admin",
		audiences: ["tenantAdmin"],
	},

	// ─── Platform console ────────────────────────────────────────────────────
	{
		id: "platform-overview",
		href: "/superadmin",
		titleKey: "superadmin.shell.console",
		shelf: "platform",
		audiences: ["platform"],
		keywords: ["superadmin", "platform", "console", "overview"],
	},
	{
		id: "platform-calendar",
		href: "/superadmin/calendar",
		titleKey: "superadmin.shell.nav.calendar",
		shelf: "platform",
		audiences: ["platform"],
	},
	{
		id: "platform-users",
		href: "/superadmin/users",
		titleKey: "superadmin.shell.nav.users",
		shelf: "platform",
		audiences: ["platform"],
	},
	{
		id: "platform-create-user",
		href: "/superadmin/users/create",
		titleKey: "search.pages.createUser",
		shelf: "platform",
		audiences: ["platform"],
		keywords: ["invite", "new user", "account"],
	},
	{
		id: "platform-orgs",
		href: "/superadmin/orgs",
		titleKey: "superadmin.shell.nav.organizations",
		shelf: "platform",
		audiences: ["platform"],
	},
	{
		id: "platform-ponds",
		href: "/superadmin/ponds",
		titleKey: "superadmin.shell.nav.ponds",
		shelf: "platform",
		audiences: ["platform"],
	},
	{
		id: "platform-devices",
		href: "/superadmin/devices",
		titleKey: "superadmin.shell.nav.devices",
		shelf: "platform",
		audiences: ["platform"],
	},
	{
		id: "platform-operations",
		href: "/superadmin/operations",
		titleKey: "superadmin.shell.nav.operations",
		shelf: "platform",
		audiences: ["platform"],
		keywords: ["health", "jobs", "audit", "announcements", "errors"],
	},
	{
		id: "platform-announcements",
		href: "/superadmin/operations/announcements",
		titleKey: "superadmin.operations.tabs.announcements",
		shelf: "platform",
		audiences: ["platform"],
	},
	{
		id: "platform-operations-audit",
		href: "/superadmin/operations/audit",
		titleKey: "superadmin.operations.tabs.audit",
		shelf: "platform",
		audiences: ["platform"],
	},
	{
		id: "platform-firmware",
		href: "/superadmin/operations/firmware",
		titleKey: "superadmin.operations.tabs.firmware",
		shelf: "platform",
		audiences: ["platform"],
		keywords: ["ota", "update", "fleet"],
	},
	{
		id: "platform-ai",
		href: "/superadmin/ai-providers",
		titleKey: "superadmin.shell.nav.aiProviders",
		shelf: "platform",
		audiences: ["platform"],
		keywords: ["ai", "model", "provider"],
	},
	{
		id: "platform-settings",
		href: "/superadmin/settings",
		titleKey: "superadmin.shell.nav.settings",
		shelf: "platform",
		audiences: ["platform"],
		keywords: ["configuration", "config", "page size"],
	},
];

/**
 * The pages a caller may open, ordered for the shell they are in.
 *
 * Fails closed: an audience with no matching entry gets no page, and a
 * permission-gated entry disappears when the grant is absent.
 */
export function pagesFor(
	audience: SearchAudience,
	permissions: ReadonlySet<Permission>,
	shell: SearchShell,
): SearchRow[] {
	return SEARCH_PAGES.filter(
		(page) =>
			page.audiences.includes(audience) && (!page.permission || permissions.has(page.permission)),
	)
		.sort((left, right) => {
			const leftRank = left.shelf === shell ? 0 : 1;
			const rightRank = right.shelf === shell ? 0 : 1;
			if (leftRank !== rightRank) return leftRank - rightRank;
			return 0;
		})
		.map((page) => ({
			id: `pages:${page.id}`,
			group: "pages" as const,
			title: "",
			titleKey: page.titleKey,
			href: page.href,
			...(page.keywords ? { keywords: [...page.keywords] } : {}),
		}));
}
