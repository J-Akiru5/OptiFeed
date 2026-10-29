import { inviteOrAttachMember } from "@/lib/membership-invite";
import type { InviteLinkTransaction, InviteMemberInput } from "@/lib/membership-invite";
import prisma from "@/lib/prisma";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	ADMIN_A_ID,
	FARMER_A_ID,
	FIXED_NOW,
	MEMBERSHIP_FARMER_A,
	ORG_A_ID,
	ORG_B_ID,
	PLATFORM_ADMIN_A_ID,
	type TenancyDb,
} from "./helpers/tenancy";
import type { TestPrismaClient } from "./helpers/test-prisma";

/**
 * Behavioural tests for `inviteOrAttachMember`, the shared provisioning path
 * behind the tenant Members page and the platform organization console.
 *
 * The module has no invite table: an invite either attaches/reactivates an
 * existing account or provisions a new login through Supabase. These tests
 * therefore exercise the lifecycle that replaces a token: duplicate invites,
 * reactivation of a revoked membership, the platform-admin refusal, and the
 * one-time temporary password (returned once, never logged).
 *
 * The real Prisma-shaped tenancy database runs underneath, so an action only
 * stays in org A when its own filters exclude org B.
 */

const holder = vi.hoisted(() => ({
	db: undefined as TenancyDb | undefined,
	auth: {
		createUser: vi.fn(),
		deleteUser: vi.fn(),
	},
}));

vi.mock("@/lib/prisma", async () => {
	const { createTenancyDb } = await import("./helpers/tenancy");
	const { createTestPrisma } = await import("./helpers/test-prisma");
	holder.db = createTenancyDb();
	return { default: createTestPrisma(holder.db) };
});

vi.mock("@/lib/auth/session", () => ({
	buildPondEmail: (loginId: string) => `${loginId.trim().toLowerCase()}@pond.optifeed.local`,
}));

vi.mock("@/lib/supabase/admin", () => ({
	createAdminClient: () => ({ auth: { admin: holder.auth } }),
}));

/** The one-time password is deliberately not part of the hook payload. */
type LinkedAccount = {
	membershipId: string;
	userId: string;
	loginEmail: string;
	createdUser: boolean;
};
type LinkHook = (tx: InviteLinkTransaction, linked: LinkedAccount) => Promise<void>;

const INVALID_EMAIL_ERROR =
	"Enter a valid email address. Use letters, numbers or hyphens before the @.";

let consoleError: ReturnType<typeof vi.spyOn>;

function tenancy(): TenancyDb {
	if (!holder.db) throw new Error("tenancy database was not initialised");
	return holder.db;
}

function client(): TestPrismaClient {
	return prisma as unknown as TestPrismaClient;
}

function allowNewAuthAccount(id = "sb-invited-1") {
	holder.auth.createUser.mockResolvedValue({ data: { user: { id } }, error: null });
}

async function invite(
	input: Partial<InviteMemberInput> & Pick<InviteMemberInput, "email" | "displayName" | "role">,
	hook?: InviteMemberInput["onLinked"],
) {
	return inviteOrAttachMember({
		orgId: ORG_A_ID,
		invitedBy: ADMIN_A_ID,
		...(hook ? { onLinked: hook } : {}),
		...input,
	});
}

beforeEach(() => {
	vi.clearAllMocks();
	tenancy().reset();
	consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
	allowNewAuthAccount();
	holder.auth.deleteUser.mockResolvedValue({ data: {}, error: null });
});

afterEach(() => {
	consoleError.mockRestore();
});

