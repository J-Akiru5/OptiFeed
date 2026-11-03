/**
 * Deep-link preservation for the login round trip (#760).
 *
 * The proxy sends an anonymous visitor from a protected page to `/login` with
 * the requested path in `next`. The login page and the server action both run
 * that value through `normalizeReturnPath` before using it, so the destination
 * can only ever be a path inside this app: an absolute URL, a protocol-relative
 * URL (`//evil.example`), a backslash trick, or a control character is dropped
 * and the caller falls back to the ordinary landing page.
 *
 * The helpers here are pure on purpose: the proxy, the client page and the
 * server action all share exactly one validation rule, and the rule can be
 * pinned without a request scope.
 */

/** Auth routes never become a post-login destination (that would loop). */
const AUTH_PATH = /^\/(?:login|forgot-password|reset-password|auth)(?:\/|$)/;

/**
 * Return `value` as a same-origin, locale-agnostic path such as
 * `/dashboard/devices/abc?tab=state`, or `null` when it is not safe.
 *
 * The locale segment is removed because `next-intl`'s `redirect({ href, locale })`
 * adds the current locale itself; passing `/en/dashboard` through unchanged
 * would produce `/en/en/dashboard`.
 */
export function normalizeReturnPath(
	value: string | null | undefined,
	locales: readonly string[],
): string | null {
	if (!value) return null;

	// Reject anything that is not an app-relative path before parsing: this is
	// the open-redirect boundary. `//host` and `/\host` are both treated as
	// network-path references by browsers.
	if (!value.startsWith("/") || value.startsWith("//")) return null;
	if (value.includes("\\")) return null;
	if (/[\u0000-\u001f\u007f]/.test(value)) return null;

	let url: URL;
	try {
		url = new URL(value, "https://optifeed.invalid");
	} catch {
		return null;
	}
	// A relative value cannot change the origin; keep the check explicit so a
	// future edit that accepts absolute URLs cannot silently pass.
	if (url.origin !== "https://optifeed.invalid") return null;

	let pathname = url.pathname;
	for (const locale of locales) {
		const prefix = `/${locale}`;
		if (pathname === prefix) {
			pathname = "/";
			break;
		}
		if (pathname.startsWith(`${prefix}/`)) {
			pathname = pathname.slice(prefix.length);
			break;
		}
	}

	if (AUTH_PATH.test(pathname)) return null;

	return `${pathname}${url.search}`;
}

/**
 * The proxy's `Location` for an anonymous protected request: `/en/login` plus a
 * validated `next` carrying the original path and query string.
 */
export function loginRedirectLocation(input: {
	locale: string;
	pathname: string;
	search?: string;
	locales: readonly string[];
}): string {
	const { locale, pathname, search = "" } = input;
	const target = `${pathname}${search}`;
	const base = `/${locale}/login`;

	// `pathname` comes from the request, but it is still validated: the proxy is
	// the only caller today and the same helper is unit-tested for the boundary.
	return normalizeReturnPath(target, input.locales)
		? `${base}?next=${encodeURIComponent(target)}`
		: base;
}
