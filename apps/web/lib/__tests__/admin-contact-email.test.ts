import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TenancyDb } from "./helpers/tenancy";

/**
 * `updateMemberContactEmail` (#449): the tenant console's way to record the
 * deliverable address a farmer's password-reset link is sent to.
 *
 * The address decides who can take the account over, so these tests pin the
 * boundaries around it: scope, platform admins, the OWNER/ADMIN hierarchy,
 * accounts shared with an organization the caller does not administer, the
 * unique index, and the single audit row. The guard chain (tenant admin,
 * `manage_members`) is covered by the authorization matrix.
 */

const holder = vi.hoisted(() => ({ db: undefined as TenancyDb | undefined }));

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
	createAdminClient: () => ({ auth: { admin: { createUser: vi.fn(), deleteUser: vi.fn() } } }),
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

import { updateMemberContactEmail } from "@/lib/actions/admin";
import {
	ADMIN_EDIT_OWNER_EMAIL_MESSAGE,
	MEMBER_OTHER_ORG_EMAIL_MESSAGE,
} from "@/lib/auth/member-rules";
import { getCurrentUser } from "@/lib/auth/session";
import {
	CONTACT_EMAIL_INVALID,
	CONTACT_EMAIL_POND,
	CONTACT_EMAIL_TAKEN,
} from "@/lib/contact-email";
import {
	ADMIN_A_ID,
	FARMER_A_ID,
	FARMER_B_ID,
	MEMBERSHIP_ADMIN_A,
	MEMBERSHIP_FARMER_A,
	ORG_A_ID,
	ORG_B_ID,
	PLATFORM_ADMIN_A_ID,
	userById,
} from "./helpers/tenancy";

const mockUser = vi.mocked(getCurrentUser);

function tenancy(): TenancyDb {
	if (!holder.db) throw new Error("tenancy database was not initialised");
	return holder.db;
}

function signInAs(userId: string) {
	mockUser.mockResolvedValue(userById(tenancy(), userId) as never);
}

function userRow(userId: string) {
	const row = tenancy().tables.users.find((candidate) => candidate.id === userId);
	if (!row) throw new Error(`no user ${userId}`);
	return row;
}

function membershipRow(membershipId: string) {
	const row = tenancy().tables.memberships.find((candidate) => candidate.id === membershipId);
	if (!row) throw new Error(`no membership ${membershipId}`);
	return row;
}

beforeEach(() => {
	vi.restoreAllMocks();
	vi.clearAllMocks();
	tenancy().reset();
	// The column is nullable, so a real row reads null, not undefined.
	for (const row of tenancy().tables.users) row.contactEmail = null;
	signInAs(ADMIN_A_ID);
});