describe("identity and input validation", () => {
	it("rejects an undeliverable address before reading the database", async () => {
		const findFirst = vi.spyOn(client().user, "findFirst");

		const result = await invite({ email: "not-an-email", displayName: "Ana", role: "OPERATOR" });

		expect(result).toEqual({ success: false, error: INVALID_EMAIL_ERROR });
		expect(findFirst).not.toHaveBeenCalled();
		expect(holder.auth.createUser).not.toHaveBeenCalled();
	});

	it("rejects an address whose local part is longer than the login-id limit", async () => {
		const result = await invite({
			email: `${"a".repeat(65)}@example.test`,
			displayName: "Ana",
			role: "OPERATOR",
		});

		expect(result).toEqual({ success: false, error: INVALID_EMAIL_ERROR });
		expect(holder.auth.createUser).not.toHaveBeenCalled();
	});

	it("normalizes a tagged address into the login-id alphabet", async () => {
		allowNewAuthAccount();
		const result = await invite({
			email: "juan+pond@example.test",
			displayName: "Juan",
			role: "OPERATOR",
		});

		expect(result).toMatchObject({ success: true, loginEmail: "juan-pond@pond.optifeed.local" });
		expect(tenancy().tables.users.some((user) => user.farmId === "juan-pond")).toBe(true);
	});

	it("requires a display name", async () => {
		const result = await invite({
			email: "ana@example.test",
			displayName: "   ",
			role: "OPERATOR",
		});

		expect(result).toEqual({ success: false, error: "Display name is required." });
		expect(holder.auth.createUser).not.toHaveBeenCalled();
	});

	it("rejects a display name longer than 80 characters", async () => {
		const result = await invite({
			email: "ana@example.test",
			displayName: "a".repeat(81),
			role: "OPERATOR",
		});

		expect(result).toEqual({ success: false, error: "Display name is too long." });
		expect(holder.auth.createUser).not.toHaveBeenCalled();
	});
});

