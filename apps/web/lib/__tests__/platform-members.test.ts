import { beforeEach, describe, expect, it, vi } from "vitest";

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
		$transaction: vi.fn(async (fn: (client: typeof tx) => Promise<unknown>) => fn(tx)),
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
vi.mock("@/lib/membership-invite", () => ({ inviteOrAttachMember: vi.fn() }));
vi.mock("@/lib/notify/invite-email", () => ({ deliverMemberInviteEmail: vi.fn() }));
vi.mock("next/headers", () => ({
	headers: vi.fn(
		async () =>
			new Headers({
				"x-forwarded-for": "203.0.113.9, 10.0.0.1",
				"user-agent": "vitest-platform-members",
			}),
	),
}));

import {
	changeOrgMemberRole,
	getOrgDetail,
	inviteOrgMember,
	revokeOrgMembership,
	setOrgMemberPermission,
} from "@/lib/actions/platform/members";
import { requirePlatformAdmin } from "@/lib/auth/require-platform-admin";
import { getCurrentUser } from "@/lib/auth/session";
import { withStepUp } from "@/lib/auth/step-up";
import { inviteOrAttachMember } from "@/lib/membership-invite";
import { deliverMemberInviteEmail } from "@/lib/notify/invite-email";
import type { Prisma } from "@prisma/client";

const mockGate = vi.mocked(requirePlatformAdmin);
const mockUser = vi.mocked(getCurrentUser);
const mockWithStepUp = vi.mocked(withStepUp);
const mockInvite = vi.mocked(inviteOrAttachMember);
const mockDeliverInviteEmail = vi.mocked(deliverMemberInviteEmail);
const mockAudit = tx.platformAuditLog.create;

const REASON = "Owner asked us to correct a wrong role after a staff handover";
const STEPPED_UP = { error: "Re-enter your password to continue.", code: "step_up_required" };

function activeMembership(role: "OWNER" | "ADMIN" | "OPERATOR" | "VIEWER" = "OPERATOR") {
	db.membership.findUnique.mockResolvedValue({
		id: "m-1",
		orgId: "org-a",
		userId: "u-1",
		role,
		revokedAt: null,
	});
}

beforeEach(() => {
	vi.clearAllMocks();
	mockGate.mockResolvedValue(undefined);
	mockUser.mockResolvedValue({
		id: "admin-1",
		farmId: "platform-admin",
		displayName: "Platform Admin",
	} as Awaited<ReturnType<typeof getCurrentUser>>);
	db.$transaction.mockImplementation(async (fn: (client: typeof tx) => Promise<unknown>) => fn(tx));
	db.platformAdmin.findUnique.mockResolvedValue({ expiresAt: null });
	db.platformAdmin.findMany.mockResolvedValue([]);
	db.membership.findUnique.mockResolvedValue(null);
	db.membership.findMany.mockResolvedValue([]);
	db.membershipPermission.findMany.mockResolvedValue([]);
	db.user.findMany.mockResolvedValue([]);
	db.organization.findUnique.mockResolvedValue({ id: "org-a", name: "Org A" });
	mockDeliverInviteEmail.mockResolvedValue(true);
	tx.membership.update.mockResolvedValue({});
	tx.membershipPermission.findUnique.mockResolvedValue(null);
	tx.membershipPermission.upsert.mockResolvedValue({});
	mockAudit.mockResolvedValue({});
});

describe("platform membership gate", () => {
	it("denies a caller who is not a platform admin", async () => {
		mockGate.mockRejectedValueOnce(new Error("NEXT_REDIRECT"));

		await expect(
			changeOrgMemberRole({
				orgId: "org-a",
				userId: "u-1",
				role: "ADMIN",
				reason: REASON,
			}),
		).rejects.toThrow("NEXT_REDIRECT");
		expect(db.membership.findUnique).not.toHaveBeenCalled();
		expect(tx.membership.update).not.toHaveBeenCalled();
	});

	it("gates the organization detail read too", async () => {
		mockGate.mockRejectedValueOnce(new Error("NEXT_REDIRECT"));

		await expect(getOrgDetail("org-a")).rejects.toThrow("NEXT_REDIRECT");
		expect(db.organization.findUnique).not.toHaveBeenCalled();
	});
});

