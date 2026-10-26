import { beforeEach, describe, expect, it, vi } from "vitest";

const { db, tx, authAdmin, STEP_UP_AT } = vi.hoisted(() => {
	const STEP_UP_AT = new Date("2026-10-26T00:00:00.000Z");
	const tx = {
		membership: { findMany: vi.fn(), updateMany: vi.fn() },
		platformAdmin: {
			findUnique: vi.fn(),
			upsert: vi.fn(),
			update: vi.fn(),
			updateMany: vi.fn(),
			count: vi.fn(),
		},
		platformAuditLog: { create: vi.fn() },
	};
	const db = {
		user: { findUnique: vi.fn() },
		platformAdmin: { findUnique: vi.fn(), count: vi.fn() },
		platformAuditLog: { findFirst: vi.fn() },
		$transaction: vi.fn(async (fn: (client: typeof tx) => Promise<unknown>) => fn(tx)),
	};
	const authAdmin = { updateUserById: vi.fn(), deleteUser: vi.fn() };
	return { db, tx, authAdmin, STEP_UP_AT };
});

vi.mock("@/lib/prisma", () => ({ default: db }));
vi.mock("@/lib/supabase/admin", () => ({
	createAdminClient: () => ({ auth: { admin: authAdmin } }),
}));
vi.mock("@/lib/auth/require-platform-admin", () => ({ requirePlatformAdmin: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ getCurrentUser: vi.fn(), buildPondEmail: vi.fn() }));
vi.mock("@/lib/auth/session-cache", () => ({ invalidateFarm: vi.fn() }));
vi.mock("@/lib/auth/step-up", () => ({
	withStepUp: vi.fn(async (action: (stepUpAt: Date) => Promise<unknown>) => action(STEP_UP_AT)),
	isStepUpRequiredError: (error: unknown) =>
		typeof error === "object" &&
		error !== null &&
		(error as { code?: unknown }).code === "step_up_required",
}));
vi.mock("next/headers", () => ({
	headers: vi.fn(
		async () =>
			new Headers({
				"x-forwarded-for": "203.0.113.9, 10.0.0.1",
				"user-agent": "vitest-superadmin",
			}),
	),
}));

import {
	disablePlatformUser,
	enablePlatformUser,
	grantPlatformAdmin,
	revokePlatformAdmin,
} from "@/lib/actions/superadmin";
import { requirePlatformAdmin } from "@/lib/auth/require-platform-admin";
import { getCurrentUser } from "@/lib/auth/session";
import { invalidateFarm } from "@/lib/auth/session-cache";
import { withStepUp } from "@/lib/auth/step-up";

const mockGate = vi.mocked(requirePlatformAdmin);
const mockUser = vi.mocked(getCurrentUser);
const mockInvalidateFarm = vi.mocked(invalidateFarm);
const mockWithStepUp = vi.mocked(withStepUp);
const mockAuditCreate = tx.platformAuditLog.create;

const REASON = "Operator request reviewed by the platform team";
const STEPPED_UP = { error: "Re-enter your password to continue.", code: "step_up_required" };

beforeEach(() => {
	vi.clearAllMocks();
	mockGate.mockResolvedValue(undefined);
	mockUser.mockResolvedValue({ id: "admin-1" } as Awaited<ReturnType<typeof getCurrentUser>>);
	db.$transaction.mockImplementation(async (fn: (client: typeof tx) => Promise<unknown>) => fn(tx));
	db.platformAdmin.count.mockResolvedValue(2);
	tx.platformAdmin.upsert.mockResolvedValue({});
	tx.platformAdmin.update.mockResolvedValue({});
	tx.platformAdmin.updateMany.mockResolvedValue({ count: 1 });
	tx.platformAdmin.count.mockResolvedValue(2);
	tx.membership.updateMany.mockResolvedValue({ count: 1 });
	tx.platformAuditLog.create.mockResolvedValue({});
	authAdmin.updateUserById.mockResolvedValue({ data: {}, error: null });
});

