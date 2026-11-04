import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TenancyDb } from "./helpers/tenancy";

/**
 * #808: revoking a member must not take the organization's ponds with them.
 *
 * `resolveOrgScope()` builds the admin-visible pond set from the `User.farmId`
 * of ACTIVE members, and `revokeMember()` only stamps `Membership.revokedAt`.
 * Before the fix the ponds on the revoked member's farm stayed in the database
 * but vanished from every remaining admin's console, because nothing else
 * contributed that farm to the scope.
 *
 * The owner decision is to reassign, not to block or archive: the ponds move to
 * the organization's anchor farm (its longest-standing active OWNER) inside the
 * revocation transaction. This suite runs the real `resolveOrgScope`,
 * `requireTenantAdmin` and `transferOrgPondsOnRevoke` against the two-org
 * fixture, so a regression really does remove the ponds from the admin view.
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

import { getPonds, revokeMember } from "@/lib/actions/admin";
import { resolveOrgPondAnchor, transferOrgPondsOnRevoke } from "@/lib/auth/org-pond-ownership";
import { EMPTY_SCOPE, resolveOrgScope } from "@/lib/auth/org-scope";
import { getCurrentUser } from "@/lib/auth/session";
import type { MemberRole } from "@prisma/client";
import {
	ADMIN_A_ID,
	FARMER_A_ID,
	FARM_A,
	FARM_A_ADMIN,
	FARM_A_PLATFORM_ADMIN,
	ORG_A_ID,
	PLATFORM_ADMIN_A_ID,
	POND_A_1,
	POND_A_2,
	POND_B_1,
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

beforeEach(() => {
	vi.clearAllMocks();
	tenancy().reset();
	signInAs(ADMIN_A_ID);
});

type StubMembership = { id: string; userId: string; role: MemberRole; createdAt: Date };

/**
 * Minimal stand-in for the Prisma delegates the ownership helpers call. The
 * in-memory tenancy fixture is already a Prisma-shaped double, but it cannot
 * express "no member left" or "same role, same age" without mutating the
 * shared fixture, so the edge cases use this instead.
 */
function stubClient(input: {
	memberships: StubMembership[];
	/** Per-user rows; omit to derive one farm per candidate user. */
	users?: Record<string, { farmId: string; displayName: string | null } | undefined>;
	ponds?: string[];
}) {
	const updateMany = vi.fn(async () => ({ count: input.ponds?.length ?? 0 }));
	const upsert = vi.fn(async () => ({ id: "farm-anchor" }));
	const client = {
		membership: { findMany: async () => input.memberships },
		user: {
			findUnique: async ({ where }: { where: { id: string } }) =>
				input.users
					? (input.users[where.id] ?? null)
					: { farmId: `farm-${where.id}`, displayName: null },
		},
		pond: {
			findMany: async () => (input.ponds ?? []).map((id) => ({ id })),
			updateMany,
		},
		farm: { upsert },
	} as unknown as Parameters<typeof resolveOrgPondAnchor>[0];

	return { client, updateMany, upsert };
}