describe("attaching an existing account", () => {
	it("refuses an account that is already an active member of the organization", async () => {
		const before = tenancy().tables.memberships.length;

		const result = await invite({
			email: "farm-a@example.test",
			displayName: "Farmer A",
			role: "ADMIN",
		});

		expect(result).toEqual({
			success: false,
			error: "That account is already a member of this organization.",
		});
		expect(tenancy().tables.memberships).toHaveLength(before);
		expect(holder.auth.createUser).not.toHaveBeenCalled();
	});

	it("refuses to attach an active platform administrator from the tenant surface", async () => {
		const result = await invite({
			email: "farm-platform-a@example.test",
			displayName: "Platform Admin A",
			role: "OPERATOR",
		});

		expect(result).toEqual({
			success: false,
			error: "Platform administrators must be managed from the platform console.",
		});
		expect(
			tenancy().tables.memberships.find((row) => row.userId === PLATFORM_ADMIN_A_ID)?.role,
		).toBe("OWNER");
	});

	it("detects a duplicate by login id even when the stored email domain differs", async () => {
		// Farm A's account is farm-a@pond.optifeed.local; the invite types the
		// same local part on a different domain and must still resolve to it.
		const result = await invite({
			email: "FARM-A@example.test",
			displayName: "Farmer A",
			role: "OPERATOR",
		});

		expect(result).toEqual({
			success: false,
			error: "That account is already a member of this organization.",
		});
	});

	it("reactivates a revoked membership, resets overrides and applies the new role", async () => {
		const membership = tenancy().tables.memberships.find((row) => row.id === MEMBERSHIP_FARMER_A);
		if (!membership) throw new Error("fixture membership missing");
		membership.revokedAt = new Date("2026-10-01T00:00:00.000Z");
		tenancy().tables.membershipPermissions.push({
			id: "mp-stale",
			membershipId: MEMBERSHIP_FARMER_A,
			permission: "manage_members",
			grantedAt: FIXED_NOW,
			revokedAt: null,
		});

		const linked = vi.fn<LinkHook>(async () => undefined);
		const result = await invite(
			{ email: "farm-a@example.test", displayName: "Farmer A", role: "ADMIN" },
			linked,
		);

		expect(result).toMatchObject({
			success: true,
			userId: FARMER_A_ID,
			membershipId: MEMBERSHIP_FARMER_A,
			loginEmail: "farm-a@pond.optifeed.local",
			temporaryPassword: null,
			createdUser: false,
		});
		const updated = tenancy().tables.memberships.find((row) => row.id === MEMBERSHIP_FARMER_A);
		expect(updated).toMatchObject({ role: "ADMIN", revokedAt: null, invitedBy: ADMIN_A_ID });
		expect(
			tenancy().tables.membershipPermissions.some(
				(row) => row.membershipId === MEMBERSHIP_FARMER_A,
			),
		).toBe(false);
		expect(linked).toHaveBeenCalledTimes(1);
		expect(linked.mock.calls[0]?.[1]).toEqual({
			membershipId: MEMBERSHIP_FARMER_A,
			userId: FARMER_A_ID,
			loginEmail: "farm-a@pond.optifeed.local",
			createdUser: false,
		});
	});

	it("creates a membership for an account that has none", async () => {
		const created = {
			id: "user-orphan-a",
			supabaseId: "sb-orphan-a",
			farmId: "orphan-a",
			email: "orphan-a@pond.optifeed.local",
			displayName: "Orphan A",
			role: "OPERATOR" as const,
			mustChangePassword: false,
			createdAt: FIXED_NOW,
			updatedAt: FIXED_NOW,
		};
		tenancy().tables.users.push(created);

		const result = await invite({
			email: "orphan-a@example.test",
			displayName: "Orphan A",
			role: "VIEWER",
		});

		expect(result).toMatchObject({ success: true, userId: created.id, createdUser: false });
		const membership = tenancy().tables.memberships.find((row) => row.userId === created.id);
		expect(membership).toMatchObject({
			orgId: ORG_A_ID,
			role: "VIEWER",
			invitedBy: ADMIN_A_ID,
			revokedAt: null,
		});
	});

	it("lets the platform console attach a platform administrator", async () => {
		const created = {
			id: "user-platform-two",
			supabaseId: "sb-platform-two",
			farmId: "platform-two",
			email: "platform-two@pond.optifeed.local",
			displayName: "Platform Two",
			role: "ADMIN" as const,
			mustChangePassword: false,
			createdAt: FIXED_NOW,
			updatedAt: FIXED_NOW,
		};
		tenancy().tables.users.push(created);
		tenancy().tables.platformAdmins.push({
			id: "grant-platform-two",
			userId: created.id,
			grantedBy: null,
			expiresAt: null,
			revokedAt: null,
			mfaEnrolledAt: null,
			createdAt: FIXED_NOW,
		});

		const result = await invite({
			email: "platform-two@example.test",
			displayName: "Platform Two",
			role: "OPERATOR",
			refusePlatformAdminTarget: false,
		});

		expect(result).toMatchObject({ success: true, userId: created.id, createdUser: false });
		expect(tenancy().tables.memberships.find((row) => row.userId === created.id)?.orgId).toBe(
			ORG_A_ID,
		);
	});

	it("runs the audit hook inside the provisioning transaction", async () => {
		const membership = tenancy().tables.memberships.find((row) => row.id === MEMBERSHIP_FARMER_A);
		if (!membership) throw new Error("fixture membership missing");
		membership.revokedAt = new Date("2026-10-01T00:00:00.000Z");
		const hook = vi.fn(
			async (tx: InviteLinkTransaction, linked: { userId: string; membershipId: string }) => {
				await tx.platformAuditLog.create({
					data: {
						actorUserId: ADMIN_A_ID,
						action: "platform.members.invite",
						targetType: "membership",
						targetId: linked.membershipId,
						reason: "invited from the platform console",
						after: { userId: linked.userId },
					},
				});
			},
		);

		const result = await invite(
			{ email: "farm-a@example.test", displayName: "Farmer A", role: "ADMIN" },
			hook,
		);
		if (!result.success) throw new Error("expected the attach to succeed");

		expect(result.createdUser).toBe(false);
		const audits = tenancy().tables.platformAuditLogs;
		expect(audits).toHaveLength(1);
		expect(audits[0]).toMatchObject({
			action: "platform.members.invite",
			targetId: result.membershipId,
			actorUserId: ADMIN_A_ID,
			after: { userId: FARMER_A_ID },
		});
	});

	it("returns a generic failure and logs no account data when the attach transaction fails", async () => {
		const membership = tenancy().tables.memberships.find((row) => row.id === MEMBERSHIP_FARMER_A);
		if (!membership) throw new Error("fixture membership missing");
		membership.revokedAt = new Date("2026-10-01T00:00:00.000Z");
		vi.spyOn(client().membership, "update").mockRejectedValueOnce(new Error("db down"));

		const result = await invite({
			email: "farm-a@example.test",
			displayName: "Farmer A",
			role: "ADMIN",
		});

		expect(result).toEqual({ success: false, error: "Failed to add the member." });
		expect(consoleError).toHaveBeenCalledWith(
			"[members] attach existing account failed:",
			"db down",
		);
		expect(holder.auth.deleteUser).not.toHaveBeenCalled();
	});
});