describe("platform role changes", () => {
	it("requires a reason of at least 10 characters", async () => {
		activeMembership();

		await expect(
			changeOrgMemberRole({ orgId: "org-a", userId: "u-1", role: "ADMIN", reason: "short" }),
		).resolves.toMatchObject({ error: expect.stringContaining("at least 10 characters") });
		expect(mockWithStepUp).not.toHaveBeenCalled();
		expect(mockAudit).not.toHaveBeenCalled();
	});

	it("requires step-up and writes nothing without it", async () => {
		activeMembership();
		mockWithStepUp.mockRejectedValueOnce(STEPPED_UP);

		const result = await changeOrgMemberRole({
			orgId: "org-a",
			userId: "u-1",
			role: "ADMIN",
			reason: REASON,
		});

		expect(result).toMatchObject({ code: "step_up_required" });
		expect(tx.membership.update).not.toHaveBeenCalled();
		expect(mockAudit).not.toHaveBeenCalled();
	});

	it("changes the role and writes exactly one audit row with the org id", async () => {
		activeMembership("OPERATOR");

		await expect(
			changeOrgMemberRole({ orgId: "org-a", userId: "u-1", role: "ADMIN", reason: REASON }),
		).resolves.toEqual({ success: true });

		expect(tx.membership.update).toHaveBeenCalledWith({
			where: { id: "m-1" },
			data: { role: "ADMIN" },
		});
		expect(mockAudit).toHaveBeenCalledTimes(1);
		expect(mockAudit.mock.calls[0][0].data).toMatchObject({
			actorUserId: "admin-1",
			action: "platform.membership.role",
			targetType: "membership",
			targetId: "m-1",
			orgId: "org-a",
			reason: REASON,
			stepUpAt: STEP_UP_AT,
			ip: "203.0.113.9",
			userAgent: "vitest-platform-members",
			before: { role: "OPERATOR" },
			after: { role: "ADMIN" },
		});
	});
});

describe("platform permission changes", () => {
	it("requires step-up and writes nothing without it", async () => {
		activeMembership();
		mockWithStepUp.mockRejectedValueOnce(STEPPED_UP);

		const result = await setOrgMemberPermission({
			orgId: "org-a",
			userId: "u-1",
			permission: "control_feeder",
			granted: false,
			reason: REASON,
		});

		expect(result).toMatchObject({ code: "step_up_required" });
		expect(tx.membershipPermission.upsert).not.toHaveBeenCalled();
		expect(mockAudit).not.toHaveBeenCalled();
	});

	it("revokes the permission and writes exactly one audit row", async () => {
		activeMembership();

		await expect(
			setOrgMemberPermission({
				orgId: "org-a",
				userId: "u-1",
				permission: "control_feeder",
				granted: false,
				reason: REASON,
			}),
		).resolves.toEqual({ success: true });

		expect(tx.membershipPermission.upsert).toHaveBeenCalledTimes(1);
		expect(mockAudit).toHaveBeenCalledTimes(1);
		expect(mockAudit.mock.calls[0][0].data).toMatchObject({
			action: "platform.membership.permission",
			targetType: "membership",
			targetId: "m-1",
			orgId: "org-a",
			reason: REASON,
			stepUpAt: STEP_UP_AT,
			after: { permission: "control_feeder", granted: false },
		});
	});

	it("rejects an unknown permission name before any write", async () => {
		activeMembership();

		await expect(
			setOrgMemberPermission({
				orgId: "org-a",
				userId: "u-1",
				permission: "control_relay",
				granted: true,
				reason: REASON,
			}),
		).resolves.toEqual({ error: "Unknown permission." });
		expect(mockWithStepUp).not.toHaveBeenCalled();
	});
});

describe("platform membership revocation", () => {
	it("requires step-up and writes nothing without it", async () => {
		activeMembership();
		mockWithStepUp.mockRejectedValueOnce(STEPPED_UP);

		const result = await revokeOrgMembership({
			orgId: "org-a",
			userId: "u-1",
			reason: REASON,
		});

		expect(result).toMatchObject({ code: "step_up_required" });
		expect(tx.membership.update).not.toHaveBeenCalled();
		expect(mockAudit).not.toHaveBeenCalled();
	});

	it("revokes a membership and writes exactly one audit row", async () => {
		activeMembership("OWNER");

		await expect(
			revokeOrgMembership({ orgId: "org-a", userId: "u-1", reason: REASON }),
		).resolves.toEqual({ success: true });

		// God mode: even the last OWNER can be removed; the audit row is the guardrail.
		expect(tx.membership.update).toHaveBeenCalledWith({
			where: { id: "m-1" },
			data: { revokedAt: expect.any(Date) },
		});
		expect(mockAudit).toHaveBeenCalledTimes(1);
		expect(mockAudit.mock.calls[0][0].data).toMatchObject({
			action: "platform.membership.revoke",
			targetType: "membership",
			targetId: "m-1",
			orgId: "org-a",
			reason: REASON,
			stepUpAt: STEP_UP_AT,
			before: { role: "OWNER" },
			after: { revoked: true },
		});
	});
});

