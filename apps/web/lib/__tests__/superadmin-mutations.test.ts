import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TenancyDb } from "./helpers/tenancy";

/**
 * Behavioural tests for the superadmin mutations not already covered by
 * `superadmin-step-up.test.ts` (grant/revoke/disable/enable): createPlatformUser,
 * updatePlatformUser and createOrg.
 *
 * Each mutation gets an allowed case, a denial for a caller who is not a
 * platform admin, and an assertion that exactly one audit row is written with
 * the caller's reason. The real `requirePlatformAdmin()` gate runs against the
 * two-org fixture, so a tenant admin is denied by the same code path production
 * uses, not by a stubbed gate.
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

vi.mock("@/lib/supabase/admin", () => ({
	createAdminClient: () => ({ auth: { admin: auth } }),
}));

vi.mock("@/i18n/routing", () => ({
	redirect: vi.fn(() => {
		throw new Error("NEXT_REDIRECT");
	}),
}));

vi.mock("next-intl/server", () => ({
	getLocale: vi.fn(async () => "en"),
}));

import { createOrg, createPlatformUser, updatePlatformUser } from "@/lib/actions/superadmin";
import { getCurrentUser } from "@/lib/auth/session";
import {
	ADMIN_A_ID,
	FARMER_B_ID,
	ORG_A_ID,
	ORG_B_ID,
	PLATFORM_ADMIN_A_ID,
	userById,
} from "./helpers/tenancy";

const REASON = "Support ticket 4412 reviewed by the platform team";
const mockUser = vi.mocked(getCurrentUser);

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
		data: { user: { id: "sb-created-user" } },
		error: null,
	});
	auth.deleteUser.mockReset().mockResolvedValue({ data: {}, error: null });
	signInAs(PLATFORM_ADMIN_A_ID);
});

describe("createPlatformUser", () => {
	it("creates an org farmer with farm, pond and org A membership, and one audit row", async () => {
		const result = await createPlatformUser({
			reason: `  ${REASON}  `,
			farmId: "new-farmer-a",
			displayName: "New Farmer A",
			password: "temp-pass-1",
			kind: "ORG_FARMER",
			orgId: ORG_A_ID,
			pond: { name: "New Farmer Pond", feedingRatePct: 3, feedsPerDay: 2 },
		});

		expect(result).toMatchObject({ success: true });
		if (!("success" in result)) throw new Error("expected creation");

		const user = tenancy().tables.users.find((row) => row.id === result.userId);
		expect(user).toMatchObject({
			farmId: "new-farmer-a",
			email: "new-farmer-a@pond.optifeed.local",
			displayName: "New Farmer A",
			role: "OPERATOR",
			mustChangePassword: true,
		});
		const membership = tenancy().tables.memberships.find((row) => row.userId === result.userId);
		expect(membership).toMatchObject({ orgId: ORG_A_ID, role: "OPERATOR" });
		const farm = tenancy().tables.farms.find((row) => row.ownerId === "new-farmer-a");
		expect(farm).toBeTruthy();
		const pond = tenancy().tables.ponds.find((row) => row.ownerId === "new-farmer-a");
		expect(pond).toMatchObject({ name: "New Farmer Pond", farmId: farm?.id });

		const audits = tenancy().tables.platformAuditLogs;
		expect(audits).toHaveLength(1);
		expect(audits[0]).toMatchObject({
			action: "platform.user.create",
			targetType: "platform_console",
			targetId: result.userId,
			reason: REASON,
			actorUserId: PLATFORM_ADMIN_A_ID,
			after: {
				farmId: "new-farmer-a",
				kind: "ORG_FARMER",
				role: "OPERATOR",
				orgId: ORG_A_ID,
			},
		});
	});

	it("can create an org admin in another tenant (god mode) with one audit row", async () => {
		const result = await createPlatformUser({
			reason: REASON,
			farmId: "new-admin-b",
			displayName: "New Admin B",
			password: "temp-pass-1",
			kind: "ADMIN",
			orgId: ORG_B_ID,
		});

		expect(result).toMatchObject({ success: true });
		if (!("success" in result)) throw new Error("expected creation");

		const membership = tenancy().tables.memberships.find((row) => row.userId === result.userId);
		expect(membership).toMatchObject({ orgId: ORG_B_ID, role: "OWNER" });
		expect(tenancy().tables.users.find((row) => row.id === result.userId)?.role).toBe("ADMIN");
		// An ADMIN has no farmer function: no farm or pond is created.
		expect(tenancy().tables.farms.some((row) => row.ownerId === "new-admin-b")).toBe(false);
		expect(tenancy().tables.ponds.some((row) => row.ownerId === "new-admin-b")).toBe(false);

		expect(tenancy().tables.platformAuditLogs).toHaveLength(1);
		expect(tenancy().tables.platformAuditLogs[0]).toMatchObject({
			action: "platform.user.create",
			reason: REASON,
			actorUserId: PLATFORM_ADMIN_A_ID,
			after: { orgId: ORG_B_ID, role: "ADMIN", kind: "ADMIN" },
		});
	});

	it("denies a tenant admin and writes no user, auth account or audit row", async () => {
		signInAs(ADMIN_A_ID);
		const usersBefore = tenancy().tables.users.length;

		await expect(
			createPlatformUser({
				reason: REASON,
				farmId: "forbidden-farmer",
				displayName: "Forbidden",
				password: "temp-pass-1",
				kind: "ORG_FARMER",
				orgId: ORG_A_ID,
				pond: { name: "Nope", feedingRatePct: 3, feedsPerDay: 2 },
			}),
		).rejects.toThrow("NEXT_REDIRECT");

		expect(tenancy().tables.users).toHaveLength(usersBefore);
		expect(tenancy().tables.platformAuditLogs).toHaveLength(0);
		expect(auth.createUser).not.toHaveBeenCalled();
	});
});

describe("updatePlatformUser", () => {
	it("updates a user in another tenant and records before/after in one audit row", async () => {
		const result = await updatePlatformUser(
			FARMER_B_ID,
			{ displayName: "Renamed Farmer B", role: "VIEWER" },
			REASON,
		);

		expect(result).toEqual({ success: true, userId: FARMER_B_ID });
		const updated = tenancy().tables.users.find((row) => row.id === FARMER_B_ID);
		expect(updated).toMatchObject({ displayName: "Renamed Farmer B", role: "VIEWER" });

		const audits = tenancy().tables.platformAuditLogs;
		expect(audits).toHaveLength(1);
		expect(audits[0]).toMatchObject({
			action: "platform.user.update",
			targetType: "platform_console",
			targetId: FARMER_B_ID,
			reason: REASON,
			actorUserId: PLATFORM_ADMIN_A_ID,
			before: { displayName: "Farmer B", role: "OPERATOR" },
			after: { displayName: "Renamed Farmer B", role: "VIEWER" },
		});
	});

	it("answers not found for an unknown user without an audit row", async () => {
		const result = await updatePlatformUser("missing-user", { displayName: "Ghost" }, REASON);

		expect(result).toEqual({ error: "User not found." });
		expect(tenancy().tables.platformAuditLogs).toHaveLength(0);
	});

	it("denies a tenant admin and changes nothing", async () => {
		signInAs(ADMIN_A_ID);

		await expect(
			updatePlatformUser(FARMER_B_ID, { displayName: "Hijacked" }, REASON),
		).rejects.toThrow("NEXT_REDIRECT");

		expect(tenancy().tables.users.find((row) => row.id === FARMER_B_ID)?.displayName).toBe(
			"Farmer B",
		);
		expect(tenancy().tables.platformAuditLogs).toHaveLength(0);
	});
});

describe("createOrg", () => {
	it("creates the organization and one audit row with the reason", async () => {
		const result = await createOrg({
			name: "  Lalawigan LGU  ",
			type: "LGU",
			reason: REASON,
		});

		expect(result).toMatchObject({ success: true });
		if (!("success" in result)) throw new Error("expected creation");
		const org = tenancy().tables.organizations.find((row) => row.id === result.orgId);
		expect(org).toMatchObject({
			name: "Lalawigan LGU",
			type: "LGU",
			status: "ACTIVE",
		});

		const audits = tenancy().tables.platformAuditLogs;
		expect(audits).toHaveLength(1);
		expect(audits[0]).toMatchObject({
			action: "platform.org.create",
			targetType: "platform_console",
			targetId: result.orgId,
			reason: REASON,
			actorUserId: PLATFORM_ADMIN_A_ID,
			after: { name: "Lalawigan LGU", type: "LGU" },
		});
	});

	it("rejects an empty name without writing", async () => {
		const before = tenancy().tables.organizations.length;
		const result = await createOrg({ name: "   ", reason: REASON });

		expect(result).toEqual({ error: "Organization name is required." });
		expect(tenancy().tables.organizations).toHaveLength(before);
		expect(tenancy().tables.platformAuditLogs).toHaveLength(0);
	});

	it("denies a tenant admin and creates no organization", async () => {
		signInAs(ADMIN_A_ID);
		const before = tenancy().tables.organizations.length;

		await expect(createOrg({ name: "Forbidden Org", reason: REASON })).rejects.toThrow(
			"NEXT_REDIRECT",
		);

		expect(tenancy().tables.organizations).toHaveLength(before);
		expect(tenancy().tables.platformAuditLogs).toHaveLength(0);
	});
});
