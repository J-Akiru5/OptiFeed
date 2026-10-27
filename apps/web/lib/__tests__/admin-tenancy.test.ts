import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TenancyDb } from "./helpers/tenancy";

/**
 * Cross-tenant negative tests for the /admin reads and writes that the existing
 * suites do not already cover (revealDeviceToken, getDevicesForLabels and
 * setPondStatus live in their own suites; getAllFarmHierarchies had only a
 * happy-path check before this file).
 *
 * The actions run against the two-org in-memory database from
 * `helpers/tenancy.ts`; `resolveOrgScope`, `requireTenantAdmin` and
 * `requirePermission` are the real implementations, so a missing scope filter
 * really does expose org B and fails the test.
 */

const holder = vi.hoisted(() => ({ db: undefined as TenancyDb | undefined }));
const auth = vi.hoisted(() => ({
	createUser: vi.fn(),
	deleteUser: vi.fn(),
}));

vi.mock("@/lib/prisma", async () => {
	const { createTenancyDb } = await import("./helpers/tenancy");
	holder.db = createTenancyDb();
	return { default: holder.db.client };
});

vi.mock("@/lib/auth/session", () => ({
	getCurrentUser: vi.fn(),
	assertPasswordChanged: vi.fn(async () => undefined),
	buildPondEmail: (farmId: string) => `${farmId.toLowerCase().trim()}@pond.optifeed.local`,
}));

vi.mock("@/lib/auth/session-cache", () => ({ invalidateFarm: vi.fn() }));

vi.mock("@/lib/actions/admin-internal", () => ({
	deleteUserSubtree: vi.fn(async () => undefined),
}));

vi.mock("@/lib/supabase/admin", () => ({
	createAdminClient: () => ({ auth: { admin: auth } }),
}));

vi.mock("@/lib/rate-limit", () => ({
	checkDeviceTokenRevealRateLimit: vi.fn(async () => ({ success: true, remaining: 9 })),
}));

vi.mock("@/i18n/routing", () => ({
	redirect: vi.fn(() => {
		throw new Error("NEXT_REDIRECT");
	}),
}));

vi.mock("next-intl/server", () => ({
	getLocale: vi.fn(async () => "en"),
}));

import {
	createPond,
	createPondWithFarmer,
	deleteUser,
	getAdminStats,
	getAllFarmHierarchies,
	getAuditLog,
	getDevices,
	getPonds,
	getUserPermissionState,
	getUsers,
	setUserPermission,
	updatePondOwner,
	updateUser,
} from "@/lib/actions/admin";
import { deleteUserSubtree } from "@/lib/actions/admin-internal";
import { getCurrentUser } from "@/lib/auth/session";
import {
	ADMIN_A_ID,
	DEVICE_A_1,
	DEVICE_A_2,
	EVENT_A_1,
	EVENT_A_2,
	EVENT_B_1,
	FARMER_A_ID,
	FARMER_B_ID,
	FARM_A,
	FARM_A_VIEWER,
	FARM_B,
	FARM_ROW_A,
	MEMBERSHIP_FARMER_A,
	ORG_A_ID,
	ORG_A_SCOPE,
	ORG_B_ID,
	PLATFORM_ADMIN_A_ID,
	POND_A_1,
	POND_A_2,
	POND_B_1,
	VIEWER_A_ID,
	expectNoCrossOrgAccess,
	membershipFor,
	userById,
} from "./helpers/tenancy";

const mockUser = vi.mocked(getCurrentUser);
const mockDeleteSubtree = vi.mocked(deleteUserSubtree);

function tenancy(): TenancyDb {
	if (!holder.db) throw new Error("tenancy database was not initialised");
	return holder.db;
}

function signInAs(userId: string) {
	mockUser.mockResolvedValue(userById(tenancy(), userId) as never);
}

beforeEach(() => {
	vi.clearAllMocks();
	tenancy().reset();
	auth.createUser.mockReset().mockResolvedValue({
		data: { user: { id: "sb-new-user" } },
		error: null,
	});
	auth.deleteUser.mockReset().mockResolvedValue({ data: {}, error: null });
	signInAs(ADMIN_A_ID);
});

