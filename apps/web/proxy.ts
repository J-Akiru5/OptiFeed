import createMiddleware from "next-intl/middleware";
import { type NextRequest, NextResponse } from "next/server";
import { routing } from "./i18n/routing";

const nextIntlMiddleware = createMiddleware(routing);

// Mirrors the @supabase/ssr cookie naming scheme: a base session cookie
// `sb-<project-ref>-auth-token` plus optional numbered chunks
// (`sb-<project-ref>-auth-token.0`, `.1`, ...) used when the session JSON
// exceeds the library's 3180-char chunk size.
const SUPABASE_SESSION_COOKIE = /^sb-.+-auth-token(\.\d+)?$/;

/**
 * Optimistic session check: true when any non-empty Supabase auth cookie is
 * present. Deliberately does NOT call supabase.auth.getUser() — that makes a
 * network request and can rotate the single-use refresh token. Under Next.js
 * parallel middleware invocations (document + RSC prefetches), concurrent
 * refreshes race, Supabase reuse-detection revokes the session, and the user
 * flips present/null across alternating requests — an infinite
 * /login <-> /dashboard redirect loop (ERR_TOO_MANY_REDIRECTS). Authoritative
 * validation lives in the server layer: getCurrentPondOwnerId() and
 * requireRole() call getUser() and redirect unauthenticated users to /login.
 */
function hasSessionCookie(request: NextRequest): boolean {
	return request.cookies
		.getAll()
		.some(({ name, value }) => SUPABASE_SESSION_COOKIE.test(name) && value !== "");
}

export default function proxy(request: NextRequest) {
	const response = nextIntlMiddleware(request);

	const pathname = request.nextUrl.pathname;
	const segments = pathname.split("/");
	const locale = routing.locales.includes(segments[1] as (typeof routing.locales)[number])
		? segments[1]
		: routing.defaultLocale;

	const isDashboard = pathname.includes("/dashboard");
	const isAdmin = pathname.includes("/admin");

	// Only redirect navigation requests (GET/HEAD). Non-GET requests such as
	// Server Action POSTs must reach the route handler so their RSC /
	// x-action-redirect response is honored; a 302 here would surface as
	// "An unexpected response was received from the server."
	const isNavigationRequest = request.method === "GET" || request.method === "HEAD";

	// No session cookie at all -> redirect to login. With a cookie present we
	// pass the request through: the page's getCurrentUser() validates the
	// session and redirects to /login if it is invalid or expired. The
	// login -> dashboard redirect is intentionally NOT done here — it needs a
	// *validated* user, which an optimistic cookie check cannot provide; the
	// login page itself performs a one-shot client-side skip instead.
	if (isNavigationRequest && (isDashboard || isAdmin) && !hasSessionCookie(request)) {
		return NextResponse.redirect(new URL(`/${locale}/login`, request.url));
	}

	return response;
}

export const config = {
	// Middleware matcher excludes all /api/* routes — auth for API routes is
	// enforced at the route level via @/lib/auth/with-auth or inline session
	// checks. This is a deliberate tradeoff: middleware auth is "impossible to
	// forget" but middleware cannot access cookies/headers in the same way as
	// route handlers in Next.js 16. The CI step "Check API route auth" ensures
	// every new API route imports from @/lib/auth/session or @/lib/auth/with-auth.
	matcher: ["/((?!api|_next|_vercel|.*\\..*).*)"],
};