describe("grantPlatformAdmin", () => {
	it("denies a caller who is not a platform admin", async () => {
		mockGate.mockRejectedValueOnce(new Error("NEXT_REDIRECT"));
		await expect(grantPlatformAdmin("u-1", REASON)).rejects.toThrow("NEXT_REDIRECT");
		expect(db.user.findUnique).not.toHaveBeenCalled();
		expect(tx.platformAdmin.upsert).not.toHaveBeenCalled();
	});

	it("requires a fresh step-up and writes nothing without one", async () => {
		db.user.findUnique.mockResolvedValue({ id: "u-1" });
		mockWithStepUp.mockRejectedValueOnce(STEPPED_UP);

		const result = await grantPlatformAdmin("u-1", REASON);

		expect(result).toMatchObject({ code: "step_up_required" });
		expect(tx.platformAdmin.upsert).not.toHaveBeenCalled();
		expect(mockAuditCreate).not.toHaveBeenCalled();
	});

	it("grants god-mode and records stepUpAt in the audit row", async () => {
		db.user.findUnique.mockResolvedValue({ id: "u-1" });
		tx.platformAdmin.findUnique.mockResolvedValue(null);

		await expect(grantPlatformAdmin("u-1", REASON)).resolves.toEqual({ success: true });

		expect(tx.platformAdmin.upsert).toHaveBeenCalledTimes(1);
		expect(mockAuditCreate).toHaveBeenCalledTimes(1);
		expect(mockAuditCreate.mock.calls[0][0].data).toMatchObject({
			action: "platform.admin.grant",
			targetType: "platform_admin",
			targetId: "u-1",
			reason: REASON,
			actorUserId: "admin-1",
			stepUpAt: STEP_UP_AT,
			temporaryGrant: false,
			ip: "203.0.113.9",
			userAgent: "vitest-superadmin",
		});
	});

	it("flags a time-boxed grant as temporary in the audit row", async () => {
		db.user.findUnique.mockResolvedValue({ id: "u-1" });
		tx.platformAdmin.findUnique.mockResolvedValue(null);

		await expect(grantPlatformAdmin("u-1", REASON, "2026-12-01T00:00:00.000Z")).resolves.toEqual({
			success: true,
		});

		expect(mockAuditCreate.mock.calls[0][0].data).toMatchObject({
			action: "platform.admin.grant",
			targetType: "platform_admin",
			temporaryGrant: true,
			after: { expiresAt: "2026-12-01T00:00:00.000Z" },
		});
	});
});

describe("revokePlatformAdmin", () => {
	it("requires a fresh step-up and writes nothing without one", async () => {
		db.platformAdmin.findUnique.mockResolvedValue({ revokedAt: null, expiresAt: null });
		mockWithStepUp.mockRejectedValueOnce(STEPPED_UP);

		const result = await revokePlatformAdmin("u-1", REASON);

		expect(result).toMatchObject({ code: "step_up_required" });
		expect(tx.platformAdmin.update).not.toHaveBeenCalled();
		expect(mockAuditCreate).not.toHaveBeenCalled();
	});

	it("revokes the grant and records stepUpAt", async () => {
		db.platformAdmin.findUnique.mockResolvedValue({ revokedAt: null, expiresAt: null });
		tx.platformAdmin.count.mockResolvedValue(2);

		await expect(revokePlatformAdmin("u-1", REASON)).resolves.toEqual({ success: true });

		expect(tx.platformAdmin.update).toHaveBeenCalledWith({
			where: { userId: "u-1" },
			data: { revokedAt: expect.any(Date) },
		});
		expect(mockAuditCreate.mock.calls[0][0].data).toMatchObject({
			action: "platform.admin.revoke",
			targetType: "platform_admin",
			targetId: "u-1",
			stepUpAt: STEP_UP_AT,
			ip: "203.0.113.9",
			userAgent: "vitest-superadmin",
		});
	});

	it("never lets an admin revoke their own grant", async () => {
		db.platformAdmin.findUnique.mockResolvedValue({ revokedAt: null, expiresAt: null });
		await expect(revokePlatformAdmin("admin-1", REASON)).resolves.toEqual({
			error: "You cannot revoke your own platform admin grant.",
		});
		expect(tx.platformAdmin.update).not.toHaveBeenCalled();
	});
});