describe("organization ponds survive a member revocation (#808)", () => {
	it("moves the revoked farm's ponds to the org anchor farm so the remaining admins still see them", async () => {
		// Baseline: the operator's farm is inside org A's scope today, so the
		// OWNER sees both ponds.
		const before = await resolveOrgScope();
		expect([...before.pondIds].sort()).toEqual([POND_A_1, POND_A_2].sort());
		expect(before.farmIds).toContain(FARM_A);

		await expect(revokeMember(FARMER_A_ID)).resolves.toEqual({ success: true });

		// The regression: with only `Membership.revokedAt` stamped, both pond ids
		// disappear from the scope because no active member owns FARM_A any more.
		const after = await resolveOrgScope();
		expect([...after.pondIds].sort()).toEqual([POND_A_1, POND_A_2].sort());
		expect(after.farmIds).not.toContain(FARM_A);
		expect(after.farmIds).toContain(FARM_A_ADMIN);

		// The admin console lists rows, not just ids.
		const { rows } = await getPonds();
		expect([...rows.map((row) => row.id)].sort()).toEqual([POND_A_1, POND_A_2].sort());
		expect(rows.every((row) => row.owner?.displayName === "Admin A")).toBe(true);
		expect(rows.some((row) => row.id === POND_B_1)).toBe(false);

		// Reassignment, not a widened scope: the ownership stamp moved to the
		// organization's primary OWNER's farm.
		const moved = tenancy().tables.ponds.filter((pond) => [POND_A_1, POND_A_2].includes(pond.id));
		expect(moved.map((pond) => pond.ownerId)).toEqual([FARM_A_ADMIN, FARM_A_ADMIN]);

		// #765 is untouched: the account keeps its login and its own farm, but no
		// longer owns (and so cannot write) the ponds it used to hold for the org.
		expect(userById(tenancy(), FARMER_A_ID).farmId).toBe(FARM_A);
		expect(moved.some((pond) => pond.ownerId === FARM_A)).toBe(false);

		// The revoked account itself still loses all organization scope.
		signInAs(FARMER_A_ID);
		expect(await resolveOrgScope()).toEqual(EMPTY_SCOPE);
	});

	it("never picks the revoked member as the anchor farm", async () => {
		// Org A's oldest membership is ADMIN_A, an OWNER. Revoking them must hand
		// the ponds to the next OWNER by age, not back to the member losing them.
		// The in-memory fixture is a Prisma-shaped double, not a Prisma client, so
		// it is cast to the delegate subset the helper actually calls.
		const anchor = await resolveOrgPondAnchor(tenancy().client as never, {
			orgId: ORG_A_ID,
			excludeUserId: ADMIN_A_ID,
		});

		expect(anchor).toMatchObject({
			userId: PLATFORM_ADMIN_A_ID,
			ownerId: FARM_A_PLATFORM_ADMIN,
			role: "OWNER",
		});
	});

	it("ranks role above membership age when choosing the anchor", async () => {
		// The VIEWER joined first, but the ponds have to land on a farm that can
		// manage them, so role wins and age only breaks ties inside a role.
		const { client } = stubClient({
			memberships: [
				{
					id: "m-viewer",
					userId: "u-viewer",
					role: "VIEWER",
					createdAt: new Date("2020-01-01"),
				},
				{ id: "m-admin", userId: "u-admin", role: "ADMIN", createdAt: new Date("2024-01-01") },
			],
		});

		const anchor = await resolveOrgPondAnchor(client, {
			orgId: "org-a",
			excludeUserId: "u-owner",
		});

		expect(anchor).toMatchObject({ userId: "u-admin", ownerId: "farm-u-admin", role: "ADMIN" });
	});

	it("breaks a same-role tie by membership id, not read order", async () => {
		const joinedAt = new Date("2024-01-01");
		const { client } = stubClient({
			memberships: [
				{ id: "m-b", userId: "u-b", role: "OWNER", createdAt: joinedAt },
				{ id: "m-a", userId: "u-a", role: "OWNER", createdAt: joinedAt },
			],
		});

		const anchor = await resolveOrgPondAnchor(client, {
			orgId: "org-a",
			excludeUserId: "u-owner",
		});

		expect(anchor).toMatchObject({ userId: "u-a" });
	});

	it("moves nothing when there is no other member to receive the ponds", async () => {
		// Only the platform console can revoke the last member. There is no farm
		// to move to and nobody left to see the ponds, so the helper reports a
		// no-op instead of creating a farm or failing the revocation.
		const { client, upsert, updateMany } = stubClient({
			memberships: [],
			ponds: [POND_A_1],
		});

		await expect(
			transferOrgPondsOnRevoke(client, {
				orgId: ORG_A_ID,
				revokedUserId: FARMER_A_ID,
				revokedFarmId: FARM_A,
			}),
		).resolves.toEqual({ targetFarmId: null, targetOwnerId: null, movedCount: 0 });
		expect(upsert).not.toHaveBeenCalled();
		expect(updateMany).not.toHaveBeenCalled();
	});

	it("moves nothing when the member has no ponds on their farm", async () => {
		const { client, upsert, updateMany } = stubClient({
			memberships: [
				{ id: "m-admin", userId: "u-admin", role: "OWNER", createdAt: new Date("2024-01-01") },
			],
			ponds: [],
		});

		await expect(
			transferOrgPondsOnRevoke(client, {
				orgId: ORG_A_ID,
				revokedUserId: FARMER_A_ID,
				revokedFarmId: FARM_A,
			}),
		).resolves.toEqual({ targetFarmId: null, targetOwnerId: null, movedCount: 0 });
		expect(upsert).not.toHaveBeenCalled();
		expect(updateMany).not.toHaveBeenCalled();
	});

	it("moves nothing when the revoked user row is already gone", async () => {
		const { client, updateMany } = stubClient({
			memberships: [
				{ id: "m-admin", userId: "u-admin", role: "OWNER", createdAt: new Date("2024-01-01") },
			],
			users: {},
			ponds: [POND_A_1],
		});

		await expect(
			transferOrgPondsOnRevoke(client, {
				orgId: ORG_A_ID,
				revokedUserId: FARMER_A_ID,
				revokedFarmId: FARM_A,
			}),
		).resolves.toEqual({ targetFarmId: null, targetOwnerId: null, movedCount: 0 });
		expect(updateMany).not.toHaveBeenCalled();
	});
});
