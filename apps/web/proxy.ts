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
	const isLogin = pathname.endsWith("/login");

	// Only redirect navigation requests (GET/HEAD). Non-GET requests such as
	// Server Action POSTs must reach the route handler so their RSC /
	// x-action-redirect response is honored; a 302 here would surface as
	// "An unexpected response was received from the server."
	const isNavigationRequest = request.method === "GET" || request.method === "HEAD";

	if (isNavigationRequest && isDashboard && !user) {
		return NextResponse.redirect(new URL(`/${locale}/login`, request.url));
	}

	if (isNavigationRequest && isLogin && user) {
		return NextResponse.redirect(new URL(`/${locale}/dashboard`, request.url));
	}

	return response;
}

export const config = {
	// Matches all pages but excludes API routes (device endpoints use their own auth)
	// and static assets.
	matcher: ["/((?!api|_next|_vercel|.*\\..*).*)"],
};