describe("provisioning a new account", () => {
	it("returns the one-time password once and forces a password change", async () => {
		allowNewAuthAccount("sb-new-member");
		const linked = vi.fn<LinkHook>(async () => undefined);

		const result = await invite(
			{ email: "new.member@example.test", displayName: "  New Member  ", role: "OPERATOR" },
			linked,
		);
		if (!result.success) throw new Error("expected provisioning to succeed");

		const password = holder.auth.createUser.mock.calls[0]?.[0] as { password: string };
		expect(result).toMatchObject({
			success: true,
			loginEmail: "new-member@pond.optifeed.local",
			createdUser: true,
			temporaryPassword: password.password,
		});
		expect(password.password).toMatch(/^[A-Za-z0-9_-]{16}$/);
		expect(holder.auth.createUser).toHaveBeenCalledWith({
			email: "new-member@pond.optifeed.local",
			password: password.password,
			email_confirm: true,
		});

		const user = tenancy().tables.users.find((row) => row.farmId === "new-member");
		expect(user).toMatchObject({
			supabaseId: "sb-new-member",
			email: "new-member@pond.optifeed.local",
			displayName: "New Member",
			role: "OPERATOR",
			mustChangePassword: true,
		});
		const membership = tenancy().tables.memberships.find((row) => row.userId === user?.id);
		expect(membership).toMatchObject({ orgId: ORG_A_ID, role: "OPERATOR", invitedBy: ADMIN_A_ID });

		// The hook exists to write the platform audit row; it must never be able
		// to persist the one-time password.
		const hookArgs = JSON.stringify(linked.mock.calls[0]?.[1] ?? null);
		expect(hookArgs).toContain("new-member@pond.optifeed.local");
		expect(hookArgs).not.toContain(password.password);
		expect(linked.mock.calls[0]?.[1]).toMatchObject({ createdUser: true });
	});

	it.each([
		["OWNER", "ADMIN"],
		["ADMIN", "ADMIN"],
		["OPERATOR", "OPERATOR"],
		["VIEWER", "VIEWER"],
	] as const)("maps membership role %s to the legacy global role %s", async (role, globalRole) => {
		allowNewAuthAccount(`sb-${role.toLowerCase()}`);

		const result = await invite({
			email: `${role.toLowerCase()}-member@example.test`,
			displayName: `${role} Member`,
			role,
		});
		if (!result.success) throw new Error("expected provisioning to succeed");

		const user = tenancy().tables.users.find((row) => row.id === result.userId);
		expect(user?.role).toBe(globalRole);
		expect(user?.mustChangePassword).toBe(true);
	});

	it("keeps the caller's organization only, never another tenant", async () => {
		allowNewAuthAccount();

		const result = await invite({
			email: "second-tenant@example.test",
			displayName: "Second Tenant",
			role: "OPERATOR",
		});
		if (!result.success) throw new Error("expected provisioning to succeed");

		expect(tenancy().tables.memberships.filter((row) => row.userId === result.userId)).toHaveLength(
			1,
		);
		expect(
			tenancy().tables.memberships.some(
				(row) => row.userId === result.userId && row.orgId === ORG_B_ID,
			),
		).toBe(false);
	});

	it("runs the audit hook for a newly created account inside the transaction", async () => {
		allowNewAuthAccount("sb-hooked");
		const hook = vi.fn(async (tx: InviteLinkTransaction, linked: { userId: string }) => {
			await tx.platformAuditLog.create({
				data: {
					actorUserId: ADMIN_A_ID,
					action: "platform.members.invite",
					targetType: "membership",
					targetId: linked.userId,
					reason: "created from the platform console",
				},
			});
		});

		const result = await invite(
			{ email: "hooked@example.test", displayName: "Hooked", role: "OPERATOR" },
			hook,
		);
		if (!result.success) throw new Error("expected provisioning to succeed");

		expect(result.createdUser).toBe(true);
		expect(hook.mock.calls[0]?.[1]).toMatchObject({ createdUser: true });
		expect(tenancy().tables.platformAuditLogs).toHaveLength(1);
		expect(tenancy().tables.platformAuditLogs[0]).toMatchObject({
			action: "platform.members.invite",
			targetId: result.userId,
		});
	});

	it("does not create an app row when Supabase rejects the login", async () => {
		holder.auth.createUser.mockResolvedValue({
			data: { user: null },
			error: { message: "email already registered" },
		});
		const usersBefore = tenancy().tables.users.length;

		const result = await invite({
			email: "rejected@example.test",
			displayName: "Rejected",
			role: "OPERATOR",
		});

		expect(result).toEqual({
			success: false,
			error: "Failed to create the account: email already registered",
		});
		expect(tenancy().tables.users).toHaveLength(usersBefore);
		expect(holder.auth.deleteUser).not.toHaveBeenCalled();
	});

	it("reports an unknown auth failure when Supabase returns no user and no error", async () => {
		holder.auth.createUser.mockResolvedValue({ data: { user: null }, error: null });

		const result = await invite({
			email: "no-payload@example.test",
			displayName: "No Payload",
			role: "OPERATOR",
		});

		expect(result).toEqual({
			success: false,
			error: "Failed to create the account: unknown error",
		});
	});

	it("rolls the stranded login back when the app transaction fails", async () => {
		allowNewAuthAccount("sb-stranded");
		vi.spyOn(client().user, "create").mockRejectedValueOnce(new Error("db down"));
		const usersBefore = tenancy().tables.users.length;

		const result = await invite({
			email: "stranded@example.test",
			displayName: "Stranded",
			role: "OPERATOR",
		});

		expect(result).toEqual({ success: false, error: "Failed to create the member." });
		expect(holder.auth.deleteUser).toHaveBeenCalledWith("sb-stranded");
		expect(tenancy().tables.users).toHaveLength(usersBefore);
		expect(consoleError).toHaveBeenCalledWith("[members] create account failed:", "db down");
	});

	it("never writes the generated password to the failure log", async () => {
		allowNewAuthAccount("sb-logged");
		vi.spyOn(client().user, "create").mockRejectedValueOnce(new Error("db down"));

		await invite({
			email: "logged@example.test",
			displayName: "Logged",
			role: "OPERATOR",
		});

		const generated = (holder.auth.createUser.mock.calls[0]?.[0] as { password: string }).password;
		const logged = consoleError.mock.calls.flat().map(String).join(" ");
		expect(logged).not.toContain(generated);
		expect(logged).not.toContain("logged@pond.optifeed.local");
	});
});

// `defineLoginIdentity` is re-exported below only to keep the import list honest
// for readers who grep for the derive helper; the identity cases live in
// membership-invite-identity.test.ts.
describe("module surface", () => {
	it("exposes no token or invite-table lifecycle", async () => {
		const module = await import("@/lib/membership-invite");
		expect(module).not.toHaveProperty("acceptInvite");
		expect(module).not.toHaveProperty("revokeInvite");
		expect(module).not.toHaveProperty("expireInvite");
	});
});
