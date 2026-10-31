import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The platform org-detail read is the screen an admin uses before changing a
 * stranger's membership, so the member projection is asserted field by field:
 * effective permissions with overrides applied, revoked rows shown as denied,
 * unknown permission names ignored, and the platform-admin flag. The mutation
 * error paths prove that a failed write reports a failure and writes no audit.
 */

const { db, tx, STEP_UP_AT } = vi.hoisted(() => {
	const STEP_UP_AT = new Date("2026-10-26T00:00:00.000Z");
	const tx = {
		membership: { update: vi.fn() },
		membershipPermission: { findUnique: vi.fn(), upsert: vi.fn() },
		platformAuditLog: { create: vi.fn() },
	};
	const db = {
		organization: { findUnique: vi.fn() },
		membership: { findUnique: vi.fn(), findMany: vi.fn() },
		membershipPermission: { findMany: vi.fn() },
		user: { findMany: vi.fn() },
		platformAdmin: { findUnique: vi.fn(), findMany: vi.fn() },
		$transaction: vi.fn(),
	};
	return { db, tx, STEP_UP_AT };
});

vi.mock("@/lib/prisma", () => ({ default: db }));
vi.mock("@/lib/auth/require-platform-admin", () => ({ requirePlatformAdmin: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ getCurrentUser: vi.fn() }));
vi.mock("@/lib/auth/step-up", () => ({
	withStepUp: vi.fn(async (action: (stepUpAt: Date) => Promise<unknown>) => action(STEP_UP_AT)),
	isStepUpRequiredError: (error: unknown) =>
		typeof error === "object" &&
		error !== null &&
		(error as { code?: unknown }).code === "step_up_required",
}));
vi.mock("@/lib/avatars", () => ({ getSignedAvatarUrls: vi.fn() }));
vi.mock("@/lib/membership-invite", () => ({ inviteOrAttachMember: vi.fn() }));
vi.mock("@/lib/notify/invite-email", () => ({ deliverMemberInviteEmail: vi.fn() }));
vi.mock("next/headers", () => ({ headers: vi.fn() }));

import {
	changeOrgMemberRole,
	getOrgDetail,
	inviteOrgMember,
	setOrgMemberPermission,
} from "@/lib/actions/platform/members";
import { requirePlatformAdmin } from "@/lib/auth/require-platform-admin";
import { getCurrentUser } from "@/lib/auth/session";
import { getSignedAvatarUrls } from "@/lib/avatars";
import { inviteOrAttachMember } from "@/lib/membership-invite";
import { headers } from "next/headers";

const mockGate = vi.mocked(requirePlatformAdmin);
const mockUser = vi.mocked(getCurrentUser);
const mockAvatars = vi.mocked(getSignedAvatarUrls);
const mockInvite = vi.mocked(inviteOrAttachMember);
const mockHeaders = vi.mocked(headers);
const REASON = "Owner asked us to correct a wrong role after a staff handover";

const ORG = { id: "org-a", name: "Org A", type: "COOPERATIVE", status: "ACTIVE", parentId: null };

beforeEach(() => {
	vi.clearAllMocks();
	mockGate.mockResolvedValue(undefined);
	mockUser.mockResolvedValue({
		id: "admin-1",
		displayName: "Platform Admin",
		farmId: "platform",
	} as Awaited<ReturnType<typeof getCurrentUser>>);
	mockHeaders.mockResolvedValue(
		new Headers({ "x-forwarded-for": "203.0.113.9, 10.0.0.1", "user-agent": "vitest" }),
	);
	db.$transaction.mockImplementation(async (fn: (client: typeof tx) => Promise<unknown>) => fn(tx));
	db.organization.findUnique.mockResolvedValue(ORG);
	db.membership.findMany.mockResolvedValue([]);
	db.membershipPermission.findMany.mockResolvedValue([]);
	db.user.findMany.mockResolvedValue([]);
	db.platformAdmin.findMany.mockResolvedValue([]);
	db.platformAdmin.findUnique.mockResolvedValue({ expiresAt: null });
	db.membership.findUnique.mockResolvedValue(null);
	tx.platformAuditLog.create.mockResolvedValue({});
	mockAvatars.mockResolvedValue({});
});

