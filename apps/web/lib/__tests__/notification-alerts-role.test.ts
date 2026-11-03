import { canManagePondAlerts } from "@/lib/auth/notification-alerts";
import { describe, expect, it } from "vitest";

/**
 * #748 — `Pond.notificationPrefs` is one shared row, so an OPERATOR or VIEWER
 * must not be able to change it for the whole pond.
 */
describe("canManagePondAlerts", () => {
	const base = {
		isPondOwner: false,
		activeMembershipRoles: [] as const,
		hasAnyMembership: false,
		legacyRole: "OPERATOR" as const,
	};

	it("allows the pond owner even without an admin membership", () => {
		expect(canManagePondAlerts({ ...base, isPondOwner: true })).toBe(true);
	});

	it("allows an active OWNER or ADMIN membership", () => {
		expect(
			canManagePondAlerts({ ...base, activeMembershipRoles: ["OWNER"], hasAnyMembership: true }),
		).toBe(true);
		expect(
			canManagePondAlerts({ ...base, activeMembershipRoles: ["ADMIN"], hasAnyMembership: true }),
		).toBe(true);
	});

	it("denies OPERATOR and VIEWER memberships", () => {
		expect(
			canManagePondAlerts({
				...base,
				activeMembershipRoles: ["OPERATOR"],
				hasAnyMembership: true,
				legacyRole: "ADMIN",
			}),
		).toBe(false);
		expect(
			canManagePondAlerts({
				...base,
				activeMembershipRoles: ["VIEWER"],
				hasAnyMembership: true,
				legacyRole: "ADMIN",
			}),
		).toBe(false);
	});

	it("does not fall back to a stale legacy role after memberships were revoked", () => {
		expect(canManagePondAlerts({ ...base, hasAnyMembership: true, legacyRole: "ADMIN" })).toBe(
			false,
		);
	});

	it("falls back to the legacy ADMIN flag only with no membership row at all", () => {
		expect(canManagePondAlerts({ ...base, legacyRole: "ADMIN" })).toBe(true);
		expect(canManagePondAlerts({ ...base, legacyRole: "OPERATOR" })).toBe(false);
	});
});
