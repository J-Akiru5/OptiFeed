import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({
	default: {
		membership: { findMany: vi.fn() },
		organization: { findMany: vi.fn() },
		membershipPermission: { findMany: vi.fn() },
	},
}));

vi.mock("@/lib/auth/session", () => ({
	getCurrentUser: vi.fn(),
}));

import {
	PERMISSIONS,
	ROLE_DEFAULTS,
	effectivePermissions,
	getCurrentPermissions,
	hasPermission,
	isPermission,
	requirePermission,
} from "@/lib/auth/permissions";
import { getCurrentUser } from "@/lib/auth/session";
import prisma from "@/lib/prisma";

const mockMembershipFindMany = vi.mocked(prisma.membership.findMany);
const mockOrganizationFindMany = vi.mocked(prisma.organization.findMany);
const mockPermissionFindMany = vi.mocked(prisma.membershipPermission.findMany);
const mockGetCurrentUser = vi.mocked(getCurrentUser);

const USER = { id: "user_1", farmId: "farm-1" };

function sorted(values: Iterable<string>): string[] {
	return [...values].sort();
}

function sortedDefaults(role: keyof typeof ROLE_DEFAULTS): string[] {
	return sorted(ROLE_DEFAULTS[role]);
}

describe("isPermission", () => {
	it("accepts every declared permission", () => {
		for (const permission of PERMISSIONS) {
			expect(isPermission(permission)).toBe(true);
		}
	});

	it("rejects names that are not in the permission set", () => {
		expect(isPermission("control_relay")).toBe(false);
		expect(isPermission("CONTROL_FEEDER")).toBe(false);
		expect(isPermission("")).toBe(false);
	});
});

describe("effectivePermissions", () => {
	it("gives OWNER every permission", () => {
		expect(sorted(effectivePermissions("OWNER"))).toEqual(sorted(PERMISSIONS));
	});

	it("gives ADMIN every permission", () => {
		expect(sorted(effectivePermissions("ADMIN"))).toEqual(sorted(PERMISSIONS));
	});

	it("gives OPERATOR the working set", () => {
		expect(sorted(effectivePermissions("OPERATOR"))).toEqual([
			"claim_feeder",
			"control_feeder",
			"manage_schedule",
			"view_dashboard",
		]);
	});

	it("gives VIEWER read-only defaults", () => {
		expect(sorted(effectivePermissions("VIEWER"))).toEqual(["view_dashboard", "view_reports"]);
	});

	it("keeps the same result when overrides are an empty list", () => {
		expect(sorted(effectivePermissions("OPERATOR", []))).toEqual(sortedDefaults("OPERATOR"));
	});

	it("adds a permission granted by an unrevoked row", () => {
		const permissions = effectivePermissions("VIEWER", [
			{ permission: "manage_schedule", revokedAt: null },
		]);

		expect(permissions.has("manage_schedule")).toBe(true);
		// Defaults are layered, not replaced: the VIEWER defaults stay.
		expect(sorted(permissions)).toEqual(["manage_schedule", "view_dashboard", "view_reports"]);
	});

	it("removes a permission revoked by a row", () => {
		const permissions = effectivePermissions("ADMIN", [
			{ permission: "control_feeder", revokedAt: new Date() },
		]);

		expect(permissions.has("control_feeder")).toBe(false);
		// Only the revoked permission is removed — the rest of ADMIN's defaults remain.
		expect(permissions.has("manage_schedule")).toBe(true);
		expect(permissions.has("manage_members")).toBe(true);
		expect(permissions.size).toBe(PERMISSIONS.length - 1);
	});

	it("lets OWNER's control_feeder be revoked explicitly", () => {
		const permissions = effectivePermissions("OWNER", [
			{ permission: "control_feeder", revokedAt: new Date() },
		]);

		expect(permissions.has("control_feeder")).toBe(false);
		expect(permissions.has("manage_schedule")).toBe(true);
		expect(permissions.has("view_dashboard")).toBe(true);
	});

	it("ignores unknown permission names on a grant", () => {
		const permissions = effectivePermissions("VIEWER", [
			{ permission: "control_relay", revokedAt: null },
		]);

		expect(sorted(permissions)).toEqual(sortedDefaults("VIEWER"));
		expect(sorted(permissions)).not.toContain("control_relay");
	});

	it("ignores unknown permission names on a revocation", () => {
		const permissions = effectivePermissions("ADMIN", [
			{ permission: "control_relay", revokedAt: new Date() },
		]);

		expect(sorted(permissions)).toEqual(sortedDefaults("ADMIN"));
	});

	it("returns a fresh set that cannot mutate the role defaults", () => {
		const first = effectivePermissions("VIEWER");
		first.add("manage_members");

		expect(effectivePermissions("VIEWER").has("manage_members")).toBe(false);
		expect(sortedDefaults("VIEWER")).toEqual(["view_dashboard", "view_reports"]);
	});
});