describe("disablePlatformUser", () => {
	function allowDisable() {
		db.user.findUnique.mockResolvedValue({
			id: "u-1",
			farmId: "farm-a",
			supabaseId: "sb-1",
		});
		db.platformAdmin.findUnique.mockResolvedValue({ revokedAt: null, expiresAt: null });
		tx.membership.findMany.mockResolvedValue([{ id: "m-1", orgId: "org-a", role: "OWNER" }]);
		tx.platformAdmin.findUnique.mockResolvedValue({ revokedAt: null, expiresAt: null });
	}

	it("requires a platform admin", async () => {
		mockGate.mockRejectedValueOnce(new Error("NEXT_REDIRECT"));
		await expect(disablePlatformUser("u-1", REASON, "farm-a")).rejects.toThrow("NEXT_REDIRECT");
		expect(db.user.findUnique).not.toHaveBeenCalled();
	});

	it("refuses a farmId confirmation that does not match", async () => {
		allowDisable();
		const result = await disablePlatformUser("u-1", REASON, "farm-b");
		expect(result).toEqual({ error: "Type farm-a exactly to confirm." });
		expect(authAdmin.updateUserById).not.toHaveBeenCalled();
		expect(db.$transaction).not.toHaveBeenCalled();
	});

	it("requires a fresh step-up and leaves the login alone without one", async () => {
		allowDisable();
		mockWithStepUp.mockRejectedValueOnce(STEPPED_UP);

		const result = await disablePlatformUser("u-1", REASON, "farm-a");

		expect(result).toMatchObject({ code: "step_up_required" });
		expect(authAdmin.updateUserById).not.toHaveBeenCalled();
		expect(db.$transaction).not.toHaveBeenCalled();
		expect(mockAuditCreate).not.toHaveBeenCalled();
	});

	it("refuses to disable the last active platform admin", async () => {
		allowDisable();
		db.platformAdmin.count.mockResolvedValue(1);

		await expect(disablePlatformUser("u-1", REASON, "farm-a")).resolves.toEqual({
			error: expect.stringContaining("At least one active platform administrator"),
		});
		expect(authAdmin.updateUserById).not.toHaveBeenCalled();
	});

	it("does not touch the DB when the Supabase ban fails", async () => {
		allowDisable();
		authAdmin.updateUserById.mockResolvedValue({
			data: {},
			error: { message: "auth unavailable" },
		});

		await expect(disablePlatformUser("u-1", REASON, "farm-a")).resolves.toEqual({
			error: "Failed to disable the user.",
		});
		expect(db.$transaction).not.toHaveBeenCalled();
		expect(mockAuditCreate).not.toHaveBeenCalled();
	});

	it("bans the login, soft-revokes memberships and audits — but deletes nothing", async () => {
		allowDisable();

		await expect(disablePlatformUser("u-1", REASON, "farm-a")).resolves.toEqual({
			success: true,
		});

		expect(authAdmin.updateUserById).toHaveBeenCalledWith("sb-1", {
			ban_duration: "876000h",
		});
		expect(tx.membership.findMany).toHaveBeenCalledWith({
			where: { userId: "u-1", revokedAt: null },
			select: { id: true, orgId: true, role: true },
		});
		expect(tx.membership.updateMany).toHaveBeenCalledWith({
			where: { id: { in: ["m-1"] } },
			data: { revokedAt: expect.any(Date) },
		});
		expect(tx.platformAdmin.update).toHaveBeenCalledWith({
			where: { userId: "u-1" },
			data: { revokedAt: expect.any(Date) },
		});
		expect(authAdmin.deleteUser).not.toHaveBeenCalled();
		expect(mockInvalidateFarm).toHaveBeenCalledWith("sb-1");

		expect(mockAuditCreate).toHaveBeenCalledTimes(1);
		const row = mockAuditCreate.mock.calls[0][0].data;
		expect(row).toMatchObject({
			action: "platform.user.disable",
			targetType: "user",
			targetId: "u-1",
			orgId: "org-a",
			reason: REASON,
			actorUserId: "admin-1",
			stepUpAt: STEP_UP_AT,
			ip: "203.0.113.9",
			userAgent: "vitest-superadmin",
			before: { farmId: "farm-a" },
			after: {
				disabledAt: expect.any(String),
				revokedMembershipIds: ["m-1"],
				platformAdminRevoked: true,
			},
		});
	});
});

