import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	ADMIN_A_ID,
	DEVICE_A_1,
	DEVICE_B_1,
	FARMER_A_ID,
	MEMBERSHIP_ADMIN_A,
	MEMBERSHIP_FARMER_A,
	ORG_A_ID,
	POND_A_1,
	type TenancyDb,
	userById,
} from "./helpers/tenancy";

/**
 * Authorization matrix for every browser-callable action in `lib/actions/admin`.
 *
 * For each export the table below records the guard it carries and how to call
 * it. The same table then proves three things at runtime, against the real
 * `requireTenantAdmin` / `requirePermission` implementations:
 *
 * 1. an OPERATOR/VIEWER session is redirected before the action does anything;
 * 2. an OWNER whose `manage_members` / `manage_farms_ponds` override was revoked
 *    gets `Forbidden` on exactly the actions that declare that permission, while
 *    the other actions still work;
 * 3. an OWNER with no overrides can use every action.
 *
 * A single happy-path assertion per action would not catch a dropped guard, so
 * the denial legs are the point of this file.
 */

const holder = vi.hoisted(() => ({
	db: undefined as TenancyDb | undefined,
	auth: {
		createUser: vi.fn(),
		deleteUser: vi.fn(),
	},
	rateLimit: vi.fn(),
	invite: vi.fn(),
	deliverInvite: vi.fn(),
}));

vi.mock("@/lib/prisma", async () => {
	const { createTenancyDb } = await import("./helpers/tenancy");
	const { createTestPrisma } = await import("./helpers/test-prisma");
	holder.db = createTenancyDb();
	return { default: createTestPrisma(holder.db) };
});

vi.mock("@/lib/auth/session", () => ({
	getCurrentUser: vi.fn(),
	assertPasswordChanged: vi.fn(async () => undefined),
	buildPondEmail: (farmId: string) => `${farmId.trim().toLowerCase()}@pond.optifeed.local`,
}));

