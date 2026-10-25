/**
 * Routes that render their own contextual "Back to ..." link to a closer
 * parent. The dashboard layout's global "Dashboard" back link is suppressed
 * there so the page does not show two back buttons (#147).
 */
export const CONTEXTUAL_BACK_PREFIXES = [
	"/dashboard/log-sample/batches",
	"/dashboard/growth/history",
] as const;

export function shouldShowGlobalBackLink(pathname: string | null): boolean {
	if (!pathname || pathname === "/dashboard") return false;
	return !CONTEXTUAL_BACK_PREFIXES.some(
		(prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
	);
}
