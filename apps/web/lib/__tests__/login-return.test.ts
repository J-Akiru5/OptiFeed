import { choosePostLoginPath } from "@/lib/auth/post-login";
import { loginRedirectLocation, normalizeReturnPath } from "@/lib/auth/return-to";
import { describe, expect, it, vi } from "vitest";

// `post-login` imports the Prisma singleton for the database-backed landing
// lookup; these tests only exercise the pure path chooser.
vi.mock("@/lib/prisma", () => ({ default: {} }));

/**
 * Deep-link preservation (#760).
 *
 * The proxy redirect that protects a page and the post-login return use the
 * same two pure rules: carry the requested path, and only ever return to a
 * path on this origin. These tests pin the boundary that keeps an attacker
 * from turning `?next=` into an open redirect.
 */

const LOCALES = ["en", "hil", "tl"] as const;

describe("loginRedirectLocation (#760)", () => {
	it("carries the requested protected path and query through the proxy", () => {
		expect(
			loginRedirectLocation({
				locale: "en",
				pathname: "/en/dashboard/devices/abc",
				search: "?tab=state&page=2",
				locales: LOCALES,
			}),
		).toBe(`/en/login?next=${encodeURIComponent("/en/dashboard/devices/abc?tab=state&page=2")}`);
	});

	it("keeps the current locale prefix on the login page", () => {
		expect(
			loginRedirectLocation({
				locale: "hil",
				pathname: "/hil/admin/users",
				locales: LOCALES,
			}),
		).toBe(`/hil/login?next=${encodeURIComponent("/hil/admin/users")}`);
	});

	it("omits next when the requested path is not safe", () => {
		expect(
			loginRedirectLocation({
				locale: "en",
				pathname: "//evil.example/steal",
				locales: LOCALES,
			}),
		).toBe("/en/login");
	});
});

describe("normalizeReturnPath (#760)", () => {
	it("accepts same-origin app paths and strips the locale segment", () => {
		expect(normalizeReturnPath("/en/dashboard", LOCALES)).toBe("/dashboard");
		expect(normalizeReturnPath("/hil/dashboard/schedule?day=2", LOCALES)).toBe(
			"/dashboard/schedule?day=2",
		);
		expect(normalizeReturnPath("/dashboard/devices/abc", LOCALES)).toBe("/dashboard/devices/abc");
		expect(normalizeReturnPath("/en", LOCALES)).toBe("/");
	});

	it("rejects absolute and protocol-relative URLs", () => {
		expect(normalizeReturnPath("https://evil.example/steal", LOCALES)).toBeNull();
		expect(normalizeReturnPath("http://evil.example", LOCALES)).toBeNull();
		expect(normalizeReturnPath("//evil.example/steal", LOCALES)).toBeNull();
		expect(normalizeReturnPath("/\\evil.example/steal", LOCALES)).toBeNull();
		expect(normalizeReturnPath("javascript:alert(1)", LOCALES)).toBeNull();
	});

	it("rejects control characters and empty values", () => {
		expect(normalizeReturnPath("", LOCALES)).toBeNull();
		expect(normalizeReturnPath(null, LOCALES)).toBeNull();
		expect(
			normalizeReturnPath("/en/dashboard\nLocation: https://evil.example", LOCALES),
		).toBeNull();
	});

	it("does not loop back into the auth flow", () => {
		expect(normalizeReturnPath("/en/login", LOCALES)).toBeNull();
		expect(normalizeReturnPath("/en/forgot-password", LOCALES)).toBeNull();
		expect(normalizeReturnPath("/en/reset-password?reset=x", LOCALES)).toBeNull();
		expect(normalizeReturnPath("/en/auth/confirm", LOCALES)).toBeNull();
	});

	it("leaves paths that only look like a locale alone", () => {
		expect(normalizeReturnPath("/english-team", LOCALES)).toBe("/english-team");
	});
});

describe("choosePostLoginPath (#760)", () => {
	it("returns the requested page when there is no password gate", () => {
		expect(choosePostLoginPath("/dashboard", "/dashboard/devices/abc")).toBe(
			"/dashboard/devices/abc",
		);
		expect(choosePostLoginPath("/superadmin", "/superadmin/tenants")).toBe("/superadmin/tenants");
	});

	it("never lets a deep link skip the temporary-password change", () => {
		expect(choosePostLoginPath("/change-password", "/dashboard/schedule")).toBe("/change-password");
	});

	it("falls back to the role landing page when nothing was requested", () => {
		expect(choosePostLoginPath("/superadmin", null)).toBe("/superadmin");
	});
});
