/**
 * Pure navigation guard for the edge proxy.
 *
 * Deliberately free of Next.js imports so the /login <-> /dashboard redirect
 * loop (ERR_TOO_MANY_REDIRECTS) can be pinned by unit tests without a request
 * scope.
 *
 * The check is optimistic on purpose: it only looks for the presence of a
 * Supabase auth cookie and never calls supabase.auth.getUser(). A network
 * user lookup in middleware rotates the single-use refresh token; under
 * Next.js parallel middleware invocations (document + RSC prefetches) two
 * refreshes race, Supabase revocation kicks in, and the session flips
 * present/null across alternating requests — an infinite redirect loop.
 * Authoritative validation lives in the server layer: getCurrentPondOwnerId()
 * and requireRole() call getUser() and redirect unauthenticated users to
 * /login.
 */

// Mirrors the @supabase/ssr cookie naming scheme: a base session cookie
// `sb-<project-ref>-auth-token` plus optional numbered chunks
// (`sb-<project-ref>-auth-token.0`, `.1`, ...) used when the session JSON
// exceeds the library's 3180-char chunk size.
const SUPABASE_SESSION_COOKIE = /^sb-.+-auth-token(\.\d+)?$/;

export interface RequestCookie {
	name: string;
	value: string;
}

export interface NavigationGuardInput {
	/** Pathname only, e.g. `/en/dashboard`. */
	pathname: string;
	/** HTTP method of the incoming request. */
	method: string;
	cookies: RequestCookie[];
}

/** True when any non-empty Supabase auth cookie is present. */
export function hasSupabaseSessionCookie(cookies: RequestCookie[]): boolean {
	return cookies.some(({ name, value }) => SUPABASE_SESSION_COOKIE.test(name) && value !== "");
}

/**
 * Routes that require a session. `/superadmin` needs its own check because
 * `includes("/admin")` is false for it (no separator before "admin").
 */
export function isProtectedPath(pathname: string): boolean {
	return (
		pathname.includes("/dashboard") ||
		pathname.includes("/admin") ||
		pathname.includes("/superadmin") ||
		pathname.includes("/change-password")
	);
}

/**
 * Redirect to /login only when a navigation request targets a protected route
 * without a session cookie.
 *
 * Two things this must never do, because both caused the redirect loop:
 *  - redirect `/login` when a session exists (the page decides that itself);
 *  - redirect non-GET/HEAD requests, which would break Server Action POSTs
 *    and surface as "An unexpected response was received from the server."
 */
export function shouldRedirectToLogin({
	pathname,
	method,
	cookies,
}: NavigationGuardInput): boolean {
	const isNavigationRequest = method === "GET" || method === "HEAD";
	return isNavigationRequest && isProtectedPath(pathname) && !hasSupabaseSessionCookie(cookies);
}
