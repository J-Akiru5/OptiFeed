import { createServerClient } from "@supabase/ssr";
import type { SetAllCookies } from "@supabase/ssr";
import createMiddleware from "next-intl/middleware";
import { type NextRequest, NextResponse } from "next/server";
import { routing } from "./i18n/routing";

const nextIntlMiddleware = createMiddleware(routing);

export default async function proxy(request: NextRequest) {
	const response = nextIntlMiddleware(request);

	const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
	const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

	if (!supabaseUrl || !supabaseAnonKey) {
		throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY");
	}

	const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
		cookies: {
			getAll() {
				return request.cookies.getAll();
			},
			setAll: ((cookiesToSet) => {
				for (const { name, value, options } of cookiesToSet) {
					request.cookies.set(name, value);
					response.cookies.set(name, value, options);
				}
			}) as SetAllCookies,
		},
	});

	// Refresh the session and get the current user (if any).
	const {
		data: { user },
	} = await supabase.auth.getUser();

	const pathname = request.nextUrl.pathname;
	const segments = pathname.split("/");
	const locale = routing.locales.includes(segments[1] as (typeof routing.locales)[number])
		? segments[1]
		: routing.defaultLocale;

	const isDashboard = pathname.includes("/dashboard");
	const isAdmin = pathname.includes("/admin");
	const isLogin = pathname.endsWith("/login");
	const isSignup = pathname.includes("/signup");

	// Only redirect navigation requests (GET/HEAD). Non-GET requests such as
	// Server Action POSTs must reach the route handler so their RSC /
	// x-action-redirect response is honored; a 302 here would surface as
	// "An unexpected response was received from the server."
	const isNavigationRequest = request.method === "GET" || request.method === "HEAD";

	// Unauthenticated users -> redirect to login
	if (isNavigationRequest && (isDashboard || isAdmin) && !user) {
		return NextResponse.redirect(new URL(`/${locale}/login`, request.url));
	}

	// Authenticated users on login page -> redirect to dashboard
	if (isNavigationRequest && isLogin && user) {
		return NextResponse.redirect(new URL(`/${locale}/dashboard`, request.url));
	}

	// Authenticated users on signup page who are NOT admin -> redirect to dashboard
	if (isNavigationRequest && isSignup && user) {
		// Check role via DB lookup — use the farmId from email
		const email = user.email;
		if (email) {
			const local = email.split("@")[0]?.toLowerCase();
			if (local) {
				// Import prisma is not allowed in middleware, so we use a lightweight check
				// We'll use a cookie-based approach instead: set a cookie on login with the role
				// For now, allow signup page access (admin check happens server-side in the page)
			}
		}
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