describe("getOrgDetail", () => {
	it("returns null for a blank id without reading anything", async () => {
		await expect(getOrgDetail("   ")).resolves.toBeNull();
		expect(db.organization.findUnique).not.toHaveBeenCalled();
	});

	it("returns null for an unknown organization", async () => {
		db.organization.findUnique.mockResolvedValue(null);

		await expect(getOrgDetail("org-missing")).resolves.toBeNull();
		expect(db.membership.findMany).not.toHaveBeenCalled();
	});

	it("returns the org with an empty member list when nobody is active", async () => {
		await expect(getOrgDetail("org-a")).resolves.toEqual({ org: ORG, members: [] });
		expect(db.membership.findMany).toHaveBeenCalledWith({
			where: { orgId: "org-a", revokedAt: null },
			orderBy: { createdAt: "asc" },
			select: { id: true, userId: true, role: true, createdAt: true },
		});
		expect(db.user.findMany).not.toHaveBeenCalled();
	});

	it("projects role defaults, overrides and the platform-admin flag", async () => {
		db.membership.findMany.mockResolvedValue([
			{
				id: "m-1",
				userId: "u-1",
				role: "OPERATOR",
				createdAt: new Date("2026-01-02T00:00:00.000Z"),
			},
			{
				id: "m-2",
				userId: "u-2",
				role: "VIEWER",
				createdAt: new Date("2026-01-03T00:00:00.000Z"),
			},
		]);
		db.user.findMany.mockResolvedValue([
			{
				id: "u-1",
				farmId: "farm-1",
				email: "op@example.com",
				displayName: "Operator",
				avatarPath: "a/1",
			},
			{
				id: "u-2",
				farmId: "farm-2",
				email: "viewer@example.com",
				displayName: null,
				avatarPath: null,
			},
		]);
		db.membershipPermission.findMany.mockResolvedValue([
			{ membershipId: "m-1", permission: "control_feeder", revokedAt: new Date() },
			{ membershipId: "m-1", permission: "view_reports", revokedAt: null },
			{ membershipId: "m-1", permission: "not_a_permission", revokedAt: null },
			{ membershipId: "m-2", permission: "manage_schedule", revokedAt: null },
		]);
		db.platformAdmin.findMany.mockResolvedValue([{ userId: "u-2" }]);
		mockAvatars.mockResolvedValue({ "u-1": "https://signed/1" });

		const detail = await getOrgDetail("org-a");

		const operator = detail?.members.find((member) => member.userId === "u-1");
		const viewer = detail?.members.find((member) => member.userId === "u-2");

		expect(operator).toMatchObject({
			membershipId: "m-1",
			farmId: "farm-1",
			email: "op@example.com",
			displayName: "Operator",
			joinedAt: new Date("2026-01-02T00:00:00.000Z"),
			avatarUrl: "https://signed/1",
			isPlatformAdmin: false,
		});
		// OPERATOR keeps its defaults, loses the revoked control_feeder grant, and
		// gains the explicit view_reports row.
		expect(operator?.permissions).toEqual([
			"claim_feeder",
			"manage_crop_cycle",
			"manage_schedule",
			"view_dashboard",
			"view_reports",
		]);
		expect(operator?.overrides).toEqual([
			{ permission: "control_feeder", granted: false },
			{ permission: "view_reports", granted: true },
		]);
		expect(viewer).toMatchObject({ avatarUrl: null, isPlatformAdmin: true });
		expect(viewer?.permissions).toEqual(["manage_schedule", "view_dashboard", "view_reports"]);
		expect(viewer?.overrides).toEqual([{ permission: "manage_schedule", granted: true }]);
	});

	it("skips a membership whose account no longer exists", async () => {
		db.membership.findMany.mockResolvedValue([
			{ id: "m-1", userId: "u-gone", role: "OPERATOR", createdAt: new Date() },
		]);
		db.user.findMany.mockResolvedValue([]);

		const detail = await getOrgDetail("org-a");

		expect(detail?.members).toEqual([]);
		expect(mockAvatars).toHaveBeenCalledWith([]);
	});

	it("only considers unrevoked platform grants", async () => {
		db.membership.findMany.mockResolvedValue([
			{ id: "m-1", userId: "u-1", role: "ADMIN", createdAt: new Date() },
		]);
		db.user.findMany.mockResolvedValue([
			{ id: "u-1", farmId: "farm-1", email: "a@b.c", displayName: null, avatarPath: null },
		]);

		await getOrgDetail("org-a");

		expect(db.platformAdmin.findMany).toHaveBeenCalledWith({
			where: { userId: { in: ["u-1"] }, revokedAt: null },
			select: { userId: true },
		});
	});
});