describe("platform invites", () => {
	it("requires step-up and never provisions without it", async () => {
		mockWithStepUp.mockRejectedValueOnce(STEPPED_UP);

		const result = await inviteOrgMember({
			orgId: "org-a",
			email: "new@example.com",
			displayName: "New Member",
			role: "OPERATOR",
			reason: REASON,
		});

		expect(result).toMatchObject({ code: "step_up_required" });
		expect(mockInvite).not.toHaveBeenCalled();
		expect(mockAudit).not.toHaveBeenCalled();
	});

	it("passes a provisioning failure through without an audit row", async () => {
		mockInvite.mockResolvedValue({ success: false, error: "That account is already a member." });

		await expect(
			inviteOrgMember({
				orgId: "org-a",
				email: "new@example.com",
				displayName: "New Member",
				role: "OPERATOR",
				reason: REASON,
			}),
		).resolves.toEqual({ error: "That account is already a member." });
		expect(mockAudit).not.toHaveBeenCalled();
		expect(mockDeliverInviteEmail).not.toHaveBeenCalled();
	});

	it("provisions the member and writes exactly one membership audit row", async () => {
		mockInvite.mockImplementation(async (input) => {
			await input.onLinked?.(tx as unknown as Prisma.TransactionClient, {
				membershipId: "m-new",
				userId: "u-new",
				loginEmail: "new@pond.optifeed.local",
				createdUser: true,
			});
			return {
				success: true,
				membershipId: "m-new",
				userId: "u-new",
				loginEmail: "new@pond.optifeed.local",
				temporaryPassword: "TempPass123",
				createdUser: true,
			};
		});

		await expect(
			inviteOrgMember({
				orgId: "org-a",
				email: "new@example.com",
				displayName: "New Member",
				role: "OPERATOR",
				reason: REASON,
			}),
		).resolves.toEqual({
			success: true,
			membershipId: "m-new",
			userId: "u-new",
			loginEmail: "new@pond.optifeed.local",
			temporaryPassword: "TempPass123",
			createdUser: true,
			inviteEmailSent: true,
		});

		expect(mockDeliverInviteEmail).toHaveBeenCalledTimes(1);
		expect(mockDeliverInviteEmail).toHaveBeenCalledWith({
			to: "new@example.com",
			loginId: "new",
			temporaryPassword: "TempPass123",
			orgName: "Org A",
			inviterName: "Platform Admin",
		});
		expect(mockAudit).toHaveBeenCalledTimes(1);
		const row = mockAudit.mock.calls[0][0].data;
		expect(row).toMatchObject({
			action: "platform.membership.invite",
			targetType: "membership",
			targetId: "m-new",
			orgId: "org-a",
			reason: REASON,
			stepUpAt: STEP_UP_AT,
			after: {
				userId: "u-new",
				role: "OPERATOR",
				loginEmail: "new@pond.optifeed.local",
				createdUser: true,
			},
		});
		// The one-time password must never reach the audit trail.
		expect(JSON.stringify(row)).not.toContain("TempPass123");
	});

	it("keeps the one-time password when email delivery is skipped", async () => {
		mockInvite.mockResolvedValue({
			success: true,
			membershipId: "m-new",
			userId: "u-new",
			loginEmail: "new@pond.optifeed.local",
			temporaryPassword: "TempPass123",
			createdUser: true,
		});
		mockDeliverInviteEmail.mockResolvedValue(false);

		await expect(
			inviteOrgMember({
				orgId: "org-a",
				email: "new@example.com",
				displayName: "New Member",
				role: "OPERATOR",
				reason: REASON,
			}),
		).resolves.toMatchObject({
			success: true,
			temporaryPassword: "TempPass123",
			inviteEmailSent: false,
		});
	});

	it("does not send an email when an existing account is attached", async () => {
		mockInvite.mockResolvedValue({
			success: true,
			membershipId: "m-new",
			userId: "u-new",
			loginEmail: "existing@pond.optifeed.local",
			temporaryPassword: null,
			createdUser: false,
		});

		await expect(
			inviteOrgMember({
				orgId: "org-a",
				email: "existing@example.com",
				displayName: "Existing Member",
				role: "OPERATOR",
				reason: REASON,
			}),
		).resolves.toMatchObject({ success: true, inviteEmailSent: false });
		expect(mockDeliverInviteEmail).not.toHaveBeenCalled();
	});
});
