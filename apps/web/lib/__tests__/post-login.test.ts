import { describe, expect, it } from "vitest";

import { sanitizePostLoginPath } from "@/lib/auth/post-login";

/**
 * The login deep link (#760) is user-controlled, so it must only ever produce
 * a same-origin path. These cases pin the open-redirect and loop rejections.
 */
describe("sanitizePostLoginPath", () => {
	it("keeps a path inside the app with its query", () => {
		expect(sanitizePostLoginPath("/dashboard/schedule?pond=1&tab=feeds")).toBe(
			"/dashboard/schedule?pond=1&tab=feeds",
		);
	});

	it("drops a fragment, which never reaches the server anyway", () => {
		expect(sanitizePostLoginPath("/dashboard#section")).toBe("/dashboard");
	});

	it("rejects absolute and protocol-relative URLs", () => {
		expect(sanitizePostLoginPath("https://evil.example/dashboard")).toBeNull();
		expect(sanitizePostLoginPath("//evil.example/dashboard")).toBeNull();
	});

	it("rejects backslashes, which some browsers treat as slashes", () => {
		expect(sanitizePostLoginPath("/\\evil.example/dashboard")).toBeNull();
		expect(sanitizePostLoginPath("\\\\evil.example/dashboard")).toBeNull();
	});

	it("rejects the login page itself to avoid a loop", () => {
		expect(sanitizePostLoginPath("/login")).toBeNull();
		expect(sanitizePostLoginPath("/login?next=/dashboard")).toBeNull();
	});

	it("rejects empty, relative and oversized values", () => {
		expect(sanitizePostLoginPath(undefined)).toBeNull();
		expect(sanitizePostLoginPath("")).toBeNull();
		expect(sanitizePostLoginPath("dashboard")).toBeNull();
		expect(sanitizePostLoginPath(`/${"a".repeat(2048)}`)).toBeNull();
	});

	it("does not decode an encoded host into an external origin", () => {
		expect(sanitizePostLoginPath("/%2F%2Fevil.example")).toBe("/%2F%2Fevil.example");
	});
});