describe("mutation guards", () => {
	it("rejects an unknown role before reading the membership", async () => {
		await expect(
			changeOrgMemberRole({
				orgId: "org-a",
				userId: "u-1",
				role: "SUPERUSER" as never,
				reason: REASON,
			}),
		).resolves.toEqual({ error: "Choose a valid role." });
		expect(db.membership.findUnique).not.toHaveBeenCalled();
	});

	it("rejects a user with no active membership", async () => {
		db.membership.findUnique.mockResolvedValue({ id: "m-1", revokedAt: new Date() });

		await expect(
			changeOrgMemberRole({ orgId: "org-a", userId: "u-1", role: "ADMIN", reason: REASON }),
		).resolves.toEqual({
			error: "That account has no active membership in this organization.",
		});
		expect(tx.membership.update).not.toHaveBeenCalled();
	});

	it("is a no-op when the member already holds the role", async () => {
		db.membership.findUnique.mockResolvedValue({
			id: "m-1",
			orgId: "org-a",
			userId: "u-1",
			role: "ADMIN",
			revokedAt: null,
		});

		await expect(
			changeOrgMemberRole({ orgId: "org-a", userId: "u-1", role: "ADMIN", reason: REASON }),
		).resolves.toEqual({ success: true });
		expect(db.$transaction).not.toHaveBeenCalled();
		expect(tx.platformAuditLog.create).not.toHaveBeenCalled();
	});

	it("reports a failed role change without an audit row", async () => {
		const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
		db.membership.findUnique.mockResolvedValue({
			id: "m-1",
			orgId: "org-a",
			userId: "u-1",
			role: "OPERATOR",
			revokedAt: null,
		});
		db.$transaction.mockRejectedValueOnce(new Error("write conflict"));

		await expect(
			changeOrgMemberRole({ orgId: "org-a", userId: "u-1", role: "ADMIN", reason: REASON }),
		).resolves.toEqual({ error: "Failed to update the role." });
		expect(tx.platformAuditLog.create).not.toHaveBeenCalled();
		spy.mockRestore();
	});

	it("still writes the audit row when the request headers are unavailable", async () => {
		mockHeaders.mockRejectedValueOnce(new Error("outside a request scope"));
		db.membership.findUnique.mockResolvedValue({
			id: "m-1",
			orgId: "org-a",
			userId: "u-1",
			role: "OPERATOR",
			revokedAt: null,
		});

		await expect(
			changeOrgMemberRole({ orgId: "org-a", userId: "u-1", role: "ADMIN", reason: REASON }),
		).resolves.toEqual({ success: true });

		expect(tx.platformAuditLog.create.mock.calls[0][0].data).toMatchObject({
			ip: null,
			userAgent: null,
			action: "platform.membership.role",
		});
	});

	it("records that no previous permission row existed", async () => {
		db.membership.findUnique.mockResolvedValue({
			id: "m-1",
			orgId: "org-a",
			userId: "u-1",
			role: "OPERATOR",
			revokedAt: null,
		});
		tx.membershipPermission.findUnique.mockResolvedValue(null);

		await expect(
			setOrgMemberPermission({
				orgId: "org-a",
				userId: "u-1",
				permission: "view_billing",
				granted: true,
				reason: REASON,
			}),
		).resolves.toEqual({ success: true });

		expect(tx.platformAuditLog.create.mock.calls[0][0].data.before).toEqual({ granted: null });
		expect(tx.membershipPermission.upsert).toHaveBeenCalledWith({
			where: {
				membershipId_permission: { membershipId: "m-1", permission: "view_billing" },
			},
			update: { revokedAt: null },
			create: { membershipId: "m-1", permission: "view_billing", revokedAt: null },
		});
	});
});

describe("platform invite guards", () => {
	it("rejects an unknown role before reading the organization", async () => {
		await expect(
			inviteOrgMember({
				orgId: "org-a",
				email: "new@example.com",
				displayName: "New",
				role: "OWNER_2" as never,
				reason: REASON,
			}),
		).resolves.toEqual({ error: "Choose a valid role." });
		expect(db.organization.findUnique).not.toHaveBeenCalled();
	});

	it("rejects an unknown organization", async () => {
		db.organization.findUnique.mockResolvedValue(null);

		await expect(
			inviteOrgMember({
				orgId: "org-gone",
				email: "new@example.com",
				displayName: "New",
				role: "OPERATOR",
				reason: REASON,
			}),
		).resolves.toEqual({ error: "Organization not found." });
		expect(mockInvite).not.toHaveBeenCalled();
	});

	it("reports a provisioning crash as a failure, not a success", async () => {
		const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
		mockInvite.mockRejectedValue(new Error("supabase unreachable"));

		await expect(
			inviteOrgMember({
				orgId: "org-a",
				email: "new@example.com",
				displayName: "New",
				role: "OPERATOR",
				reason: REASON,
			}),
		).resolves.toEqual({ error: "Failed to add the member." });
		expect(tx.platformAuditLog.create).not.toHaveBeenCalled();
		spy.mockRestore();
	});
});