describe("enablePlatformUser", () => {
	const DISABLED_AT = "2026-10-20T09:00:00.000Z";

	function allowEnable() {
		db.user.findUnique.mockResolvedValue({
			id: "u-1",
			farmId: "farm-a",
			supabaseId: "sb-1",
		});
		db.platformAuditLog.findFirst.mockResolvedValue({
			after: {
				disabledAt: DISABLED_AT,
				revokedMembershipIds: ["m-1"],
				platformAdminRevoked: true,
			},
		});
	}

	it("requires a fresh step-up and leaves the login banned without one", async () => {
		allowEnable();
		mockWithStepUp.mockRejectedValueOnce(STEPPED_UP);

		const result = await enablePlatformUser("u-1", REASON);

		expect(result).toMatchObject({ code: "step_up_required" });
		expect(authAdmin.updateUserById).not.toHaveBeenCalled();
		expect(db.$transaction).not.toHaveBeenCalled();
	});

	it("unbans the login and restores exactly what the disable revoked", async () => {
		allowEnable();

		await expect(enablePlatformUser("u-1", REASON)).resolves.toEqual({ success: true });

		expect(db.platformAuditLog.findFirst).toHaveBeenCalledWith({
			where: { action: "platform.user.disable", targetId: "u-1" },
			orderBy: { createdAt: "desc" },
			select: { after: true },
		});
		expect(authAdmin.updateUserById).toHaveBeenCalledWith("sb-1", {
			ban_duration: "none",
		});
		expect(tx.membership.updateMany).toHaveBeenCalledWith({
			where: {
				id: { in: ["m-1"] },
				userId: "u-1",
				revokedAt: new Date(DISABLED_AT),
			},
			data: { revokedAt: null },
		});
		expect(tx.platformAdmin.updateMany).toHaveBeenCalledWith({
			where: { userId: "u-1", revokedAt: new Date(DISABLED_AT) },
			data: { revokedAt: null },
		});
		expect(mockInvalidateFarm).toHaveBeenCalledWith("sb-1");
		expect(mockAuditCreate.mock.calls[0][0].data).toMatchObject({
			action: "platform.user.enable",
			targetType: "user",
			targetId: "u-1",
			stepUpAt: STEP_UP_AT,
			ip: "203.0.113.9",
			userAgent: "vitest-superadmin",
			after: {
				restoredMembershipIds: ["m-1"],
				platformAdminRestored: true,
			},
		});
	});

	it("still unbans an account with no disable record", async () => {
		db.user.findUnique.mockResolvedValue({
			id: "u-1",
			farmId: "farm-a",
			supabaseId: "sb-1",
		});
		db.platformAuditLog.findFirst.mockResolvedValue(null);

		await expect(enablePlatformUser("u-1", REASON)).resolves.toEqual({ success: true });

		expect(authAdmin.updateUserById).toHaveBeenCalledWith("sb-1", {
			ban_duration: "none",
		});
		expect(tx.membership.updateMany).not.toHaveBeenCalled();
		expect(tx.platformAdmin.updateMany).not.toHaveBeenCalled();
		expect(mockAuditCreate.mock.calls[0][0].data).toMatchObject({
			action: "platform.user.enable",
			after: { restoredMembershipIds: [], platformAdminRestored: false },
		});
	});
});