describe("getCurrentPermissions", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockGetCurrentUser.mockResolvedValue(USER as never);
		mockOrganizationFindMany.mockResolvedValue([{ id: "org_1" }] as never);
		mockPermissionFindMany.mockResolvedValue([] as never);
	});

	it("fails closed with no session", async () => {
		mockGetCurrentUser.mockResolvedValue(null);

		expect(await getCurrentPermissions()).toEqual(new Set());
		expect(mockMembershipFindMany).not.toHaveBeenCalled();
	});

	it("fails closed with no membership", async () => {
		mockMembershipFindMany.mockResolvedValue([] as never);

		expect(await getCurrentPermissions()).toEqual(new Set());
		expect(mockOrganizationFindMany).not.toHaveBeenCalled();
		expect(mockPermissionFindMany).not.toHaveBeenCalled();
	});

	it("excludes memberships whose organization is not ACTIVE", async () => {
		mockMembershipFindMany.mockResolvedValue([
			{ id: "m1", orgId: "org_1", role: "ADMIN" },
		] as never);
		mockOrganizationFindMany.mockResolvedValue([] as never);

		expect(await getCurrentPermissions()).toEqual(new Set());
		expect(mockOrganizationFindMany).toHaveBeenCalledWith(
			expect.objectContaining({
				where: { id: { in: ["org_1"] }, status: "ACTIVE" },
			}),
		);
		expect(mockPermissionFindMany).not.toHaveBeenCalled();
	});

	it("applies role defaults when the membership has no permission rows", async () => {
		mockMembershipFindMany.mockResolvedValue([
			{ id: "m1", orgId: "org_1", role: "OPERATOR" },
		] as never);

		expect(sorted(await getCurrentPermissions())).toEqual(sortedDefaults("OPERATOR"));
	});

	it("applies explicit grants and revocations on top of the defaults", async () => {
		mockMembershipFindMany.mockResolvedValue([
			{ id: "m1", orgId: "org_1", role: "ADMIN" },
		] as never);
		mockPermissionFindMany.mockResolvedValue([
			{ membershipId: "m1", permission: "control_feeder", revokedAt: new Date() },
		] as never);

		const permissions = await getCurrentPermissions();

		expect(permissions.has("control_feeder")).toBe(false);
		expect(permissions.has("manage_members")).toBe(true);
	});

	it("applies a revoked control_feeder row to an OWNER membership", async () => {
		mockMembershipFindMany.mockResolvedValue([
			{ id: "m1", orgId: "org_1", role: "OWNER" },
		] as never);
		mockPermissionFindMany.mockResolvedValue([
			{ membershipId: "m1", permission: "control_feeder", revokedAt: new Date() },
		] as never);

		const permissions = await getCurrentPermissions();

		expect(permissions.has("control_feeder")).toBe(false);
		expect(permissions.has("manage_members")).toBe(true);
	});

	it("grants a permission outside the role default from an unrevoked row", async () => {
		mockMembershipFindMany.mockResolvedValue([
			{ id: "m1", orgId: "org_1", role: "VIEWER" },
		] as never);
		mockPermissionFindMany.mockResolvedValue([
			{ membershipId: "m1", permission: "manage_schedule", revokedAt: null },
		] as never);

		const permissions = await getCurrentPermissions();

		expect(permissions.has("manage_schedule")).toBe(true);
		expect(permissions.has("view_reports")).toBe(true);
	});

	it("unions permissions across active memberships", async () => {
		mockMembershipFindMany.mockResolvedValue([
			{ id: "m1", orgId: "org_1", role: "VIEWER" },
			{ id: "m2", orgId: "org_2", role: "OPERATOR" },
		] as never);
		mockOrganizationFindMany.mockResolvedValue([{ id: "org_1" }, { id: "org_2" }] as never);

		const permissions = await getCurrentPermissions();

		// view_reports comes only from the VIEWER membership, control_feeder only
		// from the OPERATOR one; the union keeps both.
		expect(permissions.has("view_reports")).toBe(true);
		expect(permissions.has("control_feeder")).toBe(true);
		expect(permissions.has("manage_farms_ponds")).toBe(false);
	});

	it("ignores permission rows from a membership in an inactive organization", async () => {
		mockMembershipFindMany.mockResolvedValue([
			{ id: "m1", orgId: "org_1", role: "OPERATOR" },
			{ id: "m2", orgId: "org_2", role: "ADMIN" },
		] as never);
		mockOrganizationFindMany.mockResolvedValue([{ id: "org_1" }] as never);

		const permissions = await getCurrentPermissions();

		// Only the ACTIVE org's membership contributes rows, and rows are never
		// queried for the membership in the suspended org.
		expect(mockPermissionFindMany).toHaveBeenCalledWith(
			expect.objectContaining({ where: { membershipId: { in: ["m1"] } } }),
		);
		expect(permissions.has("manage_members")).toBe(false);
	});

	it("ignores unknown permission names in stored rows", async () => {
		mockMembershipFindMany.mockResolvedValue([
			{ id: "m1", orgId: "org_1", role: "VIEWER" },
		] as never);
		mockPermissionFindMany.mockResolvedValue([
			{ membershipId: "m1", permission: "control_relay", revokedAt: null },
		] as never);

		expect(sorted(await getCurrentPermissions())).toEqual(sortedDefaults("VIEWER"));
	});
});

describe("hasPermission and requirePermission", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockGetCurrentUser.mockResolvedValue(USER as never);
		mockMembershipFindMany.mockResolvedValue([
			{ id: "m1", orgId: "org_1", role: "OPERATOR" },
		] as never);
		mockOrganizationFindMany.mockResolvedValue([{ id: "org_1" }] as never);
		mockPermissionFindMany.mockResolvedValue([] as never);
	});

	it("hasPermission is true for a role default", async () => {
		expect(await hasPermission("control_feeder")).toBe(true);
	});

	it("hasPermission is false for a permission the role lacks", async () => {
		expect(await hasPermission("manage_members")).toBe(false);
	});

	it("requirePermission resolves when the permission is held", async () => {
		await expect(requirePermission("manage_schedule")).resolves.toBeUndefined();
	});

	it("requirePermission throws Forbidden when the permission is denied", async () => {
		await expect(requirePermission("manage_members")).rejects.toThrow("Forbidden");
	});

	it("requirePermission fails closed without a session", async () => {
		mockGetCurrentUser.mockResolvedValue(null);

		await expect(requirePermission("view_dashboard")).rejects.toThrow(new Error("Forbidden"));
	});
});
