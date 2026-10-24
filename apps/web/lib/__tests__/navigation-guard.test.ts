import {
	hasSupabaseSessionCookie,
	isProtectedPath,
	shouldRedirectToLogin,
} from "@/lib/auth/navigation-guard";
import { describe, expect, it } from "vitest";

const SESSION_COOKIE = "sb-xjjnkikgkraixlfhhvoh-auth-token";

function session(value = "base64-eyJhY2Nlc3NfdG9rZW4iOiJ4In0") {
	return [{ name: SESSION_COOKIE, value }];
}

describe("shouldRedirectToLogin", () => {
	it("redirects an anonymous navigation to a dashboard route", () => {
		expect(shouldRedirectToLogin({ pathname: "/en/dashboard", method: "GET", cookies: [] })).toBe(
			true,
		);
	});

	it("passes a dashboard request through when a session cookie is present", () => {
		expect(
			shouldRedirectToLogin({ pathname: "/en/dashboard", method: "GET", cookies: session() }),
		).toBe(false);
	});

	it("never redirects /login, even with a session cookie", () => {
		expect(
			shouldRedirectToLogin({ pathname: "/en/login", method: "GET", cookies: session() }),
		).toBe(false);
		expect(shouldRedirectToLogin({ pathname: "/en/login", method: "GET", cookies: [] })).toBe(
			false,
		);
	});

	it("recognises chunked session cookies", () => {
		const chunked = [{ name: `${SESSION_COOKIE}.0`, value: "chunk" }];
		expect(
			shouldRedirectToLogin({ pathname: "/en/dashboard", method: "GET", cookies: chunked }),
		).toBe(false);
	});

	it("treats an empty cookie value as no session", () => {
		expect(
			shouldRedirectToLogin({ pathname: "/en/dashboard", method: "GET", cookies: session("") }),
		).toBe(true);
	});

	it("never redirects Server Action POSTs", () => {
		expect(shouldRedirectToLogin({ pathname: "/en/dashboard", method: "POST", cookies: [] })).toBe(
			false,
		);
	});

	it("guards admin and superadmin routes", () => {
		expect(shouldRedirectToLogin({ pathname: "/en/admin/users", method: "GET", cookies: [] })).toBe(
			true,
		);
		expect(
			shouldRedirectToLogin({ pathname: "/en/superadmin/tenants", method: "GET", cookies: [] }),
		).toBe(true);
	});

	it("leaves public routes alone", () => {
		expect(shouldRedirectToLogin({ pathname: "/en", method: "GET", cookies: [] })).toBe(false);
		expect(shouldRedirectToLogin({ pathname: "/hil", method: "GET", cookies: [] })).toBe(false);
	});
});

describe("hasSupabaseSessionCookie", () => {
	it("ignores unrelated cookies", () => {
		expect(hasSupabaseSessionCookie([{ name: "theme", value: "dark" }])).toBe(false);
	});

	it("accepts the base cookie", () => {
		expect(hasSupabaseSessionCookie(session())).toBe(true);
	});
});

describe("isProtectedPath", () => {
	it("matches the protected segments", () => {
		expect(isProtectedPath("/en/dashboard/history")).toBe(true);
		expect(isProtectedPath("/en/admin/ponds")).toBe(true);
		expect(isProtectedPath("/en/superadmin")).toBe(true);
		expect(isProtectedPath("/en/login")).toBe(false);
	});
});
