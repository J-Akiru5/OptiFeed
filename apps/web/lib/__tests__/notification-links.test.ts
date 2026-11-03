import { safeNotificationLink } from "@/lib/notifications/links";
import { describe, expect, it } from "vitest";

/**
 * #746 — every producer stores a `linkTo`, but the inbox never read it. The
 * value is data, not code: only same-origin absolute paths may become a link.
 */
describe("safeNotificationLink", () => {
	it("keeps in-app paths with queries and fragments", () => {
		expect(safeNotificationLink("/dashboard/devices/dev-1")).toBe("/dashboard/devices/dev-1");
		expect(safeNotificationLink("/dashboard/settings/pond?tab=alerts")).toBe(
			"/dashboard/settings/pond?tab=alerts",
		);
	});

	it("trims whitespace", () => {
		expect(safeNotificationLink("  /dashboard/growth ")).toBe("/dashboard/growth");
	});

	it("rejects off-site, protocol-relative and script destinations", () => {
		expect(safeNotificationLink("https://evil.example")).toBeNull();
		expect(safeNotificationLink("//evil.example/path")).toBeNull();
		expect(safeNotificationLink("/\\evil.example/path")).toBeNull();
		expect(safeNotificationLink("javascript:alert(1)")).toBeNull();
		expect(safeNotificationLink("dashboard/growth")).toBeNull();
	});

	it("rejects control characters and non-strings", () => {
		expect(safeNotificationLink("/dashboard/\u0000evil")).toBeNull();
		expect(safeNotificationLink(null)).toBeNull();
		expect(safeNotificationLink(undefined)).toBeNull();
	});
});
