/**
 * Shapes shared by the global search server action and its dialog.
 *
 * Kept out of the `"use server"` module on purpose: a server-action file may
 * only export async functions, and the client needs these types as well.
 */

/** Which navigation surface the palette was opened from. */
export type SearchShell = "farmer" | "admin" | "platform";

/**
 * What the caller may read. Resolved on the server from the session, never
 * taken from the client: a farmer asking for `shell: "platform"` still gets
 * farmer results.
 */
export type SearchAudience = "farmer" | "tenantAdmin" | "platform";

export type SearchGroup = "pages" | "settings" | "ponds" | "devices" | "members" | "records";

/** Extra data a row needs to render its subtitle in the reader's locale. */
export type SearchRowMeta = {
	pondName?: string;
	mac?: string;
	email?: string;
	/** ISO timestamp; formatted by the dialog, not the server. */
	date?: string;
	grams?: number;
	status?: "archived" | "pending" | "unassigned";
};

export type SearchRow = {
	/** Stable key: `${group}:${id}`. */
	id: string;
	group: SearchGroup;
	/** Data rows carry their own title; catalogue rows carry a message key. */
	title: string;
	/** Fully-qualified next-intl key (for example `nav.dashboard`). */
	titleKey?: string;
	/** A second translated line (settings entries explain what the field does). */
	descriptionKey?: string;
	/** Extra search terms that are not part of the visible label. */
	keywords?: string[];
	subtitleKey?: string;
	href: string;
	meta?: SearchRowMeta;
	/** Settings rows: the `data-help` anchor to scroll to and ring. */
	settingTarget?: string;
	/** Settings rows: the locale-less route that holds the anchor. */
	settingRoute?: string;
	/**
	 * Farmer pond rows: the client calls the existing `switchPond` action so
	 * the active pond changes before the route renders.
	 */
	switchPondId?: string;
};

export type GlobalSearchResult = {
	status: "ok" | "unavailable";
	/** Every page this caller may open from this shell, already role-filtered. */
	pages: SearchRow[];
	/** Every settings field this caller may open, already role-filtered. */
	settings: SearchRow[];
	/** Data matches for the query (empty for an empty query). */
	rows: SearchRow[];
};