describe("tenant reads stay inside the caller's organization", () => {
	it("getUsers returns org A members only and hides platform admins", async () => {
		const users = await expectNoCrossOrgAccess(() => getUsers());

		expect(users.map((user) => user.id).sort()).toEqual(
			[ADMIN_A_ID, FARMER_A_ID, VIEWER_A_ID].sort(),
		);
		expect(users.some((user) => user.id === PLATFORM_ADMIN_A_ID)).toBe(false);
		// Farm is included for a farmer and absent for an admin with no farm row.
		expect(users.find((user) => user.id === FARMER_A_ID)?.farm?.name).toBe("Farm A");
		expect(users.find((user) => user.id === ADMIN_A_ID)?.farm).toBeNull();
	});

	it("getPonds returns only ponds owned by org A members", async () => {
		const ponds = await expectNoCrossOrgAccess(() => getPonds());

		expect(ponds.map((pond) => pond.id).sort()).toEqual([POND_A_1, POND_A_2].sort());
		expect(ponds.every((pond) => pond.ownerId === FARM_A)).toBe(true);
	});

	it("getDevices lists org A hardware without selecting a credential", async () => {
		const devices = await expectNoCrossOrgAccess(() => getDevices());

		expect(devices.map((device) => device.id).sort()).toEqual([DEVICE_A_1, DEVICE_A_2].sort());
		for (const device of devices) {
			expect(device).not.toHaveProperty("token");
			expect(device).not.toHaveProperty("tokenHash");
		}
		expect(JSON.stringify(devices)).not.toContain("tok_SECRET");
	});

	it("getAllFarmHierarchies maps only org A users, farms, ponds and devices", async () => {
		const hierarchies = await expectNoCrossOrgAccess(() => getAllFarmHierarchies());

		expect(hierarchies.map((node) => node.user.id).sort()).toEqual(
			[ADMIN_A_ID, FARMER_A_ID, VIEWER_A_ID].sort(),
		);
		const farmer = hierarchies.find((node) => node.user.id === FARMER_A_ID);
		expect(farmer?.farm?.id).toBe(FARM_ROW_A);
		expect(farmer?.ponds.map((pond) => pond.id).sort()).toEqual([POND_A_1, POND_A_2].sort());
		expect(farmer?.ponds.flatMap((pond) => pond.devices.map((device) => device.id)).sort()).toEqual(
			[DEVICE_A_1, DEVICE_A_2].sort(),
		);
	});

	it("getAdminStats counts only the caller's tenant and recent events", async () => {
		const stats = await expectNoCrossOrgAccess(() => getAdminStats());

		// Three tenant members; the platform admin's org A membership is excluded.
		expect(stats.userCount).toBe(3);
		expect(stats.pondCount).toBe(2);
		expect(stats.deviceCount).toBe(2);
		expect(stats.recentEvents.map((event) => event.id)).toEqual([EVENT_A_2, EVENT_A_1]);
		expect(stats.recentEvents.some((event) => event.id === EVENT_B_1)).toBe(false);
	});

	it("getAuditLog pages only org A device events", async () => {
		const events = await expectNoCrossOrgAccess(() => getAuditLog());

		expect(events.map((event) => event.id)).toEqual([EVENT_A_2, EVENT_A_1]);
		expect(events.every((event) => event.device?.mac !== "11:22:33:44:55:66")).toBe(true);
	});

	it("getUserPermissionState treats an org B member as outside the organization", async () => {
		const foreign = await expectNoCrossOrgAccess(() => getUserPermissionState(FARMER_B_ID));
		expect(foreign).toEqual({
			success: false,
			error: "That user is outside your organization.",
		});

		const allowed = await getUserPermissionState(FARMER_A_ID);
		expect(allowed).toMatchObject({ success: true, role: "OPERATOR", overrides: [] });
		if (!allowed.success) throw new Error("expected an allowed read");
		expect(allowed.defaults).toContain("view_dashboard");
		expect(allowed.defaults).not.toContain("manage_members");
	});
});

