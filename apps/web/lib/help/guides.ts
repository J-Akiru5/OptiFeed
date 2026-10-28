import type { HelpRole, HelpSection } from "./types";
import { matchesRoute } from "./types";

/**
 * The help centre's content: one section per page area, per role.
 *
 * Copy lives in `messages/{en,hil}.json` under `help.sections.*` and
 * `help.items.*`; this file only points at the keys. Keep the words honest:
 * say what the screen actually does today, never promise a planned control,
 * and do not put a fact here that the page reads from the database (a count, a
 * date, a limit that can change).
 *
 * An item with a `target` must name a `data-help` attribute that exists in
 * `app/` or `components/`; the anchor test fails otherwise. When the control is
 * not on the section's first route, give the item its own `route`.
 */
export const HELP_SECTIONS: HelpSection[] = [
	{
		id: "dashboard",
		title: "sections.dashboard.title",
		intro: "sections.dashboard.intro",
		roles: ["farmer", "owner"],
		routes: ["/dashboard"],
		items: [
			{ text: "items.dashboard-feed-now", target: "feed-now" },
			{ text: "items.dashboard-next-feeding", target: "next-feeding" },
			{ text: "items.dashboard-fcr", target: "fcr" },
			{ text: "items.dashboard-ai-advisor", target: "ai-advisor" },
			{ text: "items.dashboard-hopper", target: "dashboard-hopper" },
			{ text: "items.dashboard-water-temp", target: "dashboard-water-temp" },
			{ text: "items.dashboard-export", target: "dashboard-export" },
			{ text: "items.dashboard-feed-log", target: "dashboard-feed-log" },
			{ text: "items.dashboard-biomass", target: "dashboard-biomass-log" },
		],
	},
	{
		id: "schedule",
		title: "sections.schedule.title",
		intro: "sections.schedule.intro",
		roles: ["farmer", "owner"],
		routes: ["/dashboard/schedule"],
		items: [
			{ text: "items.schedule-editor", target: "schedule-editor" },
			{ text: "items.schedule-save", target: "schedule-save" },
			{ text: "items.schedule-controls", target: "schedule-controls" },
			{ text: "items.schedule-clock", target: "schedule-calibration" },
			{ text: "items.schedule-pending" },
		],
	},
	{
		id: "biomass",
		title: "sections.biomass.title",
		intro: "sections.biomass.intro",
		roles: ["farmer", "owner"],
		routes: ["/dashboard/log-sample"],
		items: [
			{ text: "items.biomass-form", target: "biomass-form" },
			{ text: "items.biomass-sample-size" },
			{ text: "items.biomass-batches", target: "biomass-batches" },
		],
	},
	{
		id: "history",
		title: "sections.history.title",
		intro: "sections.history.intro",
		roles: ["farmer", "owner"],
		routes: ["/dashboard/history"],
		items: [
			{ text: "items.history-log", target: "history-event-log" },
			{ text: "items.history-charts", target: "history-charts" },
			{ text: "items.history-export", target: "export-data" },
			{ text: "items.history-import", target: "history-import" },
			{ text: "items.history-feed-level" },
		],
	},
	{
		id: "growth",
		title: "sections.growth.title",
		intro: "sections.growth.intro",
		roles: ["farmer", "owner"],
		routes: ["/dashboard/growth", "/dashboard/growth/history"],
		items: [
			{ text: "items.growth-charts", target: "growth-charts" },
			{ text: "items.growth-plan", target: "growth-plan" },
			{ text: "items.growth-fcr-calculator", target: "fcr-calculator" },
			{ text: "items.growth-history", target: "growth-history" },
		],
	},
	{
		id: "harvest",
		title: "sections.harvest.title",
		intro: "sections.harvest.intro",
		roles: ["farmer", "owner"],
		routes: ["/dashboard/calendar"],
		items: [
			{ text: "items.harvest-calendar", target: "harvest-calendar" },
			{ text: "items.harvest-add-event", target: "harvest-add-event" },
			{ text: "items.harvest-cycle", target: "harvest-cycle" },
		],
	},
	{
		id: "settings",
		title: "sections.settings.title",
		intro: "sections.settings.intro",
		roles: ["farmer", "owner"],
		routes: [
			"/dashboard/settings",
			"/dashboard/settings/pond",
			"/dashboard/settings/hardware",
			"/dashboard/settings/profile",
			"/dashboard/settings/data",
		],
		items: [
			{ text: "items.settings-cards", target: "settings-cards" },
			{ text: "items.settings-farm-name", target: "settings-farm-name" },
			{
				text: "items.settings-pond",
				target: "pond-settings-form",
				route: "/dashboard/settings/pond",
			},
			{
				text: "items.settings-calibration",
				target: "calibration-form",
				route: "/dashboard/settings/hardware",
			},
			{
				text: "items.settings-hopper",
				target: "hopper-calibration",
				route: "/dashboard/settings/hardware",
			},
			{
				text: "items.settings-recalibration",
				target: "recalibration-interval",
				route: "/dashboard/settings/hardware",
			},
			{
				text: "items.settings-password",
				target: "profile-password",
				route: "/dashboard/settings/profile",
			},
			{
				text: "items.settings-notifications",
				target: "notification-prefs",
				route: "/dashboard/settings/profile",
			},
			{
				text: "items.settings-data",
				target: "export-data",
				route: "/dashboard/settings/data",
			},
		],
	},
	{
		id: "admin.devices",
		title: "sections.admin-devices.title",
		intro: "sections.admin-devices.intro",
		roles: ["owner"],
		routes: ["/admin/devices"],
		items: [
			{ text: "items.admin-devices-list", target: "admin-devices-list" },
			{ text: "items.admin-devices-print", target: "print-label" },
			{ text: "items.admin-devices-token", target: "device-token" },
		],
	},
	{
		id: "admin.members",
		title: "sections.admin-members.title",
		intro: "sections.admin-members.intro",
		roles: ["owner"],
		routes: ["/admin/settings"],
		items: [
			{ text: "items.admin-members-invite", target: "admin-invite-member" },
			{ text: "items.admin-members-list", target: "admin-members-list" },
			{ text: "items.admin-members-permissions", target: "admin-permissions-link" },
			{ text: "items.admin-members-last-owner" },
		],
	},
	{
		id: "admin.settings",
		title: "sections.admin-settings.title",
		intro: "sections.admin-settings.intro",
		roles: ["owner"],
		routes: ["/admin/settings"],
		items: [
			{ text: "items.admin-settings-members", target: "admin-members-list" },
			{ text: "items.admin-settings-planned" },
		],
	},
	{
		id: "superadmin.users",
		title: "sections.superadmin-users.title",
		intro: "sections.superadmin-users.intro",
		roles: ["superadmin"],
		routes: ["/superadmin/users"],
		items: [
			{ text: "items.superadmin-search", target: "superadmin-search" },
			{ text: "items.superadmin-new-user", target: "superadmin-new-user" },
			{ text: "items.superadmin-user-actions", target: "superadmin-user-actions" },
			{ text: "items.superadmin-step-up" },
		],
	},
	{
		id: "superadmin.orgs",
		title: "sections.superadmin-orgs.title",
		intro: "sections.superadmin-orgs.intro",
		roles: ["superadmin"],
		routes: ["/superadmin/orgs"],
		items: [
			{ text: "items.superadmin-org-search", target: "superadmin-search" },
			{ text: "items.superadmin-create-org", target: "superadmin-create-org" },
			{ text: "items.superadmin-org-members", target: "superadmin-org-members" },
			{ text: "items.superadmin-view-as", target: "superadmin-view-as" },
		],
	},
	{
		id: "superadmin.ponds",
		title: "sections.superadmin-ponds.title",
		intro: "sections.superadmin-ponds.intro",
		roles: ["superadmin"],
		routes: ["/superadmin/ponds"],
		items: [
			{ text: "items.superadmin-pond-search", target: "superadmin-search" },
			{ text: "items.superadmin-ponds-read-only" },
		],
	},
	{
		id: "superadmin.devices",
		title: "sections.superadmin-devices.title",
		intro: "sections.superadmin-devices.intro",
		roles: ["superadmin"],
		routes: ["/superadmin/devices"],
		items: [
			{ text: "items.superadmin-register-device", target: "superadmin-register-device" },
			{ text: "items.superadmin-print-sticker", target: "superadmin-print-sticker" },
			{ text: "items.superadmin-rotate-token", target: "superadmin-rotate-token" },
			{ text: "items.superadmin-remote-feed", target: "superadmin-remote-feed" },
		],
	},
	{
		id: "superadmin.ai",
		title: "sections.superadmin-ai.title",
		intro: "sections.superadmin-ai.intro",
		roles: ["superadmin"],
		routes: ["/superadmin/ai-providers"],
		items: [
			{ text: "items.superadmin-ai-chain", target: "superadmin-ai-providers" },
			{ text: "items.superadmin-ai-reset" },
		],
	},
	{
		id: "superadmin.settings",
		title: "sections.superadmin-settings.title",
		intro: "sections.superadmin-settings.intro",
		roles: ["superadmin"],
		routes: ["/superadmin/settings"],
		items: [
			{ text: "items.superadmin-page-size", target: "superadmin-page-size" },
			{ text: "items.superadmin-audit" },
		],
	},
];

