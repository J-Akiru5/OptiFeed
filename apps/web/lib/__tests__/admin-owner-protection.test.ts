import {
	ADMIN_EDIT_OWNER_MESSAGE,
	ADMIN_EDIT_OWNER_PERMISSION_MESSAGE,
	ADMIN_REMOVE_OWNER_MESSAGE,
} from "@/lib/auth/member-rules";
import type { MemberRole } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	ADMIN_A_ID,
	FARMER_A_ID,
	MEMBERSHIP_FARMER_A,
	ORG_A_ID,
	type TenancyDb,
	VIEWER_A_ID,
	userById,
} from "./helpers/tenancy";

/**
 * #584: a tenant ADMIN must not delete, demote, revoke or strip an OWNER.
 *
 * The rule already existed in `lib/auth/member-rules.ts` and was enforced by
 * `changeMemberRole` / `revokeMember`; `deleteUser` and `setUserPermission`
 * bypassed it. These tests call the actions directly (not through the UI), with
 * the real scope and permission guards running against the two-org fixture.
 */

const holder = vi.hoisted(() => ({ db: undefined as TenancyDb | undefined }));
const auth = vi.hoisted(() => ({
	createUser: vi.fn(),
	deleteUser: vi.fn(),
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

vi.mock("next-intl/server", () => ({ getLocale: vi.fn(async () => "en") }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { changeMemberRole, deleteUser, revokeMember, setUserPermission } from "@/lib/actions/admin";
import { deleteUserSubtree } from "@/lib/actions/admin-internal";
import { getCurrentUser } from "@/lib/auth/session";
import prisma from "@/lib/prisma";

const mockUser = vi.mocked(getCurrentUser);
const mockDeleteSubtree = vi.mocked(deleteUserSubtree);

function tenancy(): TenancyDb {
	if (!holder.db) throw new Error("tenancy database was not initialised");
	return holder.db;
}

function signInAs(userId: string) {
	mockUser.mockResolvedValue(userById(tenancy(), userId) as never);
}

/** Change the fixture's role for an org A membership, as another path would. */
function setOrgARole(userId: string, role: MemberRole) {
	const membership = tenancy().tables.memberships.find(
		(row) => row.userId === userId && row.orgId === ORG_A_ID,
	);
	if (!membership) throw new Error(`no org A membership for ${userId}`);
	membership.role = role;
}

beforeEach(() => {
	vi.clearAllMocks();
	tenancy().reset();
	auth.deleteUser.mockReset().mockResolvedValue({ data: {}, error: null });
	signInAs(ADMIN_A_ID);
});

describe("deleteUser refuses an OWNER target (#584)", () => {
	it("an ADMIN cannot delete an OWNER", async () => {
		// ADMIN_A is the fixture's org A OWNER; demote the caller to ADMIN and
		// promote the viewer so the target is a second OWNER.
		setOrgARole(ADMIN_A_ID, "ADMIN");
		setOrgARole(VIEWER_A_ID, "OWNER");

		const result = await deleteUser(VIEWER_A_ID);

		expect(result).toEqual({ error: ADMIN_REMOVE_OWNER_MESSAGE });
		expect(auth.deleteUser).not.toHaveBeenCalled();
		expect(mockDeleteSubtree).not.toHaveBeenCalled();
		expect(tenancy().tables.users.some((user) => user.id === VIEWER_A_ID)).toBe(true);
	});

	it("the refusal happens before the Supabase deletion, so the login survives", async () => {
		setOrgARole(ADMIN_A_ID, "ADMIN");
		setOrgARole(VIEWER_A_ID, "OWNER");

		await deleteUser(VIEWER_A_ID);

		expect(auth.deleteUser).not.toHaveBeenCalled();
	});
});

describe("deleteUser still allows downward management (#584)", () => {
	it("an OWNER can delete an ADMIN", async () => {
		setOrgARole(VIEWER_A_ID, "ADMIN");

		expect(await deleteUser(VIEWER_A_ID)).toEqual({ success: true });
		expect(auth.deleteUser).toHaveBeenCalledWith("sb-viewer-a");
		expect(mockDeleteSubtree).toHaveBeenCalled();
	});

	it("an ADMIN can delete an OPERATOR", async () => {
		setOrgARole(ADMIN_A_ID, "ADMIN");

		expect(await deleteUser(FARMER_A_ID)).toEqual({ success: true });
		expect(auth.deleteUser).toHaveBeenCalledWith("sb-farmer-a");
	});
});

describe("the other membership mutations keep the same boundary (#584)", () => {
	it("an ADMIN cannot demote an OWNER", async () => {
		setOrgARole(ADMIN_A_ID, "ADMIN");
		setOrgARole(VIEWER_A_ID, "OWNER");

		expect(await changeMemberRole(VIEWER_A_ID, "VIEWER")).toEqual({
			error: ADMIN_EDIT_OWNER_MESSAGE,
		});
	});

	it("an ADMIN cannot revoke an OWNER", async () => {
		setOrgARole(ADMIN_A_ID, "ADMIN");
		setOrgARole(VIEWER_A_ID, "OWNER");

		expect(await revokeMember(VIEWER_A_ID)).toEqual({ error: ADMIN_REMOVE_OWNER_MESSAGE });
	});

	it("an ADMIN cannot strip an OWNER's permissions", async () => {
		setOrgARole(ADMIN_A_ID, "ADMIN");
		setOrgARole(VIEWER_A_ID, "OWNER");

		const result = await setUserPermission(VIEWER_A_ID, "manage_members", false);

		expect(result).toEqual({
			success: false,
			error: ADMIN_EDIT_OWNER_PERMISSION_MESSAGE,
		});
		expect(
			tenancy().tables.membershipPermissions.some(
				(row) => row.membershipId === MEMBERSHIP_FARMER_A,
			),
		).toBe(false);
	});

	it("an OWNER may still change an ADMIN's permissions", async () => {
		setOrgARole(VIEWER_A_ID, "ADMIN");

		const result = await setUserPermission(VIEWER_A_ID, "control_feeder", false);

		expect(result).toMatchObject({ success: true, role: "ADMIN" });
	});
});

describe("the guard runs inside the locking transaction (#584)", () => {
	it("takes a FOR UPDATE lock on the target's memberships before deleting", async () => {
		const rawQuery = vi.spyOn(
			prisma as unknown as { $queryRaw: (...args: unknown[]) => unknown },
			"$queryRaw",
		);

		expect(await deleteUser("user-farmer-a")).toEqual({ success: true });

		expect(rawQuery).toHaveBeenCalled();
		const [strings] = rawQuery.mock.calls[0] as unknown as [TemplateStringsArray];
		expect(strings.join("?")).toContain("FOR UPDATE");
		expect(strings.join("?")).toContain('"Membership"');
		rawQuery.mockRestore();
	});
});
