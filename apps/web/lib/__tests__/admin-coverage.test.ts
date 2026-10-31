import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	ADMIN_A_ID,
	DEVICE_A_1,
	DEVICE_A_2,
	DEVICE_B_1,
	EVENT_A_1,
	FARMER_A_ID,
	FIXED_NOW,
	MEMBERSHIP_FARMER_A,
	MEMBERSHIP_PLATFORM_ADMIN_A,
	MEMBERSHIP_VIEWER_A,
	ORG_A_ID,
	ORG_A_NAME,
	PLATFORM_ADMIN_A_ID,
	POND_A_1,
	POND_A_2,
	type TenancyDb,
	VIEWER_A_ID,
	userById,
} from "./helpers/tenancy";
import type { TestPrismaClient } from "./helpers/test-prisma";

/**
 * Coverage for the admin action branches the existing suites leave open:
 * the paged Members list, the admin daily-cap path, the two legacy pond
 * creation actions, and the error/denial branches of the member mutations.
 *
 * The real `requireTenantAdmin`, `requirePermission` and `resolveOrgScope`
 * implementations run against the two-org tenancy fixture, so a test that says
 * "denied" is denied by the same code path production uses.
 */

const holder = vi.hoisted(() => ({
	db: undefined as TenancyDb | undefined,
	auth: {
		createUser: vi.fn(),
		deleteUser: vi.fn(),
	},
	avatarUrls: vi.fn(),
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
	checkDeviceTokenRevealRateLimit: vi.fn(async () => ({ success: true, remaining: 9 })),
}));
vi.mock("@/lib/avatars", () => ({ getSignedAvatarUrls: holder.avatarUrls }));
vi.mock("@/lib/membership-invite", () => ({ inviteOrAttachMember: holder.invite }));
vi.mock("@/lib/notify/invite-email", () => ({
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
	getAuditLog,
	getDevicesForLabels,
	getUserPermissionState,
	getUsers,
	inviteMember,
	listTenantMembers,
	revokeMember,
	setUserPermission,
	updateUser,
} from "@/lib/actions/admin";
import { getCurrentUser } from "@/lib/auth/session";
import prisma from "@/lib/prisma";

const mockUser = vi.mocked(getCurrentUser);

function tenancy(): TenancyDb {
	if (!holder.db) throw new Error("tenancy database was not initialised");
	return holder.db;
}

function client(): TestPrismaClient {
	return prisma as unknown as TestPrismaClient;
}

function signInAs(userId: string) {
	mockUser.mockResolvedValue(userById(tenancy(), userId) as never);
}

function orgSetting(defaultFeedingRatePct: number) {
	tenancy().tables.orgSettings.push({
		orgId: ORG_A_ID,
		defaultFeedingRatePct,
		hopperLowPct: 20,
		offlineAfterMin: 30,
		missedFeedingAlerts: true,
		alertRoles: ["OWNER", "ADMIN"],
		deviceRegistration: "ADMIN_APPROVAL",
		updatedById: null,
		updatedAt: FIXED_NOW,
	});
}

/** Add `count` ordinary org A members so a page-size test has more than one page. */
function addOrgMembers(count: number, prefix = "extra") {
	for (let index = 0; index < count; index += 1) {
		const id = `${prefix}-user-${index}`;
		const joinedAt = new Date(FIXED_NOW.getTime() + (100 + index) * 60_000);
		tenancy().tables.users.push({
			id,
			supabaseId: `sb-${id}`,
			farmId: `${prefix}-farm-${index}`,
			email: `${id}@pond.optifeed.local`,
			displayName: `Extra ${index}`,
			role: "OPERATOR",
			mustChangePassword: false,
			createdAt: joinedAt,
			updatedAt: joinedAt,
		});
		tenancy().tables.memberships.push({
			id: `membership-${id}`,
			orgId: ORG_A_ID,
			userId: id,
			role: "OPERATOR",
			invitedBy: ADMIN_A_ID,
			createdAt: joinedAt,
			revokedAt: null,
		});
	}
}

beforeEach(() => {
	vi.clearAllMocks();
	tenancy().reset();
	holder.avatarUrls.mockResolvedValue({});
	holder.deliverInvite.mockResolvedValue(true);
	holder.auth.createUser.mockResolvedValue({
		data: { user: { id: "sb-created" } },
		error: null,
	});
	holder.auth.deleteUser.mockResolvedValue({ data: {}, error: null });
	signInAs(ADMIN_A_ID);
});

describe("listTenantMembers", () => {
	it("lists active members with role, effective permissions and last-owner flag", async () => {
		const platformMembership = tenancy().tables.memberships.find(
			(row) => row.id === MEMBERSHIP_PLATFORM_ADMIN_A,
		);
		if (!platformMembership) throw new Error("fixture membership missing");
		platformMembership.revokedAt = new Date("2026-10-15T00:00:00.000Z");
		tenancy().tables.membershipPermissions.push(
			{
				id: "mp-farmer",
				membershipId: MEMBERSHIP_FARMER_A,
				permission: "control_feeder",
				grantedAt: FIXED_NOW,
				revokedAt: new Date("2026-10-16T00:00:00.000Z"),
			},
			{
				id: "mp-viewer",
				membershipId: MEMBERSHIP_VIEWER_A,
				permission: "manage_members",
				grantedAt: FIXED_NOW,
				revokedAt: null,
			},
		);
		holder.avatarUrls.mockResolvedValue({ [ADMIN_A_ID]: "https://signed/admin-a" });

		const page = await listTenantMembers({ pageSize: 10 });

		expect(page).toMatchObject({ total: 3, page: 1, pageSize: 10 });
		expect(page.rows.map((row) => row.userId)).toEqual([ADMIN_A_ID, FARMER_A_ID, VIEWER_A_ID]);
		const admin = page.rows[0];
		expect(admin).toMatchObject({
			orgId: ORG_A_ID,
			orgName: ORG_A_NAME,
			farmId: "farm-a-admin",
			role: "OWNER",
			callerRole: "OWNER",
			isSelf: true,
			isPlatformAdmin: false,
			isLastOwner: true,
			avatarUrl: "https://signed/admin-a",
			joinedAt: new Date(FIXED_NOW.getTime() + 10 * 60_000),
		});
		expect(admin?.permissions).toContain("manage_members");

		const farmer = page.rows.find((row) => row.userId === FARMER_A_ID);
		// The revocation is a durable denial: the operator default is removed.
		expect(farmer?.permissions).not.toContain("control_feeder");
		expect(farmer?.isLastOwner).toBe(false);

		const viewer = page.rows.find((row) => row.userId === VIEWER_A_ID);
		// An unrevoked row grants even when the role default lacks it.
		expect(viewer?.permissions).toContain("manage_members");

		expect(page.orgOptions).toEqual([{ id: ORG_A_ID, name: ORG_A_NAME, callerRole: "OWNER" }]);
	});

	it("marks an active platform administrator so the UI leaves the grant alone", async () => {
		const page = await listTenantMembers();

		const platformAdmin = page.rows.find((row) => row.userId === PLATFORM_ADMIN_A_ID);
		expect(platformAdmin?.isPlatformAdmin).toBe(true);
		// Two owners exist (the admin and the platform admin), so neither is last.
		expect(page.rows.every((row) => row.isLastOwner === false)).toBe(true);
	});

	it("narrows to one member without narrowing the org options", async () => {
		const page = await listTenantMembers({ userId: FARMER_A_ID });

		expect(page.rows.map((row) => row.userId)).toEqual([FARMER_A_ID]);
		expect(page.total).toBe(1);
		expect(page.orgOptions).toHaveLength(1);
	});

	it("clamps a stale page to the last real page instead of returning nothing", async () => {
		addOrgMembers(2);
		const findMany = vi.spyOn(client().membership, "findMany");

		const page = await listTenantMembers({ page: 99, pageSize: 5 });

		expect(page).toMatchObject({ total: 6, page: 2, pageSize: 5 });
		expect(page.rows).toHaveLength(1);
		expect(page.rows[0]?.userId).toBe("extra-user-1");
		// The out-of-range first fetch is re-run against the clamped offset.
		const skips = findMany.mock.calls.map(([args]) => args?.skip);
		expect(skips).toContain(5);
		expect(skips).toContain(490);
	});

	it("drops a membership whose user row no longer exists", async () => {
		tenancy().tables.memberships.push({
			id: "membership-ghost",
			orgId: ORG_A_ID,
			userId: "user-ghost",
			role: "OPERATOR",
			invitedBy: ADMIN_A_ID,
			createdAt: new Date("2026-10-14T00:00:00.000Z"),
			revokedAt: null,
		});

		const page = await listTenantMembers();

		expect(page.total).toBe(5);
		expect(page.rows.map((row) => row.userId)).not.toContain("user-ghost");
		expect(page.rows).toHaveLength(4);
	});

	it("falls back to initials when avatar signing fails", async () => {
		holder.avatarUrls.mockResolvedValue({});

		const page = await listTenantMembers();

		expect(page.rows.every((row) => row.avatarUrl === null)).toBe(true);
	});

	it("denies a caller without a tenant-admin membership", async () => {
		signInAs(FARMER_A_ID);

		await expect(listTenantMembers()).rejects.toThrow("NEXT_REDIRECT");
	});
});

describe("adminUpdateDeviceDailyCap", () => {
	it("stores the ceiling and records the admin actor in the event", async () => {
		const result = await adminUpdateDeviceDailyCap(DEVICE_A_1, 2500);

		expect(result).toEqual({ success: true, dailyCapG: 2500 });
		const device = tenancy().tables.energyDevices.find((row) => row.id === DEVICE_A_1);
		expect((device as { dailyCapG?: number } | undefined)?.dailyCapG).toBe(2500);
		const event = tenancy().tables.deviceStateEvents.find(
			(row) => row.eventType === "daily_cap_changed",
		);
		expect(event).toMatchObject({
			deviceId: DEVICE_A_1,
			source: "user",
			actorId: ADMIN_A_ID,
			metadata: { dailyCapG: 2500, changedBy: "admin" },
		});
	});

	it("refuses a device on another tenant's pond", async () => {
		const result = await adminUpdateDeviceDailyCap(DEVICE_B_1, 2500);

		expect(result).toEqual({ success: false, error: "Device not found" });
		expect(
			tenancy().tables.deviceStateEvents.some((row) => row.eventType === "daily_cap_changed"),
		).toBe(false);
	});

	it("rejects a cap outside the writable window before reading the device", async () => {
		const findFirst = vi.spyOn(client().energyDevice, "findFirst");

		const result = await adminUpdateDeviceDailyCap(DEVICE_A_1, 100);

		expect(result).toEqual({ success: false, error: expect.stringContaining("500") });
		expect(findFirst).not.toHaveBeenCalled();
	});

	it("returns a generic error when the transaction fails", async () => {
		const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
		vi.spyOn(client().energyDevice, "update").mockRejectedValueOnce(new Error("db down"));

		const result = await adminUpdateDeviceDailyCap(DEVICE_A_1, 2500);

		expect(result).toEqual({
			success: false,
			error: "Failed to update the daily feed ceiling",
		});
		consoleError.mockRestore();
	});

	it("denies a non-admin before reading the device", async () => {
		signInAs(FARMER_A_ID);
		const findFirst = vi.spyOn(client().energyDevice, "findFirst");

		// The tenant-admin guard runs first and the action returns its own
		// reason (#336), not the generic database failure.
		await expect(adminUpdateDeviceDailyCap(DEVICE_A_1, 2500)).resolves.toEqual({
			success: false,
			error: "You do not have permission to make this change.",
			code: "wrong_role",
		});
		expect(findFirst).not.toHaveBeenCalled();
	});
});

describe("createPondWithFarmer", () => {
	const valid = {
		farmerName: "New Farmer",
		loginId: "new-farmer",
		password: "temp-pass-1",
		pondName: "New Pond",
		feedingRatePct: 3,
		feedsPerDay: 2,
		scheduleStart: "06:00",
		scheduleEnd: "18:30",
	};

	it("creates the login, farm, pond and membership in one call", async () => {
		const result = await createPondWithFarmer(valid);
		if (!("success" in result)) throw new Error(`expected creation: ${result.error}`);

		const user = tenancy().tables.users.find((row) => row.id === result.userId);
		expect(user).toMatchObject({
			farmId: "new-farmer",
			displayName: "New Farmer",
			role: "OPERATOR",
			mustChangePassword: true,
		});
		const pond = tenancy().tables.ponds.find((row) => row.id === result.pondId);
		expect(pond).toMatchObject({
			name: "New Pond",
			ownerId: "new-farmer",
			feedingRatePct: 3,
			feedsPerDay: 2,
		});
		expect(pond?.scheduleStart.toISOString()).toContain("T06:00:00.000Z");
		expect(pond?.scheduleEnd.toISOString()).toContain("T18:30:00.000Z");
		expect(tenancy().tables.memberships.find((row) => row.userId === result.userId)).toMatchObject({
			orgId: ORG_A_ID,
			role: "OPERATOR",
			invitedBy: ADMIN_A_ID,
		});
	});

	it("inherits the organization's default feeding rate when none is sent", async () => {
		orgSetting(4.5);

		const result = await createPondWithFarmer({ ...valid, feedingRatePct: undefined });
		if (!("success" in result)) throw new Error(`expected creation: ${result.error}`);

		expect(tenancy().tables.ponds.find((row) => row.id === result.pondId)?.feedingRatePct).toBe(
			4.5,
		);
	});

	it.each([
		["a login id with unsupported characters", { loginId: "Bad_ID" }, /lowercase alphanumeric/],
		["a blank farmer name", { farmerName: "   " }, /Farmer name is required/],
		["a blank pond name", { pondName: "   " }, /Pond name is required/],
		["an oversized password", { password: "a".repeat(73) }, /too long/],
		["an out-of-range feeding rate", { feedingRatePct: 50 }, /Feeding rate/],
	])("rejects %s before minting a login", async (_label, override, message) => {
		const result = await createPondWithFarmer({ ...valid, ...override });

		expect(result).toEqual({ error: expect.stringMatching(message) });
		expect(holder.auth.createUser).not.toHaveBeenCalled();
	});

	it("rejects a duplicate login id before minting a login", async () => {
		const result = await createPondWithFarmer({ ...valid, loginId: "farm-a" });

		expect(result).toEqual({ error: 'A user with login ID "farm-a" already exists.' });
		expect(holder.auth.createUser).not.toHaveBeenCalled();
	});

	it("returns the Supabase message when the login cannot be created", async () => {
		holder.auth.createUser.mockResolvedValue({
			data: { user: null },
			error: { message: "duplicate key value" },
		});

		const result = await createPondWithFarmer(valid);

		expect(result).toEqual({ error: "Failed to create auth account: duplicate key value" });
		expect(tenancy().tables.users.some((row) => row.farmId === "new-farmer")).toBe(false);
	});

	it("rolls the login back when the app transaction fails", async () => {
		const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
		vi.spyOn(client().pond, "create").mockRejectedValueOnce(new Error("db down"));

		const result = await createPondWithFarmer(valid);

		expect(result).toEqual({ error: "Failed to create the farmer and pond." });
		expect(holder.auth.deleteUser).toHaveBeenCalledWith("sb-created");
		consoleError.mockRestore();
	});
});

describe("createPond", () => {
	const valid = {
		name: "Established Pond",
		ownerFarmId: "farm-a",
		feedingRatePct: 4,
		feedsPerDay: 3,
		scheduleStart: "07:00",
		scheduleEnd: "19:00",
	};

	it("adds a pond to an existing farmer and reuses their farm", async () => {
		const result = await createPond(valid);
		if (!("success" in result)) throw new Error(`expected creation: ${result.error}`);

		const pond = tenancy().tables.ponds.find((row) => row.id === result.pondId);
		expect(pond).toMatchObject({
			ownerId: "farm-a",
			farmId: "farm-row-a",
			feedingRatePct: 4,
			feedsPerDay: 3,
		});
	});

	it("inherits the org default feeding rate when none is sent", async () => {
		orgSetting(2.5);

		const result = await createPond({ ...valid, feedingRatePct: undefined });
		if (!("success" in result)) throw new Error(`expected creation: ${result.error}`);

		expect(tenancy().tables.ponds.find((row) => row.id === result.pondId)?.feedingRatePct).toBe(
			2.5,
		);
	});

	it("rejects an out-of-range rate before writing", async () => {
		const result = await createPond({ ...valid, feedingRatePct: 0 });

		expect(result).toEqual({ error: expect.stringContaining("Feeding rate") });
		expect(tenancy().tables.ponds).toHaveLength(3);
	});

	it("returns a generic error when the create fails", async () => {
		const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
		vi.spyOn(client().pond, "create").mockRejectedValueOnce(new Error("db down"));

		const result = await createPond(valid);

		expect(result).toEqual({ error: "Failed to create pond." });
		consoleError.mockRestore();
	});
});

describe("updateUser error branches", () => {
	it("rejects an update with no writable field", async () => {
		await expect(updateUser(FARMER_A_ID, {})).resolves.toEqual({
			error: "Nothing to update.",
		});
	});

	it("rejects a blank display name", async () => {
		await expect(updateUser(FARMER_A_ID, { displayName: "   " })).resolves.toEqual({
			error: "Display name is required.",
		});
	});

	it("rejects a display name longer than 80 characters", async () => {
		await expect(updateUser(FARMER_A_ID, { displayName: "a".repeat(81) })).resolves.toEqual({
			error: "Display name is too long.",
		});
	});

	it("returns a generic error when the user row cannot be written", async () => {
		const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
		vi.spyOn(client().user, "update").mockRejectedValueOnce(new Error("db down"));

		await expect(updateUser(FARMER_A_ID, { displayName: "Renamed" })).resolves.toEqual({
			error: "Failed to update user.",
		});
		consoleError.mockRestore();
	});
});

describe("deleteUser error branches", () => {
	it("aborts before deleting the app rows when the login cannot be removed", async () => {
		const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
		holder.auth.deleteUser.mockResolvedValue({ error: { message: "auth down" } });

		const result = await deleteUser(FARMER_A_ID);

		expect(result).toEqual({
			error: "Failed to remove the account's login. Nothing was deleted.",
		});
		expect(tenancy().tables.users.some((row) => row.id === FARMER_A_ID)).toBe(true);
		consoleError.mockRestore();
	});

	it("returns a generic error when the subtree cleanup fails", async () => {
		const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
		vi.spyOn(client().platformAdmin, "deleteMany").mockRejectedValueOnce(new Error("db down"));

		const result = await deleteUser(FARMER_A_ID);

		expect(result).toEqual({ error: "Failed to delete user." });
		expect(holder.auth.deleteUser).toHaveBeenCalledWith("sb-farmer-a");
		consoleError.mockRestore();
	});
});

describe("changeMemberRole / revokeMember transaction guards", () => {
	function promoteViewerToOwner() {
		const membership = tenancy().tables.memberships.find((row) => row.id === MEMBERSHIP_VIEWER_A);
		if (!membership) throw new Error("fixture membership missing");
		membership.role = "OWNER";
	}

	it("rejects an unknown role name", async () => {
		await expect(changeMemberRole(FARMER_A_ID, "ROOT" as never)).resolves.toEqual({
			error: "Choose a valid role.",
		});
	});

	it("refuses a member whose membership was revoked", async () => {
		// `resolveOrgScope()` is built from active memberships, so a revoked
		// member drops out of scope before the "no active membership" branch.
		// Asserting the current answer keeps the boundary honest either way.
		const membership = tenancy().tables.memberships.find((row) => row.id === MEMBERSHIP_FARMER_A);
		if (!membership) throw new Error("fixture membership missing");
		membership.revokedAt = new Date("2026-10-01T00:00:00.000Z");

		await expect(changeMemberRole(FARMER_A_ID, "ADMIN")).resolves.toEqual({
			error: "That user is outside your organization.",
		});
	});

	it("refuses a demotion that would leave zero owners inside the transaction", async () => {
		promoteViewerToOwner();
		// The pre-check sees two owners; the in-transaction re-check sees one.
		vi.spyOn(client().membership, "count").mockResolvedValueOnce(2).mockResolvedValueOnce(1);

		await expect(changeMemberRole(VIEWER_A_ID, "ADMIN")).resolves.toEqual({
			error: "The last owner cannot be demoted or removed. Promote another owner first.",
		});
		expect(tenancy().tables.memberships.find((row) => row.id === MEMBERSHIP_VIEWER_A)?.role).toBe(
			"OWNER",
		);
	});

	it("returns a generic error when the role update fails", async () => {
		const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
		vi.spyOn(client().membership, "update").mockRejectedValueOnce(new Error("db down"));

		await expect(changeMemberRole(FARMER_A_ID, "ADMIN")).resolves.toEqual({
			error: "Failed to update the role.",
		});
		consoleError.mockRestore();
	});

	it("refuses a revocation that would leave zero owners inside the transaction", async () => {
		promoteViewerToOwner();
		vi.spyOn(client().membership, "count").mockResolvedValueOnce(2).mockResolvedValueOnce(1);

		await expect(revokeMember(VIEWER_A_ID)).resolves.toEqual({
			error: "The last owner cannot be demoted or removed. Promote another owner first.",
		});
		expect(
			tenancy().tables.memberships.find((row) => row.id === MEMBERSHIP_VIEWER_A)?.revokedAt,
		).toBeNull();
	});

	it("returns a generic error when the revocation fails", async () => {
		const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
		vi.spyOn(client().membership, "update").mockRejectedValueOnce(new Error("db down"));

		await expect(revokeMember(FARMER_A_ID)).resolves.toEqual({
			error: "Failed to revoke the membership.",
		});
		consoleError.mockRestore();
	});
});

describe("permission reads and writes", () => {
	it("filters an unknown stored permission out of the override list", async () => {
		tenancy().tables.membershipPermissions.push({
			id: "mp-unknown",
			membershipId: MEMBERSHIP_FARMER_A,
			permission: "root_everything",
			grantedAt: FIXED_NOW,
			revokedAt: null,
		});

		const state = await getUserPermissionState(FARMER_A_ID);

		expect(state).toMatchObject({ success: true, role: "OPERATOR" });
		if (!state.success) throw new Error("expected success");
		expect(state.overrides).toEqual([]);
		expect(state.defaults).toContain("view_dashboard");
	});

	it("returns a load failure instead of throwing when overrides cannot be read", async () => {
		const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
		// First call is the permission gate's own read; the second is the one
		// that loads this member's overrides.
		vi.spyOn(client().membershipPermission, "findMany")
			.mockResolvedValueOnce([])
			.mockRejectedValueOnce(new Error("db down"));

		await expect(getUserPermissionState(FARMER_A_ID)).resolves.toEqual({
			success: false,
			error: "Failed to load permissions.",
		});
		consoleError.mockRestore();
	});

	it("grants a permission and returns the new state", async () => {
		const result = await setUserPermission(FARMER_A_ID, "manage_members", true);

		expect(result).toMatchObject({ success: true, role: "OPERATOR" });
		const row = tenancy().tables.membershipPermissions.find(
			(row) => row.membershipId === MEMBERSHIP_FARMER_A,
		);
		expect(row).toMatchObject({ permission: "manage_members", revokedAt: null });
	});

	it("returns a generic error when the override cannot be written", async () => {
		const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
		vi.spyOn(client().membershipPermission, "upsert").mockRejectedValueOnce(new Error("db down"));

		await expect(setUserPermission(FARMER_A_ID, "control_feeder", false)).resolves.toEqual({
			success: false,
			error: "Failed to update the permission.",
		});
		consoleError.mockRestore();
	});
});

describe("inviteMember edge branches", () => {
	it("rejects an unknown role before calling the provisioning helper", async () => {
		const result = await inviteMember({
			email: "new@example.test",
			displayName: "New",
			role: "SUPERUSER" as never,
		});

		expect(result).toEqual({ error: "Choose a valid role." });
		expect(holder.invite).not.toHaveBeenCalled();
	});

	it("still delivers the one-time password when the org name lookup fails", async () => {
		vi.spyOn(client().organization, "findUnique").mockRejectedValueOnce(new Error("db down"));
		holder.invite.mockResolvedValue({
			success: true,
			membershipId: "m-new",
			userId: "u-new",
			loginEmail: "new@pond.optifeed.local",
			temporaryPassword: "TempPass123",
			createdUser: true,
		});

		const result = await inviteMember({
			email: "new@example.test",
			displayName: "New",
			role: "OPERATOR",
		});

		expect(result).toMatchObject({ success: true, temporaryPassword: "TempPass123" });
		expect(holder.deliverInvite).toHaveBeenCalledWith(
			expect.objectContaining({ orgName: undefined, to: "new@example.test" }),
		);
	});
});

describe("paged reads clamp a stale page", () => {
	it("getUsers returns the last real page", async () => {
		addOrgMembers(8);

		const page = await getUsers({ page: 99, pageSize: 5 });

		expect(page).toMatchObject({ total: 11, page: 3, pageSize: 5 });
		expect(page.rows).toHaveLength(1);
		expect(page.rows[0]?.id).toBe(ADMIN_A_ID);
	});

	it("getAuditLog returns the last real page", async () => {
		for (let index = 0; index < 4; index += 1) {
			tenancy().tables.deviceStateEvents.push({
				id: `event-extra-${index}`,
				deviceId: DEVICE_A_1,
				eventType: "connected",
				source: "device",
				actorId: null,
				metadata: null,
				deviceTime: null,
				createdAt: new Date(FIXED_NOW.getTime() + (60 + index) * 60_000),
				farmId: "farm-a",
			});
		}

		const page = await getAuditLog({ page: 99, pageSize: 5 });

		expect(page).toMatchObject({ total: 6, page: 2, pageSize: 5 });
		expect(page.rows.map((row) => row.id)).toEqual([EVENT_A_1]);
	});
});

describe("getDevicesForLabels scoping", () => {
	it("returns every in-scope device for an empty selection", async () => {
		const rows = await getDevicesForLabels([]);

		expect(rows.map((row) => row.id).sort()).toEqual([DEVICE_A_1, DEVICE_A_2].sort());
	});

	it("keeps the admin's selection order and drops foreign devices", async () => {
		const rows = await getDevicesForLabels([DEVICE_A_1, DEVICE_B_1, DEVICE_A_2]);

		expect(rows.map((row) => row.id)).toEqual([DEVICE_A_1, DEVICE_A_2]);
		expect(JSON.stringify(rows)).not.toContain("tok_SECRET");
	});
});

describe("updatePondOwner and setPondStatus failure branches", () => {
	it("returns a generic error when moving the pond fails", async () => {
		const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
		vi.spyOn(client().pond, "update").mockRejectedValueOnce(new Error("db down"));
		const { updatePondOwner } = await import("@/lib/actions/admin");

		await expect(updatePondOwner(POND_A_1, "farm-a-viewer")).resolves.toEqual({
			error: "Failed to update pond owner.",
		});
		consoleError.mockRestore();
	});

	it("keeps the archived pond's devices and events", async () => {
		const { setPondStatus } = await import("@/lib/actions/admin");

		await expect(setPondStatus(POND_A_2, "ARCHIVED")).resolves.toEqual({ success: true });

		expect(tenancy().tables.ponds.find((row) => row.id === POND_A_2)?.status).toBe("ARCHIVED");
		expect(tenancy().tables.energyDevices.filter((row) => row.pondId === POND_A_2)).toHaveLength(1);
	});
});
