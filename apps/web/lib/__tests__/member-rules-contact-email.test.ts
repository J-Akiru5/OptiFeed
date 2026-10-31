import { describe, expect, it } from "vitest";

import {
	ADMIN_EDIT_OWNER_EMAIL_MESSAGE,
	MEMBER_OTHER_ORG_EMAIL_MESSAGE,
	MEMBER_ROLES,
	contactEmailEditError,
	contactEmailTargetError,
} from "@/lib/auth/member-rules";

describe("contactEmailEditError (#449)", () => {
	it("stops an ADMIN changing an OWNER address", () => {
		expect(contactEmailEditError({ actorRole: "ADMIN", targetRole: "OWNER" })).toBe(
			ADMIN_EDIT_OWNER_EMAIL_MESSAGE,
		);
	});

	it("lets an OWNER change anyone address, including another OWNER", () => {
		for (const targetRole of MEMBER_ROLES) {
			expect(contactEmailEditError({ actorRole: "OWNER", targetRole })).toBeNull();
		}
	});

	it("lets an ADMIN change every non-owner address", () => {
		for (const targetRole of ["ADMIN", "OPERATOR", "VIEWER"] as const) {
			expect(contactEmailEditError({ actorRole: "ADMIN", targetRole })).toBeNull();
		}
	});
});

describe("contactEmailTargetError (#449)", () => {
	const owner = new Map([["org-a", "OWNER" as const]]);
	const admin = new Map([["org-a", "ADMIN" as const]]);

	it("allows a target whose only organization the caller administers", () => {
		expect(
			contactEmailTargetError({
				actorRoleByOrg: owner,
				targetMemberships: [{ orgId: "org-a", role: "OPERATOR" }],
			}),
		).toBeNull();
	});

	it("refuses a target who also belongs to an organization the caller does not administer", () => {
		expect(
			contactEmailTargetError({
				actorRoleByOrg: owner,
				targetMemberships: [
					{ orgId: "org-a", role: "OPERATOR" },
					{ orgId: "org-b", role: "VIEWER" },
				],
			}),
		).toBe(MEMBER_OTHER_ORG_EMAIL_MESSAGE);
	});

	it("applies the hierarchy rule in every shared organization", () => {
		const both = new Map([
			["org-a", "OWNER" as const],
			["org-b", "ADMIN" as const],
		]);
		expect(
			contactEmailTargetError({
				actorRoleByOrg: both,
				targetMemberships: [
					{ orgId: "org-a", role: "OWNER" },
					{ orgId: "org-b", role: "OWNER" },
				],
			}),
		).toBe(ADMIN_EDIT_OWNER_EMAIL_MESSAGE);
	});

	it("lets an ADMIN change a non-owner target", () => {
		expect(
			contactEmailTargetError({
				actorRoleByOrg: admin,
				targetMemberships: [{ orgId: "org-a", role: "VIEWER" }],
			}),
		).toBeNull();
	});

	it("has nothing to refuse for an account with no active membership", () => {
		expect(contactEmailTargetError({ actorRoleByOrg: owner, targetMemberships: [] })).toBeNull();
	});
});
