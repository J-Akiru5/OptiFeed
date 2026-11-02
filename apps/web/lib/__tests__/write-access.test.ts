import {
	legacyRoleAllowsWrite,
	membershipAllowsWrite,
	resolveWriteAuthority,
} from "@/lib/auth/write-access";
import { describe, expect, it } from "vitest";

/**
 * #583: the write gate must read the membership, not the legacy `User.role`
 * column. These are the pure rules; `tenant-write-gate.test.ts` proves the
 * `requireWriteAccess()` / `canWrite()` pair uses them.
 */

describe("membershipAllowsWrite", () => {
	it("allows the three writing roles", () => {
		expect(membershipAllowsWrite("OWNER")).toBe(true);
		expect(membershipAllowsWrite("ADMIN")).toBe(true);
		expect(membershipAllowsWrite("OPERATOR")).toBe(true);
	});

	it("makes VIEWER read-only", () => {
		expect(membershipAllowsWrite("VIEWER")).toBe(false);
	});
});

describe("legacyRoleAllowsWrite", () => {
	it("keeps the pre-membership roles that could write", () => {
		expect(legacyRoleAllowsWrite("ADMIN")).toBe(true);
		expect(legacyRoleAllowsWrite("OPERATOR")).toBe(true);
	});

	it("refuses VIEWER", () => {
		expect(legacyRoleAllowsWrite("VIEWER")).toBe(false);
	});
});

describe("resolveWriteAuthority", () => {
	it("denies a demoted VIEWER whose legacy role is still OPERATOR (#583)", () => {
		// The whole bug: demotion updates Membership.role and leaves User.role.
		expect(
			resolveWriteAuthority({
				legacyRole: "OPERATOR",
				activeMembershipRoles: ["VIEWER"],
				hasAnyMembership: true,
			}),
		).toEqual({ allowed: false, source: "membership" });
	});

	it("allows an OPERATOR membership even when the legacy role says VIEWER", () => {
		expect(
			resolveWriteAuthority({
				legacyRole: "VIEWER",
				activeMembershipRoles: ["OPERATOR"],
				hasAnyMembership: true,
			}),
		).toEqual({ allowed: true, source: "membership" });
	});

	it("uses the strongest active membership when an account belongs to several orgs", () => {
		expect(
			resolveWriteAuthority({
				legacyRole: "VIEWER",
				activeMembershipRoles: ["VIEWER", "ADMIN"],
				hasAnyMembership: true,
			}),
		).toEqual({ allowed: true, source: "membership" });
	});

	it("denies when every membership is revoked, even for a legacy ADMIN", () => {
		expect(
			resolveWriteAuthority({
				legacyRole: "ADMIN",
				activeMembershipRoles: [],
				hasAnyMembership: true,
			}),
		).toEqual({ allowed: false, source: "none" });
	});

	it("denies a membership in a suspended org instead of falling back", () => {
		// `session.ts` filters non-ACTIVE orgs out before calling this, so the list
		// is empty while a row still exists.
		expect(
			resolveWriteAuthority({
				legacyRole: "OPERATOR",
				activeMembershipRoles: [],
				hasAnyMembership: true,
			}),
		).toEqual({ allowed: false, source: "none" });
	});

	it("falls back to the legacy flag only when no membership row exists at all", () => {
		expect(
			resolveWriteAuthority({
				legacyRole: "OPERATOR",
				activeMembershipRoles: [],
				hasAnyMembership: false,
			}),
		).toEqual({ allowed: true, source: "legacy" });

		expect(
			resolveWriteAuthority({
				legacyRole: "VIEWER",
				activeMembershipRoles: [],
				hasAnyMembership: false,
			}),
		).toEqual({ allowed: false, source: "legacy" });
	});

	it("still allows an OWNER membership with no overrides", () => {
		expect(
			resolveWriteAuthority({
				legacyRole: "VIEWER",
				activeMembershipRoles: ["OWNER"],
				hasAnyMembership: true,
			}),
		).toEqual({ allowed: true, source: "membership" });
	});
});
