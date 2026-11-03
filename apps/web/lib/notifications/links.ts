/**
 * Notification deep links (#746).
 *
 * `Notification.linkTo` is written by many producers and can also arrive from
 * an imported data file, so it is untrusted input. The allowlist only offers
 * paths this app actually serves, and a path is returned without the locale
 * prefix because the `@/i18n/routing` `Link` adds the active locale.
 */

/**
 * Top-level app areas a notification may open. Keep this list short: a link is
 * helpful only when it lands on a dashboard surface the reader can access.
 */
const ALLOWED_PREFIXES = ["/dashboard"] as const;

const LOCALE_PREFIX = /^\/(?:en|hil|tl)(?=\/|$)/;

function hasControlCharacter(value: string): boolean {
	for (const character of value) {
		const code = character.codePointAt(0) ?? 0;
		if (code < 0x20 || code === 0x7f) return true;
	}
	return false;
}

/**
 * Return a safe, locale-free internal path for `linkTo`, or `null`.
 *
 * Rejected values include absolute URLs, protocol-relative URLs (`//host`),
 * backslash tricks (`/\host`), control characters, and paths outside the
 * allowlist. Legacy rows may still carry a `/en/dashboard/...` prefix from
 * before migration 20261014000000; that prefix is removed rather than
 * rejected, so the same row becomes locale-aware instead of dead.
 */
export function safeNotificationLink(linkTo: string | null | undefined): string | null {
	if (typeof linkTo !== "string") return null;

	const trimmed = linkTo.trim();
	if (!trimmed.startsWith("/")) return null;
	if (trimmed.startsWith("//") || trimmed.includes("\\")) return null;
	if (hasControlCharacter(trimmed)) return null;

	const path = trimmed.replace(LOCALE_PREFIX, "");
	if (!path.startsWith("/")) return null;

	const pathname = path.split(/[?#]/, 1)[0] ?? "";
	// Dot segments and percent-encoding would let the browser normalise a path
	// such as `/dashboard/../admin` outside the allowlist.
	if (/(^|\/)\.{1,2}($|\/)/.test(pathname) || pathname.includes("%")) return null;
	const allowed = ALLOWED_PREFIXES.some(
		(prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
	);
	return allowed ? path : null;
}