describe("tenant writes refuse an org B target and change nothing", () => {
	it("updateUser refuses an org B user and leaves org B untouched", async () => {
		const result = await expectNoCrossOrgAccess(() =>
			updateUser(FARMER_B_ID, { displayName: "Hijacked" }),
		);

		expect(result).toEqual({ error: "That user is outside your organization." });
		expect(userById(tenancy(), FARMER_B_ID).displayName).toBe("Farmer B");
	});

	it("updateUser still allows an org A user and never touches the legacy role", async () => {
		const result = await updateUser(FARMER_A_ID, { displayName: "Farmer A Renamed" });

		expect(result).toEqual({ success: true });
		const updated = userById(tenancy(), FARMER_A_ID);
		expect(updated.displayName).toBe("Farmer A Renamed");
		expect(updated.role).toBe("OPERATOR");
	});

	it("updateUser refuses to edit a platform administrator", async () => {
		const result = await updateUser(PLATFORM_ADMIN_A_ID, { displayName: "Nope" });

		expect(result).toEqual({
			error: "Platform administrators must be managed from the platform console.",
		});
		expect(userById(tenancy(), PLATFORM_ADMIN_A_ID).displayName).toBe("Platform Admin A");
	});

	it("deleteUser refuses an org B user before touching Supabase", async () => {
		const result = await expectNoCrossOrgAccess(() => deleteUser(FARMER_B_ID));

		expect(result).toEqual({ error: "That user is outside your organization." });
		expect(auth.deleteUser).not.toHaveBeenCalled();
		expect(mockDeleteSubtree).not.toHaveBeenCalled();
		expect(tenancy().tables.users.some((user) => user.id === FARMER_B_ID)).toBe(true);
	});

	it("deleteUser refuses to delete the acting admin", async () => {
		const result = await deleteUser(ADMIN_A_ID);

		expect(result).toEqual({ error: "You cannot delete your own account." });
		expect(auth.deleteUser).not.toHaveBeenCalled();
	});

	it("deleteUser deletes an org A farmer only, in the Supabase-first order", async () => {
		const result = await deleteUser(FARMER_A_ID);

		expect(result).toEqual({ success: true });
		expect(auth.deleteUser).toHaveBeenCalledWith("sb-farmer-a");
		expect(mockDeleteSubtree).toHaveBeenCalledWith(expect.anything(), FARMER_A_ID, FARM_A);
		expect(tenancy().tables.users.some((user) => user.id === FARMER_B_ID)).toBe(true);
	});

	it("setUserPermission refuses an org B member and writes no override", async () => {
		const result = await expectNoCrossOrgAccess(() =>
			setUserPermission(FARMER_B_ID, "control_feeder", false),
		);

		expect(result).toEqual({
			success: false,
			error: "That user is outside your organization.",
		});
		expect(tenancy().tables.membershipPermissions).toHaveLength(0);
	});

	it("setUserPermission revokes an org A member's permission in that membership only", async () => {
		const result = await setUserPermission(FARMER_A_ID, "control_feeder", false);

		expect(result).toMatchObject({ success: true, role: "OPERATOR" });
		const rows = tenancy().tables.membershipPermissions;
		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({
			membershipId: MEMBERSHIP_FARMER_A,
			permission: "control_feeder",
		});
		expect(rows[0].revokedAt).toBeInstanceOf(Date);
		expect(membershipFor(tenancy(), FARMER_B_ID).map((row) => row.id)).not.toContain(
			rows[0].membershipId,
		);
	});

	it("setUserPermission keeps the self-lockout guard", async () => {
		const result = await setUserPermission(ADMIN_A_ID, "manage_members", false);

		expect(result).toEqual({
			success: false,
			error: "You cannot remove your own permission to manage members.",
		});
		expect(tenancy().tables.membershipPermissions).toHaveLength(0);
	});

	it("setUserPermission rejects an unknown permission name", async () => {
		const result = await setUserPermission(FARMER_A_ID, "root_everything", true);

		expect(result).toEqual({ success: false, error: "Unknown permission." });
		expect(tenancy().tables.membershipPermissions).toHaveLength(0);
	});

	it("createPond refuses an org B farm and creates nothing", async () => {
		const before = tenancy().tables.ponds.length;
		const result = await expectNoCrossOrgAccess(() =>
			createPond({
				name: "Shadow Pond",
				ownerFarmId: FARM_B,
				feedingRatePct: 3,
				feedsPerDay: 2,
				scheduleStart: "06:00",
				scheduleEnd: "18:00",
			}),
		);

		expect(result).toEqual({ error: "That farm is outside your organization." });
		expect(tenancy().tables.ponds).toHaveLength(before);
	});

	it("createPond creates an org A pond on the org A farm", async () => {
		const result = await createPond({
			name: "Pond A Three",
			ownerFarmId: FARM_A,
			feedingRatePct: 3,
			feedsPerDay: 2,
			scheduleStart: "06:00",
			scheduleEnd: "18:00",
		});

		expect(result).toMatchObject({ success: true });
		if (!("success" in result)) throw new Error("expected creation");
		const pond = tenancy().tables.ponds.find((row) => row.id === result.pondId);
		expect(pond?.ownerId).toBe(FARM_A);
		expect(pond?.farmId).toBe(FARM_ROW_A);
	});

	it("createPondWithFarmer always attaches the new account to the caller's org", async () => {
		const result = await createPondWithFarmer({
			farmerName: "New Farmer",
			loginId: "new-farmer-a",
			password: "temp-pass-1",
			pondName: "New Farmer Pond",
			feedingRatePct: 3,
			feedsPerDay: 2,
			scheduleStart: "06:00",
			scheduleEnd: "18:00",
		});

		expect(result).toMatchObject({ success: true });
		if (!("success" in result)) throw new Error("expected creation");
		const user = tenancy().tables.users.find((row) => row.id === result.userId);
		expect(user).toMatchObject({
			farmId: "new-farmer-a",
			role: "OPERATOR",
			email: "new-farmer-a@pond.optifeed.local",
		});
		const memberships = membershipFor(tenancy(), result.userId);
		expect(memberships).toHaveLength(1);
		expect(memberships[0]).toMatchObject({ orgId: ORG_A_ID, role: "OPERATOR" });
		expect(memberships.some((row) => row.orgId === ORG_B_ID)).toBe(false);
		const pond = tenancy().tables.ponds.find((row) => row.id === result.pondId);
		expect(pond?.ownerId).toBe("new-farmer-a");
	});

	it("updatePondOwner refuses either end of a cross-org move", async () => {
		const fromB = await expectNoCrossOrgAccess(() => updatePondOwner(POND_B_1, FARM_A));
		expect(fromB).toEqual({ error: "That pond is outside your organization." });

		const toB = await expectNoCrossOrgAccess(() => updatePondOwner(POND_A_1, FARM_B));
		expect(toB).toEqual({ error: "That farm is outside your organization." });

		expect(tenancy().tables.ponds.find((pond) => pond.id === POND_A_1)?.ownerId).toBe(FARM_A);
		expect(tenancy().tables.ponds.find((pond) => pond.id === POND_B_1)?.ownerId).toBe(FARM_B);
	});

	it("updatePondOwner moves an org A pond to another org A farm", async () => {
		const result = await updatePondOwner(POND_A_1, FARM_A_VIEWER);

		expect(result).toEqual({ success: true });
		const pond = tenancy().tables.ponds.find((row) => row.id === POND_A_1);
		expect(pond?.ownerId).toBe(FARM_A_VIEWER);
		const farm = tenancy().tables.farms.find((row) => row.id === pond?.farmId);
		expect(farm?.ownerId).toBe(FARM_A_VIEWER);
		// Org B is untouched by the move.
		expect(tenancy().tables.ponds.find((row) => row.id === POND_B_1)?.ownerId).toBe(FARM_B);
	});
});

describe("tenancy harness self-checks", () => {
	it("resolves the same scope the real resolver must produce", async () => {
		const { resolveOrgScope } = await import("@/lib/auth/org-scope");

		expect(await resolveOrgScope()).toEqual(ORG_A_SCOPE);
	});

	it("fails when a foreign identifier is present", async () => {
		// The guard is only useful if the fixture can actually trip it.
		await expect(expectNoCrossOrgAccess(async () => tenancy().tables.ponds)).rejects.toThrow(
			/foreign org identifier leaked/,
		);
	});
});
