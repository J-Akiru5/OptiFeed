import { pageTitleKey } from "@/components/mobile/use-page-title";

/**
 * How wide the operator's reach is on the page they are looking at (plan
 * M3C.1, decision T25): the whole platform, one section of it, one
 * organization, or one resource inside an organization such as a feeder.
 */
export type ScopeLevel = "global" | "section" | "organization" | "resource";

export type ScopeCrumb = { level: ScopeLevel; label: string };

export type ScopeLabels = {
	global: string;
	/** Label for a console section key, such as `organizations`. */
	section: (key: string) => string;
};

/**
 * The scope path for a console page that has no record of its own: the global
 * crumb, then the section the URL belongs to. The overview is the global scope
 * itself, so it gets no second crumb.
 */
export function consoleScopeCrumbs(pathname: string, labels: ScopeLabels): ScopeCrumb[] {
	const crumbs: ScopeCrumb[] = [{ level: "global", label: labels.global }];
	const key = pageTitleKey("platform", pathname);
	if (key && key !== "overview") crumbs.push({ level: "section", label: labels.section(key) });
	return crumbs;
}

/**
 * True for a page that names a record in its URL (`/superadmin/orgs/<id>`).
 * Only that page knows the record's name, so it renders its own banner and the
 * layout's banner stays out of the way instead of showing a second, vaguer one.
 */
export function pageOwnsScope(pathname: string): boolean {
	return /^\/superadmin\/orgs\/[^/]+/.test(pathname);
}
