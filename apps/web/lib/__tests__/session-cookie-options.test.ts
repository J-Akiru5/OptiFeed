import { describe, expect, it } from "vitest";

import {
	SESSION_COOKIE_MAX_AGE_SECONDS,
	sessionCookieOptions,
} from "@/lib/supabase/cookie-options";

/**
 * Session cookies (#717): the library default is 400 days with no Secure flag.
 * These assertions pin the hardened values and the deliberate absence of
 * HttpOnly until the browser client stops owning session refresh/Realtime.
 */
describe("sessionCookieOptions", () => {
	it("sets Secure in production and a 30-day lifetime", () => {
		const options = sessionCookieOptions(true);

		expect(options).toMatchObject({
			path: "/",
			sameSite: "lax",
			secure: true,
			maxAge: SESSION_COOKIE_MAX_AGE_SECONDS,
		});
		expect(SESSION_COOKIE_MAX_AGE_SECONDS).toBe(60 * 60 * 24 * 30);
	});

	it("does not set Secure on a local http dev server", () => {
		expect(sessionCookieOptions(false).secure).toBe(false);
	});

	it("leaves HttpOnly unset while the browser client reads the cookie", () => {
		// This is a documented limitation, not an oversight: setting it now would
		// break Realtime and client-side sign-out. Assert it explicitly so a
		// future change has to update this test and the comment in the module.
		expect(sessionCookieOptions(true).httpOnly).toBeUndefined();
	});
});