describe("updateMemberContactEmail", () => {
	it("stores the lower-cased address and writes one audit row, leaving the login address alone", async () => {
		const loginBefore = userRow(FARMER_A_ID).email;

		const result = await updateMemberContactEmail(FARMER_A_ID, "  Farmer.A@Example.COM ");

		expect(result).toEqual({ success: true });
		expect(userRow(FARMER_A_ID).contactEmail).toBe("farmer.a@example.com");
		expect(userRow(FARMER_A_ID).email).toBe(loginBefore);

		const audits = tenancy().tables.platformAuditLogs;
		expect(audits).toHaveLength(1);
		expect(audits[0]).toMatchObject({
			action: "platform.user.contact_email_updated",
			targetType: "user",
			targetId: FARMER_A_ID,
			orgId: ORG_A_ID,
			actorUserId: ADMIN_A_ID,
			before: { contactEmail: null },
			after: { contactEmail: "farmer.a@example.com" },
		});
	});

	it("records the previous address when it is replaced", async () => {
		userRow(FARMER_A_ID).contactEmail = "old@example.com";

		await updateMemberContactEmail(FARMER_A_ID, "new@example.com");

		expect(tenancy().tables.platformAuditLogs[0]).toMatchObject({
			before: { contactEmail: "old@example.com" },
			after: { contactEmail: "new@example.com" },
		});
	});

	it("clears the address when given a blank value", async () => {
		userRow(FARMER_A_ID).contactEmail = "old@example.com";

		await expect(updateMemberContactEmail(FARMER_A_ID, "   ")).resolves.toEqual({ success: true });

		expect(userRow(FARMER_A_ID).contactEmail).toBeNull();
		expect(tenancy().tables.platformAuditLogs[0]).toMatchObject({
			before: { contactEmail: "old@example.com" },
			after: { contactEmail: null },
		});
	});

	it("is a quiet success, with no audit row, when nothing changes", async () => {
		userRow(FARMER_A_ID).contactEmail = "same@example.com";

		await expect(updateMemberContactEmail(FARMER_A_ID, " SAME@example.com ")).resolves.toEqual({
			success: true,
		});

		expect(tenancy().tables.platformAuditLogs).toHaveLength(0);
	});

	it("refuses an address that is not a single deliverable mailbox", async () => {
		await expect(updateMemberContactEmail(FARMER_A_ID, "not-an-email")).resolves.toEqual({
			error: CONTACT_EMAIL_INVALID,
		});
		await expect(
			updateMemberContactEmail(FARMER_A_ID, "a@example.com,attacker@evil.example"),
		).resolves.toEqual({ error: CONTACT_EMAIL_INVALID });

		expect(userRow(FARMER_A_ID).contactEmail ?? null).toBeNull();
		expect(tenancy().tables.platformAuditLogs).toHaveLength(0);
	});

	it("refuses the synthetic pond login address, which can never receive mail", async () => {
		await expect(
			updateMemberContactEmail(FARMER_A_ID, "farm-a@pond.optifeed.local"),
		).resolves.toEqual({ error: CONTACT_EMAIL_POND });

		expect(userRow(FARMER_A_ID).contactEmail ?? null).toBeNull();
	});

	it("refuses a user in another organization and leaves them untouched", async () => {
		const result = await updateMemberContactEmail(FARMER_B_ID, "hijack@example.com");

		expect(result).toEqual({ error: "That user is outside your organization." });
		expect(userRow(FARMER_B_ID).contactEmail ?? null).toBeNull();
		expect(tenancy().tables.platformAuditLogs).toHaveLength(0);
	});

	it("refuses a platform administrator, who is managed from the platform console", async () => {
		const result = await updateMemberContactEmail(PLATFORM_ADMIN_A_ID, "admin@example.com");

		expect(result).toEqual({
			error: "Platform administrators must be managed from the platform console.",
		});
		expect(userRow(PLATFORM_ADMIN_A_ID).contactEmail ?? null).toBeNull();
	});

	it("does not let an ADMIN change an OWNER address", async () => {
		membershipRow(MEMBERSHIP_ADMIN_A).role = "ADMIN";
		membershipRow(MEMBERSHIP_FARMER_A).role = "OWNER";

		const result = await updateMemberContactEmail(FARMER_A_ID, "takeover@example.com");

		expect(result).toEqual({ error: ADMIN_EDIT_OWNER_EMAIL_MESSAGE });
		expect(userRow(FARMER_A_ID).contactEmail ?? null).toBeNull();
		expect(tenancy().tables.platformAuditLogs).toHaveLength(0);
	});

	it("lets an ADMIN change a non-owner member address", async () => {
		membershipRow(MEMBERSHIP_ADMIN_A).role = "ADMIN";

		await expect(updateMemberContactEmail(FARMER_A_ID, "ok@example.com")).resolves.toEqual({
			success: true,
		});
		expect(userRow(FARMER_A_ID).contactEmail).toBe("ok@example.com");
	});

	it("lets an OWNER change another OWNER address", async () => {
		membershipRow(MEMBERSHIP_FARMER_A).role = "OWNER";

		await expect(updateMemberContactEmail(FARMER_A_ID, "co-owner@example.com")).resolves.toEqual({
			success: true,
		});
	});

	it("refuses an account that also belongs to an organization the caller does not administer", async () => {
		tenancy().tables.memberships.push({
			id: "membership-farmer-a-in-b",
			orgId: ORG_B_ID,
			userId: FARMER_A_ID,
			role: "OPERATOR",
			invitedBy: null,
			createdAt: new Date("2026-10-02T00:00:00.000Z"),
			revokedAt: null,
		});

		const result = await updateMemberContactEmail(FARMER_A_ID, "shared@example.com");

		expect(result).toEqual({ error: MEMBER_OTHER_ORG_EMAIL_MESSAGE });
		expect(userRow(FARMER_A_ID).contactEmail ?? null).toBeNull();
		expect(tenancy().tables.platformAuditLogs).toHaveLength(0);
	});

	it("ignores a revoked membership in another organization", async () => {
		tenancy().tables.memberships.push({
			id: "membership-farmer-a-in-b",
			orgId: ORG_B_ID,
			userId: FARMER_A_ID,
			role: "OPERATOR",
			invitedBy: null,
			createdAt: new Date("2026-10-02T00:00:00.000Z"),
			revokedAt: new Date("2026-10-03T00:00:00.000Z"),
		});

		await expect(updateMemberContactEmail(FARMER_A_ID, "ok@example.com")).resolves.toEqual({
			success: true,
		});
	});

	it("reports an address another account already holds, without writing an audit row", async () => {
		const conflict = Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
		vi.spyOn(tenancy().client.user, "update").mockRejectedValueOnce(conflict);

		const result = await updateMemberContactEmail(FARMER_A_ID, "taken@example.com");

		expect(result).toEqual({ error: CONTACT_EMAIL_TAKEN });
		expect(tenancy().tables.platformAuditLogs).toHaveLength(0);
	});

	it("flattens an unexpected failure and logs only the message", async () => {
		const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
		vi.spyOn(tenancy().client.user, "update").mockRejectedValueOnce(new Error("db down"));

		const result = await updateMemberContactEmail(FARMER_A_ID, "ok@example.com");

		expect(result).toEqual({ error: "Failed to update the email." });
		expect(consoleError).toHaveBeenCalledWith("[admin] updateMemberContactEmail error:", "db down");
	});
});
