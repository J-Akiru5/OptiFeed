import { beforeEach, describe, expect, it, vi } from "vitest";

const { db, tx } = vi.hoisted(() => {
	const tx = {
		membership: { count: vi.fn(), update: vi.fn() },
		membershipPermission: { deleteMany: vi.fn(), findUnique: vi.fn(), upsert: vi.fn() },
	};
	const db = {
		membership: { findFirst: vi.fn(), findMany: vi.fn(), count: vi.fn(), update: vi.fn() },
		user: { findMany: vi.fn() },
		organization: { findMany: vi.fn() },
		membershipPermission: { findMany: vi.fn() },
		platformAdmin: { findFirst: vi.fn(), findMany: vi.fn() },
		$transaction: vi.fn(),
	};
	return { db, tx };
});

vi.mock("@/lib/prisma", () => ({ default: db }));
vi.mock("@/lib/auth/tenant-admin", () => ({
	requireTenantAdmin: vi.fn(),
	TENANT_ADMIN_ROLES: ["OWNER", "ADMIN"],
}));
vi.mock("@/lib/auth/org-scope", () => ({ resolveOrgScope: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({
	buildPondEmail: vi.fn((farmId: string) => `${farmId}@pond.optifeed.local`),
	getCurrentUser: vi.fn(),
}));
vi.mock("@/lib/auth/session-cache", () => ({ invalidateFarm: vi.fn() }));
vi.mock("@/lib/auth/password", () => ({
	passwordErrorMessage: vi.fn(),
	validatePassword: vi.fn(),
}));
vi.mock("@/lib/auth/permissions", () => ({
	ROLE_DEFAULTS: { OWNER: [], ADMIN: [], OPERATOR: [], VIEWER: [] },
	effectivePermissions: vi.fn(() => new Set()),
	isPermission: vi.fn(() => true),
	requirePermission: vi.fn(),
}));
vi.mock("@/lib/membership-invite", () => ({ inviteOrAttachMember: vi.fn() }));
vi.mock("@/lib/actions/admin-internal", () => ({ deleteUserSubtree: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/rate-limit", () => ({ checkDeviceTokenRevealRateLimit: vi.fn() }));
vi.mock("@/i18n/routing", () => ({ redirect: vi.fn() }));
vi.mock("next-intl/server", () => ({ getLocale: vi.fn().mockResolvedValue("en") }));

import { changeMemberRole, inviteMember, revokeMember } from "@/lib/actions/admin";
import { resolveOrgScope } from "@/lib/auth/org-scope";
import { requirePermission } from "@/lib/auth/permissions";
import { getCurrentUser } from "@/lib/auth/session";
import { requireTenantAdmin } from "@/lib/auth/tenant-admin";
import { inviteOrAttachMember } from "@/lib/membership-invite";
import type { MemberRole } from "@prisma/client";

const mockRequireTenantAdmin = vi.mocked(requireTenantAdmin);
const mockRequirePermission = vi.mocked(requirePermission);
const mockResolveOrgScope = vi.mocked(resolveOrgScope);
const mockGetCurrentUser = vi.mocked(getCurrentUser);
const mockInvite = vi.mocked(inviteOrAttachMember);

const SCOPE = {
	orgIds: ["org-a"],
	memberUserIds: ["u-admin", "u-target"],
	farmIds: [],
	pondIds: [],
};

const ADMIN = { id: "u-admin" } as Awaited<ReturnType<typeof getCurrentUser>>;

/** Target membership u-target with a given role; caller is OWNER unless overridden. */
function allowTarget(role: MemberRole, actorRole: MemberRole = "OWNER") {
	db.membership.findFirst.mockImplementation(async (args: { where: { userId?: string } }) => {
		const userId = args.where.userId;
		if (userId === "u-target") {
			return { id: "m-target", orgId: "org-a", userId: "u-target", role };
		}
		if (userId === "u-admin") {
			return { id: "m-admin", orgId: "org-a", userId: "u-admin", role: actorRole };
		}
		return null;
	});
}

beforeEach(() => {
	vi.clearAllMocks();
	mockRequireTenantAdmin.mockResolvedValue(undefined);
	mockRequirePermission.mockResolvedValue(undefined);
	mockResolveOrgScope.mockResolvedValue(SCOPE);
	mockGetCurrentUser.mockResolvedValue(ADMIN);
	db.membership.findFirst.mockResolvedValue(null);
	db.membership.count.mockResolvedValue(2);
	db.platformAdmin.findFirst.mockResolvedValue(null);
	db.$transaction.mockImplementation(async (fn: (client: typeof tx) => Promise<unknown>) => fn(tx));
	tx.membership.count.mockResolvedValue(2);
	tx.membership.update.mockResolvedValue({});
});

describe("tenant member guards", () => {
	it("denies an OPERATOR/VIEWER caller before any database read", async () => {
		mockRequireTenantAdmin.mockRejectedValueOnce(new Error("NEXT_REDIRECT"));

		await expect(changeMemberRole("u-target", "ADMIN")).rejects.toThrow("NEXT_REDIRECT");
		expect(db.membership.findFirst).not.toHaveBeenCalled();
		expect(tx.membership.update).not.toHaveBeenCalled();
	});

	it("denies a tenant admin whose manage_members permission was revoked", async () => {
		mockRequirePermission.mockRejectedValueOnce(new Error("Forbidden"));

		await expect(revokeMember("u-target")).rejects.toThrow("Forbidden");
		expect(db.membership.findFirst).not.toHaveBeenCalled();
	});

	it("refuses a target outside the caller's organization", async () => {
		mockResolveOrgScope.mockResolvedValue({ ...SCOPE, memberUserIds: ["u-admin"] });

		await expect(changeMemberRole("u-other", "ADMIN")).resolves.toEqual({
			error: "That user is outside your organization.",
		});
		expect(db.membership.findFirst).not.toHaveBeenCalled();
	});

	it("refuses a platform admin target", async () => {
		allowTarget("OPERATOR");
		db.platformAdmin.findFirst.mockResolvedValue({ id: "grant-1" });

		await expect(changeMemberRole("u-target", "ADMIN")).resolves.toEqual({
			error: "Platform administrators must be managed from the platform console.",
		});
		expect(tx.membership.update).not.toHaveBeenCalled();
	});
});

describe("tenant role changes", () => {
	it("lets an OWNER promote an OPERATOR to ADMIN", async () => {
		allowTarget("OPERATOR");

		await expect(changeMemberRole("u-target", "ADMIN")).resolves.toEqual({ success: true });
		expect(tx.membership.update).toHaveBeenCalledWith({
			where: { id: "m-target" },
			data: { role: "ADMIN" },
		});
	});

	it("refuses a member changing their own role", async () => {
		allowTarget("OWNER", "OWNER");

		await expect(changeMemberRole("u-admin", "ADMIN")).resolves.toEqual({
			error: "You cannot change your own role.",
		});
		expect(tx.membership.update).not.toHaveBeenCalled();
	});

	it("refuses an ADMIN promoting anyone to OWNER", async () => {
		allowTarget("OPERATOR", "ADMIN");

		await expect(changeMemberRole("u-target", "OWNER")).resolves.toEqual({
			error: "Only an owner can promote a member to owner.",
		});
		expect(tx.membership.update).not.toHaveBeenCalled();
	});

	it("refuses an ADMIN changing another OWNER's role", async () => {
		allowTarget("OWNER", "ADMIN");

		await expect(changeMemberRole("u-target", "ADMIN")).resolves.toEqual({
			error: "Only an owner can change another owner's role.",
		});
		expect(tx.membership.update).not.toHaveBeenCalled();
	});

	it("refuses demoting the last OWNER", async () => {
		allowTarget("OWNER");
		db.membership.count.mockResolvedValue(1);

		await expect(changeMemberRole("u-target", "ADMIN")).resolves.toEqual({
			error: "The last owner cannot be demoted or removed. Promote another owner first.",
		});
		expect(tx.membership.update).not.toHaveBeenCalled();
	});

	it("allows demoting an OWNER when another owner remains", async () => {
		allowTarget("OWNER");
		db.membership.count.mockResolvedValue(2);
		tx.membership.count.mockResolvedValue(2);

		await expect(changeMemberRole("u-target", "ADMIN")).resolves.toEqual({ success: true });
		expect(tx.membership.update).toHaveBeenCalledWith({
			where: { id: "m-target" },
			data: { role: "ADMIN" },
		});
	});
});

describe("tenant membership revocation", () => {
	it("revokes an OPERATOR membership", async () => {
		allowTarget("OPERATOR");

		await expect(revokeMember("u-target")).resolves.toEqual({ success: true });
		expect(tx.membership.update).toHaveBeenCalledWith({
			where: { id: "m-target" },
			data: { revokedAt: expect.any(Date) },
		});
	});

	it("refuses revoking your own membership", async () => {
		allowTarget("OWNER");

		await expect(revokeMember("u-admin")).resolves.toEqual({
			error: "You cannot revoke your own membership.",
		});
		expect(tx.membership.update).not.toHaveBeenCalled();
	});

	it("refuses removing the last OWNER", async () => {
		allowTarget("OWNER");
		db.membership.count.mockResolvedValue(1);

		await expect(revokeMember("u-target")).resolves.toEqual({
			error: "The last owner cannot be demoted or removed. Promote another owner first.",
		});
		expect(tx.membership.update).not.toHaveBeenCalled();
	});

	it("refuses an ADMIN removing another OWNER", async () => {
		allowTarget("OWNER", "ADMIN");

		await expect(revokeMember("u-target")).resolves.toEqual({
			error: "Only an owner can remove another owner.",
		});
		expect(tx.membership.update).not.toHaveBeenCalled();
	});
});

describe("tenant invites", () => {
	it("refuses an ADMIN inviting an OWNER", async () => {
		allowTarget("OPERATOR", "ADMIN");

		await expect(
			inviteMember({ email: "new@example.com", displayName: "New Member", role: "OWNER" }),
		).resolves.toEqual({ error: "Only an owner can invite another owner." });
		expect(mockInvite).not.toHaveBeenCalled();
	});

	it("refuses an organization outside the caller's scope", async () => {
		allowTarget("OPERATOR");

		await expect(
			inviteMember({
				orgId: "org-b",
				email: "new@example.com",
				displayName: "New Member",
				role: "OPERATOR",
			}),
		).resolves.toEqual({ error: "That organization is outside your scope." });
		expect(mockInvite).not.toHaveBeenCalled();
	});

	it("invites into the caller's organization and returns the one-time password", async () => {
		allowTarget("OPERATOR");
		mockInvite.mockResolvedValue({
			success: true,
			membershipId: "m-new",
			userId: "u-new",
			loginEmail: "new@pond.optifeed.local",
			temporaryPassword: "TempPass123",
			createdUser: true,
		});

		await expect(
			inviteMember({ email: "new@example.com", displayName: "New Member", role: "OPERATOR" }),
		).resolves.toEqual({
			success: true,
			membershipId: "m-new",
			userId: "u-new",
			loginEmail: "new@pond.optifeed.local",
			temporaryPassword: "TempPass123",
			createdUser: true,
		});

		expect(mockInvite).toHaveBeenCalledWith({
			orgId: "org-a",
			email: "new@example.com",
			displayName: "New Member",
			role: "OPERATOR",
			invitedBy: "u-admin",
			refusePlatformAdminTarget: true,
		});
	});

	it("passes a helper failure through without inventing a password", async () => {
		allowTarget("OPERATOR");
		mockInvite.mockResolvedValue({ success: false, error: "That account is already a member." });

		await expect(
			inviteMember({ email: "new@example.com", displayName: "New Member", role: "OPERATOR" }),
		).resolves.toEqual({ error: "That account is already a member." });
	});
});
