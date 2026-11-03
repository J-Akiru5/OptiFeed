import type { CookieOptionsWithName } from "@supabase/ssr";

/**
 * Session-cookie options shared by the server and browser Supabase clients
 * (#717).
 *
 * `@supabase/ssr` defaults to a 400-day `maxAge` and leaves `secure` unset.
 * Both are wrong for a session credential: the cookie outlives any reasonable
 * device lifetime, and without `Secure` a downgraded request can carry it.
 * Thirty days keeps a farm phone/tablet signed in across a normal season break
 * while bounding how long a stolen cookie survives.
 *
 * `httpOnly` is deliberately NOT set. The browser client owns session refresh
 * and the Supabase Realtime subscription, and it reads `document.cookie`; an
 * HttpOnly cookie would be invisible to it, so Realtime and client sign-out
 * would silently stop working. Making the session HttpOnly requires moving
 * those flows to server actions first - tracked as the remaining half of #717.
 * Setting `httpOnly: false` here would only restate the library default, so the
 * option is left absent rather than advertised.
 */
export const SESSION_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

export function sessionCookieOptions(production: boolean): CookieOptionsWithName {
	return {
		path: "/",
		sameSite: "lax",
		secure: production,
		maxAge: SESSION_COOKIE_MAX_AGE_SECONDS,
	};
}