vi.mock("@/lib/auth/session-cache", () => ({ invalidateFarm: vi.fn() }));
vi.mock("@/lib/actions/admin-internal", () => ({ deleteUserSubtree: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({
	createAdminClient: () => ({ auth: { admin: holder.auth } }),
}));
vi.mock("@/lib/rate-limit", () => ({
	checkDeviceTokenRevealRateLimit: holder.rateLimit,
}));
vi.mock("@/lib/avatars", () => ({ getSignedAvatarUrls: vi.fn(async () => ({})) }));
vi.mock("@/lib/membership-invite", () => ({ inviteOrAttachMember: holder.invite }));
vi.mock("@/lib/notify/invite-email", async (importOriginal) => ({
	// `isDeliverableEmail` is real: the contact-email action validates with it.
	...(await importOriginal<typeof import("@/lib/notify/invite-email")>()),
	deliverMemberInviteEmail: holder.deliverInvite,
}));
vi.mock("@/i18n/routing", () => ({
	redirect: vi.fn(() => {
		throw new Error("NEXT_REDIRECT");
	}),
}));
vi.mock("next-intl/server", () => ({ getLocale: vi.fn(async () => "en") }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import {
	adminUpdateDeviceDailyCap,
	changeMemberRole,
	createPond,
	createPondWithFarmer,
	deleteUser,
	getAdminStats,
	getAllFarmHierarchies,
	getAuditLog,
	getDevices,
	getDevicesForLabels,
	getPendingDevices,
	getPonds,
	getUserPermissionState,
	getUsers,
	inviteMember,
	listTenantMembers,
	revealDeviceToken,
	revokeMember,
	setPondStatus,
	setUserPermission,
	updateMemberContactEmail,
	updatePondOwner,
	updateUser,
} from "@/lib/actions/admin";
import { getCurrentUser } from "@/lib/auth/session";
import prisma from "@/lib/prisma";

const mockUser = vi.mocked(getCurrentUser);

type AdminActionCase = {
	name: string;
	/** The extra permission the action asserts, or null for tenant-admin only. */
	permission: "manage_members" | "manage_farms_ponds" | null;
	/**
	 * How a guard refusal surfaces. Every action rethrows a redirect except
	 * `adminUpdateDeviceDailyCap`, which opts into the guard's typed denial so
	 * the reason reaches the UI (#336).
	 */
	guardFailure?: "redirect" | "error";
	run: () => Promise<unknown>;
};

function tenancy(): TenancyDb {
	if (!holder.db) throw new Error("tenancy database was not initialised");
	return holder.db;
}

function signInAs(userId: string) {
	mockUser.mockResolvedValue(userById(tenancy(), userId) as never);
}

/** Revoke one permission for the acting owner, as the permissions page would. */
function revokeOwnPermission(permission: "manage_members" | "manage_farms_ponds") {
	tenancy().tables.membershipPermissions.push({
		id: `mp-revoked-${permission}`,
		membershipId: MEMBERSHIP_ADMIN_A,
		permission,
		grantedAt: new Date("2026-10-01T00:00:00.000Z"),
		revokedAt: new Date("2026-10-02T00:00:00.000Z"),
	});
}

const adminActions: readonly AdminActionCase[] = [
	{
		name: "updateUser",
		permission: "manage_members",
		run: () => updateUser(FARMER_A_ID, { displayName: "Renamed Farmer" }),
	},
	{ name: "deleteUser", permission: "manage_members", run: () => deleteUser(FARMER_A_ID) },
	{ name: "getUsers", permission: null, run: () => getUsers() },
	{
		name: "getUserPermissionState",
		permission: "manage_members",
		run: () => getUserPermissionState(FARMER_A_ID),
	},
	{
		name: "setUserPermission",
		permission: "manage_members",
		run: () => setUserPermission(FARMER_A_ID, "control_feeder", false),
	},
	{ name: "listTenantMembers", permission: null, run: () => listTenantMembers() },
	{
		name: "inviteMember",
		permission: "manage_members",
		run: () => inviteMember({ email: "new@example.test", displayName: "New", role: "OPERATOR" }),
	},
	{
		name: "changeMemberRole",
		permission: "manage_members",
		run: () => changeMemberRole(FARMER_A_ID, "ADMIN"),
	},
	{ name: "revokeMember", permission: "manage_members", run: () => revokeMember(FARMER_A_ID) },
	{
		name: "updateMemberContactEmail",
		permission: "manage_members",
		run: () => updateMemberContactEmail(FARMER_A_ID, "farmer@example.test"),
	},
	{ name: "getPonds", permission: null, run: () => getPonds() },
	{
		name: "createPondWithFarmer",
		permission: "manage_farms_ponds",
		run: () =>
			createPondWithFarmer({
				farmerName: "New Farmer",
				loginId: "new-farmer",
				password: "temp-pass-1",
				pondName: "New Pond",
				feedingRatePct: 3,
				feedsPerDay: 2,
				scheduleStart: "06:00",
				scheduleEnd: "18:00",
			}),
	},
	{
		name: "createPond",
		permission: "manage_farms_ponds",
		run: () =>
			createPond({
				name: "Second Pond",
				ownerFarmId: "farm-a",
				feedingRatePct: 3,
				feedsPerDay: 2,
				scheduleStart: "06:00",
				scheduleEnd: "18:00",
			}),
	},
	{ name: "getDevices", permission: null, run: () => getDevices() },
	{ name: "getPendingDevices", permission: null, run: () => getPendingDevices() },
	{
		name: "adminUpdateDeviceDailyCap",
		permission: null,
		guardFailure: "error",
		run: () => adminUpdateDeviceDailyCap(DEVICE_A_1, 2500),
	},
	{ name: "revealDeviceToken", permission: null, run: () => revealDeviceToken(DEVICE_A_1) },
	{ name: "getDevicesForLabels", permission: null, run: () => getDevicesForLabels([]) },
	{ name: "getAllFarmHierarchies", permission: null, run: () => getAllFarmHierarchies() },
	{ name: "getAdminStats", permission: null, run: () => getAdminStats() },
	{ name: "getAuditLog", permission: null, run: () => getAuditLog() },
	{
		name: "updatePondOwner",
		permission: "manage_farms_ponds",
		run: () => updatePondOwner(POND_A_1, "farm-a-viewer"),
	},
	{
		name: "setPondStatus",
		permission: "manage_farms_ponds",
		run: () => setPondStatus(POND_A_1, "ARCHIVED"),
	},
];

const guarded = adminActions.flatMap((entry) =>
	entry.permission === null ? [] : [{ ...entry, permission: entry.permission }],
);

beforeEach(() => {
	vi.clearAllMocks();
	tenancy().reset();
	holder.auth.createUser.mockResolvedValue({
		data: { user: { id: "sb-created" } },
		error: null,
	});
	holder.auth.deleteUser.mockResolvedValue({ data: {}, error: null });
	holder.rateLimit.mockResolvedValue({ success: true, remaining: 9 });
	holder.invite.mockResolvedValue({
		success: true,
		membershipId: "membership-new",
		userId: "user-new",
		loginEmail: "new@pond.optifeed.local",
		temporaryPassword: "TempPass123",
		createdUser: true,
	});
	holder.deliverInvite.mockResolvedValue(true);
	signInAs(ADMIN_A_ID);
});

describe("tenant console authorization matrix", () => {
	it("covers every export in lib/actions/admin", async () => {
		const module = await import("@/lib/actions/admin");
		const exported = Object.keys(module).filter(
			(key) => typeof module[key as keyof typeof module] === "function",
		);
		expect(new Set(exported)).toEqual(new Set(adminActions.map((entry) => entry.name)));
	});

	it.each(adminActions.map((entry) => [entry.name, entry] as const))(
		"%s allows an OWNER with no overrides",
		async (_name, entry) => {
			await expect(entry.run()).resolves.toBeDefined();
		},
	);

	it.each(adminActions.map((entry) => [entry.name, entry] as const))(
		"%s redirects an OPERATOR before any work",
		async (_name, entry) => {
			signInAs(FARMER_A_ID);

			if (entry.guardFailure === "error") {
				await expect(entry.run()).resolves.toMatchObject({
					success: false,
					code: "wrong_role",
					error: "You do not have permission to make this change.",
				});
			} else {
				await expect(entry.run()).rejects.toThrow("NEXT_REDIRECT");
			}
			expect(holder.auth.createUser).not.toHaveBeenCalled();
			expect(holder.auth.deleteUser).not.toHaveBeenCalled();
			expect(holder.invite).not.toHaveBeenCalled();
			expect(holder.rateLimit).not.toHaveBeenCalled();
		},
	);

	it.each(guarded.map((entry) => [entry.name, entry.permission, entry] as const))(
		"%s requires %s",
		async (_name, permission, entry) => {
			revokeOwnPermission(permission);

			await expect(entry.run()).rejects.toThrow("Forbidden");
			expect(holder.auth.createUser).not.toHaveBeenCalled();
			expect(holder.auth.deleteUser).not.toHaveBeenCalled();
			expect(holder.invite).not.toHaveBeenCalled();
		},
	);
});

describe("guard ordering keeps the tenant boundary intact", () => {
	it("checks manage_members before the target is resolved", async () => {
		revokeOwnPermission("manage_members");
		const spy = vi.spyOn(prisma.membership, "findFirst");

		await expect(changeMemberRole(FARMER_A_ID, "ADMIN")).rejects.toThrow("Forbidden");
		expect(spy).not.toHaveBeenCalled();
	});

	it("checks manage_farms_ponds before reading the pond scope", async () => {
		revokeOwnPermission("manage_farms_ponds");
		const spy = vi.spyOn(prisma.pond, "update");

		await expect(setPondStatus(POND_A_1, "ARCHIVED")).rejects.toThrow("Forbidden");
		expect(spy).not.toHaveBeenCalled();
	});

	it("still lets a manage_members denial leave the farm actions working", async () => {
		revokeOwnPermission("manage_members");

		await expect(setPondStatus(POND_A_1, "ARCHIVED")).resolves.toEqual({ success: true });
		expect(tenancy().tables.ponds.find((row) => row.id === POND_A_1)?.status).toBe("ARCHIVED");
	});

	it("still lets a manage_farms_ponds denial leave the member actions working", async () => {
		revokeOwnPermission("manage_farms_ponds");

		await expect(changeMemberRole(FARMER_A_ID, "ADMIN")).resolves.toEqual({ success: true });
		expect(tenancy().tables.memberships.find((row) => row.id === MEMBERSHIP_FARMER_A)?.role).toBe(
			"ADMIN",
		);
	});

	it("refuses a device from another tenant before the rate limiter counts a reveal", async () => {
		await expect(revealDeviceToken(DEVICE_B_1)).resolves.toEqual({
			success: false,
			error: "Device not found in your organization.",
		});
		expect(holder.rateLimit).toHaveBeenCalledWith(ADMIN_A_ID);
	});

	it("never writes an org B membership when provisioning from org A", async () => {
		await inviteMember({ email: "new@example.test", displayName: "New", role: "OPERATOR" });

		expect(holder.invite).toHaveBeenCalledWith(
			expect.objectContaining({ orgId: ORG_A_ID, invitedBy: ADMIN_A_ID }),
		);
	});
});

describe("adminUpdateDeviceDailyCap authorization reasons (#336)", () => {
	const WRONG_ROLE = {
		success: false,
		error: "You do not have permission to make this change.",
		code: "wrong_role",
	};

	it("returns wrong_role for an OPERATOR instead of a generic failure", async () => {
		signInAs(FARMER_A_ID);

		await expect(adminUpdateDeviceDailyCap(DEVICE_A_1, 2500)).resolves.toEqual(WRONG_ROLE);
	});

	it("returns not_authenticated when there is no session", async () => {
		mockUser.mockResolvedValue(null);

		await expect(adminUpdateDeviceDailyCap(DEVICE_A_1, 2500)).resolves.toEqual({
			success: false,
			error: "Your session has ended. Sign in again to continue.",
			code: "not_authenticated",
		});
	});

	it("returns password_change_required for a flagged user", async () => {
		userById(tenancy(), ADMIN_A_ID).mustChangePassword = true;
		signInAs(ADMIN_A_ID);

		await expect(adminUpdateDeviceDailyCap(DEVICE_A_1, 2500)).resolves.toEqual({
			success: false,
			error: "Change your temporary password before making changes.",
			code: "password_change_required",
		});
	});

	it("returns org_suspended when the only admin organization is not active", async () => {
		const org = tenancy().tables.organizations.find((row) => row.id === ORG_A_ID);
		if (!org) throw new Error("org A missing");
		org.status = "SUSPENDED";
		signInAs(ADMIN_A_ID);

		await expect(adminUpdateDeviceDailyCap(DEVICE_A_1, 2500)).resolves.toEqual({
			success: false,
			error: "Your organization is suspended, so changes are paused.",
			code: "org_suspended",
		});
	});

	it("still lets an OWNER change the ceiling", async () => {
		signInAs(ADMIN_A_ID);

		await expect(adminUpdateDeviceDailyCap(DEVICE_A_1, 2500)).resolves.toEqual({
			success: true,
			dailyCapG: 2500,
		});
	});
});