/** The longest route in a section that matches the path, or null. */
function matchedRoute(section: HelpSection, path: string): string | null {
	const matches = section.routes.filter((route) => matchesRoute(path, route));
	if (matches.length === 0) return null;
	return matches.reduce((longest, route) => (route.length > longest.length ? route : longest));
}

/**
 * The sections that are about the current page, most specific route first.
 *
 * A section's route also covers records under it (`/players/p-1`), and every
 * dashboard page sits under `/dashboard`. Without the specificity rule, the
 * dashboard section would be "current" on the hardware settings page too. Only
 * the section with the longest matching route wins; a tie (members and
 * organization settings both live at `/admin/settings`) keeps both.
 */
function sectionsAbout(role: HelpRole, path: string): HelpSection[] {
	const matched = HELP_SECTIONS.filter((section) => section.roles.includes(role))
		.map((section) => ({ section, route: matchedRoute(section, path) }))
		.filter((entry): entry is { section: HelpSection; route: string } => entry.route !== null);
	if (matched.length === 0) return [];
	const longest = matched.reduce(
		(best, entry) => (entry.route.length > best ? entry.route.length : best),
		0,
	);
	return matched.filter((entry) => entry.route.length === longest).map((entry) => entry.section);
}

/** The sections a role may see, current page first, the rest in contract order. */
export function sectionsFor(role: HelpRole, path: string): HelpSection[] {
	const visible = HELP_SECTIONS.filter((section) => section.roles.includes(role));
	const here = sectionsAbout(role, path);
	return [...here, ...visible.filter((section) => !here.includes(section))];
}

/** The sections that are about the current page, for the default-expanded set. */
export function currentSectionIds(role: HelpRole, path: string): string[] {
	return sectionsAbout(role, path).map((section) => section.id);
}

/** Every anchor any section points at, deduplicated. */
export function helpTargets(): string[] {
	const targets = HELP_SECTIONS.flatMap((section) =>
		section.items
			.map((item) => item.target)
			.filter((target): target is string => typeof target === "string"),
	);
	return [...new Set(targets)];
}

/** Every translation key any section uses, for the locale test. */
export function helpKeys(): string[] {
	const keys = HELP_SECTIONS.flatMap((section) => [
		section.title,
		section.intro,
		...section.items.map((item) => item.text),
	]);
	return [...new Set(keys)];
}
