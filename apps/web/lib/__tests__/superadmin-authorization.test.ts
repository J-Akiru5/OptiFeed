import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	ADMIN_A_ID,
	ADMIN_B_ID,
	FARMER_A_ID,
	FARMER_B_ID,
	FIXED_NOW,
	ORG_A_ID,
	ORG_B_ID,
	PLATFORM_ADMIN_A_ID,
	type TenancyDb,
	userById,
} from "./helpers/tenancy";

/**
 * Runtime authorization matrix and failure-branch coverage for
 * `lib/actions/superadmin.ts`.
 *
 * The real `requirePlatformAdmin` gate and the real audit writer run against
 * the two-org tenancy database. The matrix proves that every export redirects a
 * tenant admin (and an admin whose grant was revoked/expired), then the failure
 * cases cover what the happy-path suites leave open: reason policy, typed
 * confirmations, last-admin protection, Supabase failures and the compensating
 * re-ban when the database half of a disable/enable fails.
 */

const holder = vi.hoisted(() => ({
	db: undefined as TenancyDb | undefined,
	auth: {
		createUser: vi.fn(),
		deleteUser: vi.fn(),
		updateUserById: vi.fn(),
	},
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
vi.mock("@/lib/auth/step-up", () => ({
	withStepUp: vi.fn(async (action: (stepUpAt: Date) => Promise<unknown>) => action(STEP_UP_AT)),
	isStepUpRequiredError: (error: unknown) =>
		typeof error === "object" &&
		error !== null &&
		(error as { code?: unknown }).code === "step_up_required",
}));
vi.mock("@/lib/supabase/admin", () => ({
	createAdminClient: () => ({ auth: { admin: holder.auth } }),
}));
vi.mock("@/lib/avatars", () => ({ getSignedAvatarUrls: vi.fn(async () => ({})) }));
vi.mock("@/i18n/routing", () => ({
	redirect: vi.fn(() => {
		throw new Error("NEXT_REDIRECT");
	}),
}));
vi.mock("next-intl/server", () => ({ getLocale: vi.fn(async () => "en") }));
vi.mock("next/headers", () => ({
	headers: vi.fn(
		async () =>
			new Headers({
				"x-forwarded-for": "203.0.113.20, 10.0.0.1",
				"user-agent": "vitest-superadmin-matrix",
			}),
	),
}));

import {
	createOrg,
	createPlatformUser,
	disablePlatformUser,
	enablePlatformUser,
	grantPlatformAdmin,
	listAllPonds,
	listAllUsers,
	listOrgOptions,
	listOrgs,
	revokePlatformAdmin,
	updatePlatformUser,
} from "@/lib/actions/superadmin";
import { getCurrentUser } from "@/lib/auth/session";
import { withStepUp } from "@/lib/auth/step-up";
import prisma from "@/lib/prisma";

const STEP_UP_AT = new Date("2026-10-29T07:00:00.000Z");
const STEPPED_UP = { error: "Re-enter your password to continue.", code: "step_up_required" };
const REASON = "Reviewed with the platform team on ticket 4412";

const mockUser = vi.mocked(getCurrentUser);
const mockWithStepUp = vi.mocked(withStepUp);

function tenancy(): TenancyDb {
	if (!holder.db) throw new Error("tenancy database was not initialised");
	return holder.db;
}

function signInAs(userId: string) {
	mockUser.mockResolvedValue(userById(tenancy(), userId) as never);
}

function grantTo(userId: string, overrides: Partial<Record<string, unknown>> = {}) {
	const existing = tenancy().tables.platformAdmins.find((row) => row.userId === userId);
	if (existing) {
		Object.assign(existing, { revokedAt: null, expiresAt: null, ...overrides });
		return existing;
	}
	const grant = {
		id: `grant-${userId}`,
		userId,
		grantedBy: PLATFORM_ADMIN_A_ID,
		expiresAt: null,
		revokedAt: null,
		mfaEnrolledAt: null,
		createdAt: FIXED_NOW,
		...overrides,
	};
	tenancy().tables.platformAdmins.push(grant);
	return grant;
}

function seedSecondAdmin() {
	grantTo(ADMIN_B_ID);
}

const allExports = [
	["listAllUsers", () => listAllUsers()],
	["listOrgs", () => listOrgs()],
	["listOrgOptions", () => listOrgOptions()],
	["listAllPonds", () => listAllPonds()],
	[
		"createPlatformUser",
		() =>
			createPlatformUser({
				reason: REASON,
				farmId: "matrix-user",
				displayName: "Matrix User",
				password: "temp-pass-1",
				kind: "ADMIN",
				orgId: ORG_A_ID,
			}),
	],
	["updatePlatformUser", () => updatePlatformUser(FARMER_B_ID, { displayName: "X" }, REASON)],
	["createOrg", () => createOrg({ name: "Matrix Org", reason: REASON })],
	["grantPlatformAdmin", () => grantPlatformAdmin(FARMER_B_ID, REASON)],
	["revokePlatformAdmin", () => revokePlatformAdmin(ADMIN_B_ID, REASON)],
	["disablePlatformUser", () => disablePlatformUser(FARMER_B_ID, REASON, "farm-b")],
	["enablePlatformUser", () => enablePlatformUser(FARMER_B_ID, REASON)],
] as const;

beforeEach(() => {
	vi.clearAllMocks();
	tenancy().reset();
	mockWithStepUp.mockImplementation(async (action: (stepUpAt: Date) => Promise<unknown>) =>
		action(STEP_UP_AT),
	);
	holder.auth.createUser.mockResolvedValue({
		data: { user: { id: "sb-created" } },
		error: null,
	});
	holder.auth.deleteUser.mockResolvedValue({ data: {}, error: null });
	holder.auth.updateUserById.mockResolvedValue({ data: {}, error: null });
	seedSecondAdmin();
	signInAs(PLATFORM_ADMIN_A_ID);
});

afterEach(() => {
	// Spies installed per test (the count/ban ordering and the failure
	// injections) must not leak into the next test's concurrency assertions.
	vi.restoreAllMocks();
});

describe("platform admin gate", () => {
	it.each(allExports)("%s redirects a tenant admin", async (_name, run) => {
		signInAs(ADMIN_A_ID);

		await expect(run()).rejects.toThrow("NEXT_REDIRECT");
		expect(holder.auth.createUser).not.toHaveBeenCalled();
		expect(holder.auth.updateUserById).not.toHaveBeenCalled();
	});

	it.each(allExports)("%s redirects a revoked platform grant", async (_name, run) => {
		const grant = tenancy().tables.platformAdmins.find((row) => row.userId === PLATFORM_ADMIN_A_ID);
		if (!grant) throw new Error("fixture grant missing");
		grant.revokedAt = FIXED_NOW;

		await expect(run()).rejects.toThrow("NEXT_REDIRECT");
	});

	it.each(allExports)("%s redirects an expired temporary grant", async (_name, run) => {
		const grant = tenancy().tables.platformAdmins.find((row) => row.userId === PLATFORM_ADMIN_A_ID);
		if (!grant) throw new Error("fixture grant missing");
		grant.expiresAt = new Date("2026-01-01T00:00:00.000Z");

		await expect(run()).rejects.toThrow("NEXT_REDIRECT");
	});

	it.each(allExports.filter(([name]) => name !== "listAllUsers"))(
		"%s allows an active platform admin",
		async (_name, run) => {
			await expect(run()).resolves.toBeDefined();
		},
	);
});

describe("reason policy", () => {
	const mutations = [
		[
			"createPlatformUser",
			() =>
				createPlatformUser({
					reason: "short",
					farmId: "short-reason",
					displayName: "Short",
					password: "temp-pass-1",
					kind: "ADMIN",
					orgId: ORG_A_ID,
				}),
		],
		["updatePlatformUser", () => updatePlatformUser(FARMER_A_ID, { displayName: "X" }, "   ")],
		["createOrg", () => createOrg({ name: "Org", reason: "nope" })],
		["grantPlatformAdmin", () => grantPlatformAdmin(FARMER_A_ID, "nope")],
		["revokePlatformAdmin", () => revokePlatformAdmin(ADMIN_B_ID, "nope")],
		["disablePlatformUser", () => disablePlatformUser(FARMER_A_ID, "nope", "farm-a")],
		["enablePlatformUser", () => enablePlatformUser(FARMER_A_ID, "nope")],
	] as const;

	it.each(mutations)("%s refuses a reason shorter than 10 characters", async (_name, run) => {
		await expect(run()).rejects.toThrow("at least 10 characters");
		expect(tenancy().tables.platformAuditLogs).toHaveLength(0);
	});
});

describe("createPlatformUser validation", () => {
	const valid = {
		reason: REASON,
		farmId: "new-account",
		displayName: "New Account",
		password: "temp-pass-1",
		kind: "ADMIN" as const,
		orgId: ORG_A_ID,
	};

	it.each([
		["an invalid login id", { farmId: "Bad_ID" }, /lowercase alphanumeric/],
		["a blank display name", { displayName: "   " }, /Display name is required/],
		["an empty password", { password: "" }, /Password is required/],
		["a missing organization", { orgId: undefined }, /organization is required/i],
		["a duplicate login id", { farmId: "farm-a" }, /already exists/],
		["a missing organization row", { orgId: "org-missing" }, /Organization not found/],
		[
			"an out-of-range feeding rate",
			{ kind: "ORG_FARMER" as const, pond: { name: "Pond", feedingRatePct: 50, feedsPerDay: 2 } },
			/Feeding rate/,
		],
	])("rejects %s without creating a login", async (_label, override, message) => {
		const result = await createPlatformUser({ ...valid, ...override });

		expect(result).toEqual({ error: expect.stringMatching(message) });
		expect(holder.auth.createUser).not.toHaveBeenCalled();
		expect(tenancy().tables.platformAuditLogs).toHaveLength(0);
	});

	it("requires an initial pond for a farmer account", async () => {
		const result = await createPlatformUser({
			...valid,
			kind: "ORG_FARMER",
			pond: undefined,
		});

		expect(result).toEqual({ error: "An initial pond is required for a farmer account." });
	});

	it("creates a solo INDIVIDUAL org owned by an independent farmer", async () => {
		const result = await createPlatformUser({
			reason: REASON,
			farmId: "independent-one",
			displayName: "Independent One",
			password: "temp-pass-1",
			kind: "INDEPENDENT_FARMER",
			pond: { name: "Solo Pond", feedsPerDay: 2 },
		});
		if (!("success" in result)) throw new Error(`expected creation: ${result.error}`);

		const org = tenancy().tables.organizations.find(
			(row) => row.name === "Independent One (independent)",
		);
		expect(org).toMatchObject({ type: "INDIVIDUAL", status: "ACTIVE" });
		expect(tenancy().tables.memberships.find((row) => row.userId === result.userId)).toMatchObject({
			orgId: org?.id,
			role: "OWNER",
		});
		const pond = tenancy().tables.ponds.find((row) => row.ownerId === "independent-one");
		expect(pond).toMatchObject({ name: "Solo Pond", feedingRatePct: 3 });
	});

	it("inherits the organization's default feeding rate for a new farmer pond", async () => {
		tenancy().tables.orgSettings.push({
			orgId: ORG_A_ID,
			defaultFeedingRatePct: 4.5,
			hopperLowPct: 20,
			offlineAfterMin: 30,
			missedFeedingAlerts: true,
			alertRoles: ["OWNER", "ADMIN"],
			deviceRegistration: "ADMIN_APPROVAL",
			updatedById: null,
			updatedAt: FIXED_NOW,
		});

		const result = await createPlatformUser({
			reason: REASON,
			farmId: "org-farmer-default",
			displayName: "Org Farmer Default",
			password: "temp-pass-1",
			kind: "ORG_FARMER",
			orgId: ORG_A_ID,
			pond: { name: "Default Rate Pond", feedsPerDay: 2 },
		});

		expect(result).toMatchObject({ success: true });
		expect(
			tenancy().tables.ponds.find((row) => row.ownerId === "org-farmer-default")?.feedingRatePct,
		).toBe(4.5);
	});

	it("returns the Supabase error and leaves no app rows", async () => {
		holder.auth.createUser.mockResolvedValue({
			data: { user: null },
			error: { message: "auth unavailable" },
		});

		const result = await createPlatformUser(valid);

		expect(result).toEqual({ error: "Failed to create auth account: auth unavailable" });
		expect(tenancy().tables.users.some((row) => row.farmId === "new-account")).toBe(false);
	});

	it("rolls the login back when the transaction fails", async () => {
		const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
		vi.spyOn(prisma.user, "create").mockRejectedValueOnce(new Error("db down"));

		const result = await createPlatformUser(valid);

		expect(result).toEqual({ error: "Failed to create the user." });
		expect(holder.auth.deleteUser).toHaveBeenCalledWith("sb-created");
		consoleError.mockRestore();
	});

	it("answers not found for an unknown target", async () => {
		await expect(
			updatePlatformUser("missing-user", { displayName: "Ghost" }, REASON),
		).resolves.toEqual({ error: "User not found." });
	});

	it("rejects a blank display name instead of storing it (#335)", async () => {
		// The platform console now applies the same rule as the tenant action:
		// trim, required, max 80. This fixture used to pin the old gap.
		const result = await updatePlatformUser(FARMER_B_ID, { displayName: "   " }, REASON);

		expect(result).toEqual({ error: "Display name is required." });
		expect(tenancy().tables.users.find((row) => row.id === FARMER_B_ID)?.displayName).toBe(
			"Farmer B",
		);
	});
});

describe("createOrg validation", () => {
	it("rejects a blank name without writing an audit row", async () => {
		await expect(createOrg({ name: "  ", reason: REASON })).resolves.toEqual({
			error: "Organization name is required.",
		});
		expect(tenancy().tables.platformAuditLogs).toHaveLength(0);
	});
});

describe("grantPlatformAdmin", () => {
	it("rejects an expiry that is not an ISO date", async () => {
		await expect(grantPlatformAdmin(FARMER_A_ID, REASON, "next-tuesday")).resolves.toEqual({
			error: "Expiry is not a valid ISO 8601 date.",
		});
	});

	it("answers not found for an unknown user", async () => {
		await expect(grantPlatformAdmin("missing-user", REASON)).resolves.toEqual({
			error: "User not found.",
		});
	});

	it("records the previous grant when re-granting after a revoke", async () => {
		grantTo(FARMER_A_ID, { revokedAt: new Date("2026-10-01T00:00:00.000Z") });

		await expect(grantPlatformAdmin(FARMER_A_ID, REASON)).resolves.toEqual({ success: true });

		const updated = tenancy().tables.platformAdmins.find((row) => row.userId === FARMER_A_ID);
		expect(updated).toMatchObject({ revokedAt: null, grantedBy: PLATFORM_ADMIN_A_ID });
		const auditRow = tenancy().tables.platformAuditLogs.find(
			(row) => row.action === "platform.admin.grant",
		);
		expect(auditRow).toMatchObject({
			targetId: FARMER_A_ID,
			actorUserId: PLATFORM_ADMIN_A_ID,
			stepUpAt: STEP_UP_AT,
			temporaryGrant: false,
			before: { revokedAt: "2026-10-01T00:00:00.000Z", expiresAt: null },
			after: { expiresAt: null },
		});
	});

	it("returns a step-up failure and writes nothing", async () => {
		mockWithStepUp.mockRejectedValueOnce(STEPPED_UP);

		await expect(grantPlatformAdmin(FARMER_A_ID, REASON)).resolves.toMatchObject({
			code: "step_up_required",
		});
		expect(tenancy().tables.platformAuditLogs).toHaveLength(0);
	});
});

describe("revokePlatformAdmin", () => {
	it("answers not found when the user holds no grant", async () => {
		await expect(revokePlatformAdmin(FARMER_A_ID, REASON)).resolves.toEqual({
			error: "That user has no platform admin grant to revoke.",
		});
	});

	it("is idempotent for an already-revoked grant and writes no new audit row", async () => {
		grantTo(ADMIN_B_ID, { revokedAt: new Date("2026-10-01T00:00:00.000Z") });

		await expect(revokePlatformAdmin(ADMIN_B_ID, REASON)).resolves.toEqual({ success: true });
		expect(tenancy().tables.platformAuditLogs).toHaveLength(0);
	});

	it("never lets an admin revoke their own grant", async () => {
		await expect(revokePlatformAdmin(PLATFORM_ADMIN_A_ID, REASON)).resolves.toEqual({
			error: "You cannot revoke your own platform admin grant.",
		});
		expect(tenancy().tables.platformAuditLogs).toHaveLength(0);
	});

	it("revokes another admin's grant and audits the step-up time", async () => {
		await expect(revokePlatformAdmin(ADMIN_B_ID, REASON)).resolves.toEqual({ success: true });

		const grant = tenancy().tables.platformAdmins.find((row) => row.userId === ADMIN_B_ID);
		expect(grant?.revokedAt).toBeInstanceOf(Date);
		const auditRow = tenancy().tables.platformAuditLogs.find(
			(row) => row.action === "platform.admin.revoke",
		);
		expect(auditRow).toMatchObject({
			targetId: ADMIN_B_ID,
			actorUserId: PLATFORM_ADMIN_A_ID,
			stepUpAt: STEP_UP_AT,
			before: { expiresAt: null },
		});
	});

	it("returns a step-up failure and leaves the grant active", async () => {
		mockWithStepUp.mockRejectedValueOnce(STEPPED_UP);

		await expect(revokePlatformAdmin(ADMIN_B_ID, REASON)).resolves.toMatchObject({
			code: "step_up_required",
		});
		expect(
			tenancy().tables.platformAdmins.find((row) => row.userId === ADMIN_B_ID)?.revokedAt,
		).toBeNull();
	});
});

describe("disablePlatformUser", () => {
	it("answers not found for an unknown user", async () => {
		await expect(disablePlatformUser("missing-user", REASON, "farm-x")).resolves.toEqual({
			error: "User not found.",
		});
	});

	it("protects the primary superadmin account", async () => {
		tenancy().tables.users.push({
			id: "user-super",
			supabaseId: "sb-super",
			farmId: "superadmin",
			email: "superadmin@pond.optifeed.local",
			displayName: "Superadmin",
			role: "ADMIN",
			mustChangePassword: false,
			createdAt: FIXED_NOW,
			updatedAt: FIXED_NOW,
		});

		await expect(disablePlatformUser("user-super", REASON, "superadmin")).resolves.toEqual({
			error: "The primary superadmin account cannot be disabled.",
		});
		expect(holder.auth.updateUserById).not.toHaveBeenCalled();
	});

	it("refuses a typed farm id that does not match exactly", async () => {
		await expect(disablePlatformUser(FARMER_B_ID, REASON, "FARM-B")).resolves.toEqual({
			error: "Type farm-b exactly to confirm.",
		});
		expect(holder.auth.updateUserById).not.toHaveBeenCalled();
	});

	it("refuses to leave the platform with no active admin", async () => {
		const secondGrant = tenancy().tables.platformAdmins.find((row) => row.userId === ADMIN_B_ID);
		if (!secondGrant) throw new Error("second grant missing");
		secondGrant.revokedAt = FIXED_NOW;

		await expect(
			disablePlatformUser(PLATFORM_ADMIN_A_ID, REASON, "farm-platform-a"),
		).resolves.toEqual({
			error: "At least one active platform administrator must remain. Grant another admin first.",
		});
		expect(holder.auth.updateUserById).not.toHaveBeenCalled();
	});

	it("does not touch the database when the Supabase ban fails", async () => {
		const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
		holder.auth.updateUserById.mockResolvedValue({
			data: {},
			error: { message: "auth down" },
		});

		await expect(disablePlatformUser(FARMER_B_ID, REASON, "farm-b")).resolves.toEqual({
			error: "Failed to disable the user.",
		});
		expect(
			tenancy().tables.memberships.find((row) => row.userId === FARMER_B_ID)?.revokedAt,
		).toBeNull();
		expect(tenancy().tables.platformAuditLogs).toHaveLength(0);
		consoleError.mockRestore();
	});

	it("re-bans the login when the database half fails after the ban", async () => {
		const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
		vi.spyOn(prisma.membership, "updateMany").mockRejectedValueOnce(new Error("db down"));

		await expect(disablePlatformUser(FARMER_B_ID, REASON, "farm-b")).resolves.toEqual({
			error: "Failed to disable the user.",
		});
		expect(holder.auth.updateUserById).toHaveBeenNthCalledWith(1, "sb-farmer-b", {
			ban_duration: "876000h",
		});
		expect(holder.auth.updateUserById).toHaveBeenNthCalledWith(2, "sb-farmer-b", {
			ban_duration: "none",
		});
		consoleError.mockRestore();
	});

	it("returns a step-up failure without banning the login", async () => {
		mockWithStepUp.mockRejectedValueOnce(STEPPED_UP);

		await expect(disablePlatformUser(FARMER_B_ID, REASON, "farm-b")).resolves.toMatchObject({
			code: "step_up_required",
		});
		expect(holder.auth.updateUserById).not.toHaveBeenCalled();
	});

	it("revokes the target's platform grant and records it for a reversible enable", async () => {
		grantTo(FARMER_B_ID);

		await expect(disablePlatformUser(FARMER_B_ID, REASON, "farm-b")).resolves.toEqual({
			success: true,
		});

		expect(
			tenancy().tables.platformAdmins.find((row) => row.userId === FARMER_B_ID)?.revokedAt,
		).toBeInstanceOf(Date);
		const auditRow = tenancy().tables.platformAuditLogs.find(
			(row) => row.action === "platform.user.disable",
		);
		expect(auditRow).toMatchObject({
			targetId: FARMER_B_ID,
			orgId: ORG_B_ID,
			stepUpAt: STEP_UP_AT,
			after: { platformAdminRevoked: true },
		});
	});

	it("takes the grant row lock before counting, inside the transaction", async () => {
		// The lock is what makes the count meaningful: without it a concurrent
		// disable could commit between the count and the ban (#334).
		grantTo(FARMER_B_ID);
		const order: string[] = [];
		const rawQuery = prisma.$queryRaw;
		vi.spyOn(prisma, "$queryRaw").mockImplementation((async (...args: unknown[]) => {
			order.push("lock");
			return (rawQuery as (...rest: unknown[]) => unknown)(...args);
		}) as never);
		vi.spyOn(prisma.platformAdmin, "count").mockImplementation((async () => {
			order.push("count");
			return 2;
		}) as never);
		holder.auth.updateUserById.mockImplementation(async () => {
			order.push("ban");
			return { data: {}, error: null };
		});

		await expect(disablePlatformUser(FARMER_B_ID, REASON, "farm-b")).resolves.toEqual({
			success: true,
		});
		expect(order).toEqual(["lock", "count", "ban"]);
	});

	it("cannot let two concurrent disables leave the platform with no active admin", async () => {
		// The fixture seeds exactly two active admins (A and B). A disables B
		// while B disables A. Both pre-checks pass because they run before either
		// transaction, so the grant row lock is the only thing that stops both
		// from revoking a grant and banning a login.
		const results = await Promise.all([
			disablePlatformUser(ADMIN_B_ID, REASON, "farm-b-admin"),
			disablePlatformUser(PLATFORM_ADMIN_A_ID, REASON, "farm-platform-a"),
		]);

		expect(results.filter((result) => "success" in result)).toHaveLength(1);
		expect(results.filter((result) => "error" in result)).toEqual([
			{
				error: "At least one active platform administrator must remain. Grant another admin first.",
			},
		]);

		const activeAdmins = tenancy().tables.platformAdmins.filter(
			(row) => row.revokedAt === null && (row.expiresAt === null || row.expiresAt > new Date()),
		);
		expect(activeAdmins).toHaveLength(1);
		// Exactly one login was banned: the refusal happens before its ban.
		expect(holder.auth.updateUserById).toHaveBeenCalledTimes(1);
		expect(
			tenancy().tables.platformAuditLogs.filter((row) => row.action === "platform.user.disable"),
		).toHaveLength(1);
	});
});

describe("enablePlatformUser", () => {
	it("answers not found for an unknown user", async () => {
		await expect(enablePlatformUser("missing-user", REASON)).resolves.toEqual({
			error: "User not found.",
		});
	});

	it("keeps valid ids from a malformed disable record and restores no grant", async () => {
		tenancy().tables.platformAuditLogs.push({
			id: "audit-malformed",
			actorUserId: PLATFORM_ADMIN_A_ID,
			action: "platform.user.disable",
			targetType: "user",
			targetId: FARMER_B_ID,
			orgId: null,
			reason: REASON,
			stepUpAt: null,
			temporaryGrant: false,
			impersonationId: null,
			before: null,
			after: {
				disabledAt: "not-a-date",
				revokedMembershipIds: ["membership-b", 42, null],
				platformAdminRevoked: "yes",
			},
			ip: null,
			userAgent: null,
			createdAt: FIXED_NOW,
		});
		const restore = vi.spyOn(prisma.membership, "updateMany");
		const restoreGrant = vi.spyOn(prisma.platformAdmin, "updateMany");

		await expect(enablePlatformUser(FARMER_B_ID, REASON)).resolves.toEqual({ success: true });

		expect(holder.auth.updateUserById).toHaveBeenCalledWith("sb-farmer-b", {
			ban_duration: "none",
		});
		// The string id survives, the junk entries are dropped, and an invalid
		// timestamp falls back to "any revoked row for this user".
		expect(restore).toHaveBeenCalledWith({
			where: {
				id: { in: ["membership-b"] },
				userId: FARMER_B_ID,
				revokedAt: { not: null },
			},
			data: { revokedAt: null },
		});
		// A non-boolean flag must never re-grant god-mode.
		expect(restoreGrant).not.toHaveBeenCalled();
		const auditRow = tenancy().tables.platformAuditLogs.find(
			(row) => row.action === "platform.user.enable",
		);
		expect(auditRow).toMatchObject({
			after: { restoredMembershipIds: ["membership-b"], platformAdminRestored: false },
		});
	});

	it("treats an array or null disable record as nothing to restore", async () => {
		const membership = tenancy().tables.memberships.find((row) => row.userId === FARMER_B_ID);
		if (!membership) throw new Error("fixture membership missing");
		membership.revokedAt = FIXED_NOW;
		tenancy().tables.platformAuditLogs.push({
			id: "audit-array",
			actorUserId: PLATFORM_ADMIN_A_ID,
			action: "platform.user.disable",
			targetType: "user",
			targetId: FARMER_B_ID,
			orgId: null,
			reason: REASON,
			stepUpAt: null,
			temporaryGrant: false,
			impersonationId: null,
			before: null,
			after: ["not", "an", "object"],
			ip: null,
			userAgent: null,
			createdAt: FIXED_NOW,
		});

		await expect(enablePlatformUser(FARMER_B_ID, REASON)).resolves.toEqual({ success: true });
		// Nothing was recorded, so nothing is restored: the membership stays revoked.
		expect(
			tenancy().tables.memberships.find((row) => row.userId === FARMER_B_ID)?.revokedAt,
		).toBeInstanceOf(Date);
	});

	it("does not touch the database when the Supabase unban fails", async () => {
		const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
		holder.auth.updateUserById.mockResolvedValue({
			data: {},
			error: { message: "auth down" },
		});

		await expect(enablePlatformUser(FARMER_B_ID, REASON)).resolves.toEqual({
			error: "Failed to enable the user.",
		});
		expect(tenancy().tables.platformAuditLogs).toHaveLength(0);
		consoleError.mockRestore();
	});

	it("re-bans the login when the restore transaction fails", async () => {
		const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
		grantTo(FARMER_B_ID);
		await disablePlatformUser(FARMER_B_ID, REASON, "farm-b");
		vi.spyOn(prisma.membership, "updateMany").mockRejectedValueOnce(new Error("db down"));

		await expect(enablePlatformUser(FARMER_B_ID, REASON)).resolves.toEqual({
			error: "Failed to enable the user.",
		});
		expect(holder.auth.updateUserById).toHaveBeenLastCalledWith("sb-farmer-b", {
			ban_duration: "876000h",
		});
		expect(
			tenancy().tables.platformAdmins.find((row) => row.userId === FARMER_B_ID)?.revokedAt,
		).toBeInstanceOf(Date);
		consoleError.mockRestore();
	});

	it("returns a step-up failure without unbanning the login", async () => {
		mockWithStepUp.mockRejectedValueOnce(STEPPED_UP);

		await expect(enablePlatformUser(FARMER_B_ID, REASON)).resolves.toMatchObject({
			code: "step_up_required",
		});
		expect(holder.auth.updateUserById).not.toHaveBeenCalled();
	});

	it("round-trips a disable: memberships and the platform grant come back", async () => {
		grantTo(FARMER_B_ID);

		await expect(disablePlatformUser(FARMER_B_ID, REASON, "farm-b")).resolves.toEqual({
			success: true,
		});
		expect(
			tenancy().tables.memberships.find((row) => row.userId === FARMER_B_ID)?.revokedAt,
		).toBeInstanceOf(Date);
		expect(
			tenancy().tables.platformAdmins.find((row) => row.userId === FARMER_B_ID)?.revokedAt,
		).toBeInstanceOf(Date);

		await expect(enablePlatformUser(FARMER_B_ID, REASON)).resolves.toEqual({ success: true });

		expect(
			tenancy().tables.memberships.find((row) => row.userId === FARMER_B_ID)?.revokedAt,
		).toBeNull();
		expect(
			tenancy().tables.platformAdmins.find((row) => row.userId === FARMER_B_ID)?.revokedAt,
		).toBeNull();
		const enableAudit = tenancy().tables.platformAuditLogs.find(
			(row) => row.action === "platform.user.enable",
		);
		expect(enableAudit).toMatchObject({
			after: {
				restoredMembershipIds: [expect.any(String)],
				platformAdminRestored: true,
			},
		});
	});
});
