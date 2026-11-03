import { shouldRedirectToLogin } from "@/lib/auth/navigation-guard";
import { loginRedirectLocation } from "@/lib/auth/return-to";
import createMiddleware from "next-intl/middleware";
import { type NextRequest, NextResponse } from "next/server";
import { routing } from "./i18n/routing";

const nextIntlMiddleware = createMiddleware(routing);

export default function proxy(request: NextRequest) {
	const response = nextIntlMiddleware(request);

	const pathname = request.nextUrl.pathname;
	const segments = pathname.split("/");
	const locale = routing.locales.includes(segments[1] as (typeof routing.locales)[number])
		? segments[1]
		: routing.defaultLocale;

	// No session cookie at all -> redirect to login. With a cookie present we
	// pass the request through: the page's getCurrentUser() validates the
	// session and redirects to /login if it is invalid or expired. The
	// login -> dashboard redirect is intentionally NOT done here — it needs a
	// *validated* user, which an optimistic cookie check cannot provide; the
	// login page itself performs a one-shot client-side skip instead.
	// See lib/auth/navigation-guard.ts for why this never calls getUser().
	if (
		shouldRedirectToLogin({
			pathname,
			method: request.method,
			cookies: request.cookies.getAll(),
		})
	) {
		// Carry the requested page (path and query) through the login round
		// trip so a shared notification, device or schedule link still lands
		// where it pointed after sign-in (#760). The helper validates the value;
		// the login action validates it again on the server.
		return NextResponse.redirect(
			new URL(
				loginRedirectLocation({
					locale,
					pathname,
					search: request.nextUrl.search,
					locales: routing.locales,
				}),
				request.url,
			),
		);
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
