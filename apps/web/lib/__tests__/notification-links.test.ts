import { describe, expect, it } from "vitest";

import { safeNotificationLink } from "@/lib/notifications/links";

describe("safeNotificationLink", () => {
	it("accepts dashboard paths", () => {
		expect(safeNotificationLink("/dashboard")).toBe("/dashboard");
		expect(safeNotificationLink("/dashboard/calendar")).toBe("/dashboard/calendar");
		expect(safeNotificationLink("/dashboard/settings?tab=hardware")).toBe(
			"/dashboard/settings?tab=hardware",
		);
		expect(safeNotificationLink("/dashboard/devices/device-1")).toBe("/dashboard/devices/device-1");
	});

	it("removes a legacy locale prefix so the Link adds the active one", () => {
		expect(safeNotificationLink("/en/dashboard/calendar")).toBe("/dashboard/calendar");
		expect(safeNotificationLink("/tl/dashboard/calendar")).toBe("/dashboard/calendar");
		expect(safeNotificationLink("/hil/dashboard")).toBe("/dashboard");
	});

	it("rejects external and protocol-relative destinations", () => {
		expect(safeNotificationLink("https://evil.example/dashboard")).toBeNull();
		expect(safeNotificationLink("//evil.example/dashboard")).toBeNull();
		expect(safeNotificationLink("/\\evil.example/dashboard")).toBeNull();
		expect(safeNotificationLink("javascript:alert(1)")).toBeNull();
	});

	it("rejects paths outside the allowlist and prefix lookalikes", () => {
		expect(safeNotificationLink("/admin")).toBeNull();
		expect(safeNotificationLink("/devices/dev-1")).toBeNull();
		expect(safeNotificationLink("/dashboardish")).toBeNull();
		expect(safeNotificationLink("/devices-archive")).toBeNull();
		expect(safeNotificationLink("/en//evil.example")).toBeNull();
	});

	it("rejects dot-segment escapes from an allowlisted prefix", () => {
		expect(safeNotificationLink("/dashboard/../admin")).toBeNull();
		expect(safeNotificationLink("/dashboard/%2e%2e/admin")).toBeNull();
		expect(safeNotificationLink("/dashboard/..%2fadmin")).toBeNull();
	});

	it("rejects blank, missing and control-character values", () => {
		expect(safeNotificationLink(null)).toBeNull();
		expect(safeNotificationLink(undefined)).toBeNull();
		expect(safeNotificationLink("")).toBeNull();
		expect(safeNotificationLink("   ")).toBeNull();
		expect(safeNotificationLink("dashboard/calendar")).toBeNull();
		expect(safeNotificationLink("/dashboard/\u0000calendar")).toBeNull();
	});
});
