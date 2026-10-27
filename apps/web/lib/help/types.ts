/**
 * The shape of the help centre: one section per page area, per role.
 *
 * Copy is stored as keys under the `help` namespace in `messages/{en,hil}.json`
 * rather than as literals, so the sheet speaks the reader's language and a
 * missing translation fails a test instead of shipping an English sentence on
 * a Hiligaynon screen.
 */

/** Who is reading the help. A section lists every role that may open it. */
export type HelpRole = "farmer" | "owner" | "superadmin";

/** One line of help, optionally pointing at the real control it describes. */
export interface HelpItem {
	/** Translation key under the `help` namespace, e.g. `items.dashboard-feed-now`. */
	text: string;
	/** The control's `data-help` anchor. Items without one are advice to read. */
	target?: string;
	/**
	 * The route that holds the target when it is not on the section's own page.
	 * "Show me" navigates there before drawing the ring.
	 */
	route?: string;
}

/** A collapsible section: what this screen is for, then how to use it. */
export interface HelpSection {
	/** Stable id, also the localStorage key suffix for the open/closed state. */
	id: string;
	/** Translation key under the `help` namespace. */
	title: string;
	/** One-sentence introduction shown under the title. Translation key. */
	intro: string;
	/** Roles that may see this section. */
	roles: HelpRole[];
	/** Pages this section is about. The first one is the section's "home". */
	routes: string[];
	items: HelpItem[];
}

/** True when a path is the route itself or a record under it, e.g. /superadmin/users/u-1. */
export function matchesRoute(path: string, route: string): boolean {
	if (route === "/") return path === "/";
	return path === route || path.startsWith(`${route}/`);
}

/** The route an item's target lives on: its own route, else the section's first. */
export function itemRoute(section: HelpSection, item: HelpItem): string | null {
	if (!item.target) return null;
	return item.route ?? section.routes[0] ?? null;
}
