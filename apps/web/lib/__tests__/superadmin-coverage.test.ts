import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Behavioural coverage for the superadmin read surface and its pagination.
 *
 * These functions are read-only but platform-wide, so each one is tested for
 * both outcomes of the `requirePlatformAdmin` gate and for the joins that make
 * the console honest: who is disabled, which org a user belongs to, how many
 * ponds an org's members own, and what an expired/revoked admin grant shows.
 */

const { db, avatarUrls } = vi.hoisted(() => ({
	db: {
		user: { count: vi.fn(), findMany: vi.fn() },
		organization: { count: vi.fn(), findMany: vi.fn() },
		pond: { count: vi.fn(), findMany: vi.fn() },
		membership: { findMany: vi.fn(), groupBy: vi.fn() },
		platformAdmin: { findMany: vi.fn() },
		platformAuditLog: { findMany: vi.fn() },
		platformSetting: { findUnique: vi.fn() },
	},
	avatarUrls: vi.fn(async () => ({})),
}));

vi.mock("@/lib/prisma", () => ({ default: db }));
vi.mock("@/lib/auth/require-platform-admin", () => ({ requirePlatformAdmin: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({
	getCurrentUser: vi.fn(),
	buildPondEmail: vi.fn(),
}));
vi.mock("@/lib/auth/session-cache", () => ({ invalidateFarm: vi.fn() }));
vi.mock("@/lib/auth/step-up", () => ({
	withStepUp: vi.fn(),
	isStepUpRequiredError: vi.fn(() => false),
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/avatars", () => ({ getSignedAvatarUrls: avatarUrls }));
vi.mock("next/headers", () => ({ headers: vi.fn(async () => new Headers()) }));

import {
	getPlatformAdmins,
	getSuperadminStats,
	listAllPonds,
	listAllUsers,
	listOrgOptions,
	listOrgs,
} from "@/lib/actions/superadmin";
import { requirePlatformAdmin } from "@/lib/auth/require-platform-admin";

const mockGate = vi.mocked(requirePlatformAdmin);

const NOW = new Date("2026-10-29T08:00:00.000Z");
const PAST = new Date(Date.now() - 24 * 60 * 60 * 1000);
const FUTURE = new Date(Date.now() + 24 * 60 * 60 * 1000);
const NEW_ORIGIN = new Date("2026-10-01T00:00:00.000Z");

function userRow(id: string, overrides: Record<string, unknown> = {}) {
	return {
		id,
		farmId: `farm-${id}`,
		email: `${id}@pond.optifeed.local`,
		displayName: `User ${id}`,
		avatarPath: null,
		role: "OPERATOR",
		createdAt: NOW,
		_count: { ponds: 0 },
		...overrides,
	};
}

beforeEach(() => {
	vi.clearAllMocks();
	mockGate.mockResolvedValue(undefined);
	avatarUrls.mockResolvedValue({});
	db.platformSetting.findUnique.mockResolvedValue(null);
	db.membership.groupBy.mockResolvedValue([]);
	db.platformAdmin.findMany.mockResolvedValue([]);
	db.platformAuditLog.findMany.mockResolvedValue([]);
	db.organization.findMany.mockResolvedValue([]);
});

describe("getSuperadminStats", () => {
	it("counts every row but only unrevoked, unexpired grants as active", async () => {
		db.user.count.mockResolvedValue(7);
		db.organization.count.mockResolvedValue(3);
		db.pond.count.mockResolvedValue(5);
		db.platformAdmin.findMany.mockResolvedValue([
			{ revokedAt: null, expiresAt: null },
			{ revokedAt: NEW_ORIGIN, expiresAt: null },
			{ revokedAt: null, expiresAt: PAST },
			{ revokedAt: null, expiresAt: FUTURE },
		]);

		await expect(getSuperadminStats()).resolves.toEqual({
			userCount: 7,
			orgCount: 3,
			pondCount: 5,
			platformAdminCount: 4,
			activePlatformAdminCount: 2,
		});
	});

	it("denies a caller without a platform-admin grant", async () => {
		mockGate.mockRejectedValueOnce(new Error("NEXT_REDIRECT"));

		await expect(getSuperadminStats()).rejects.toThrow("NEXT_REDIRECT");
		expect(db.user.count).not.toHaveBeenCalled();
	});
});

describe("listAllUsers", () => {
	it("resolves orgs, pond counts, platform-admin badges and the latest safety action", async () => {
		db.user.count.mockResolvedValue(2);
		db.user.findMany.mockResolvedValue([
			userRow("u1", { _count: { ponds: 2 } }),
			userRow("u2", { _count: { ponds: 1 } }),
		]);
		db.membership.findMany.mockResolvedValue([
			{ userId: "u1", orgId: "org-a", role: "OWNER" },
			// u2's membership points at an org that no longer resolves.
			{ userId: "u2", orgId: "org-gone", role: "OPERATOR" },
		]);
		db.platformAdmin.findMany.mockResolvedValue([{ userId: "u1" }]);
		// Newest first: u2's most recent safety action is a disable.
		db.platformAuditLog.findMany.mockResolvedValue([
			{ action: "platform.user.disable", targetId: "u2" },
			{ action: "platform.user.enable", targetId: "u2" },
		]);
		db.membership.groupBy.mockResolvedValue([{ orgId: "org-a", _count: { _all: 4 } }]);
		db.organization.findMany.mockResolvedValue([{ id: "org-a", name: "Org A" }]);

		const page = await listAllUsers();

		expect(page).toMatchObject({ total: 2, page: 1, pageSize: 20 });
		const u1 = page.rows.find((row) => row.id === "u1");
		expect(u1).toMatchObject({
			isPlatformAdmin: true,
			disabled: false,
			avatarUrl: null,
			pondCount: 2,
			orgs: [{ id: "org-a", name: "Org A", role: "OWNER", memberCount: 4 }],
		});
		const u2 = page.rows.find((row) => row.id === "u2");
		expect(u2).toMatchObject({ isPlatformAdmin: false, disabled: true, orgs: [] });
	});

	it("truncates a long search term before it reaches the query", async () => {
		db.user.count.mockResolvedValue(0);
		db.user.findMany.mockResolvedValue([]);

		await listAllUsers({ query: `  ${"x".repeat(200)}  `, page: 0 });

		const args = db.user.findMany.mock.calls[0]?.[0];
		expect(args.where.OR[0].farmId.contains).toHaveLength(64);
		expect(args.skip).toBe(0);
		expect(db.membership.findMany).not.toHaveBeenCalled();
	});

	it("clamps a page beyond the last one and re-queries the real page", async () => {
		db.user.count.mockResolvedValue(100);
		db.user.findMany.mockResolvedValueOnce([userRow("u1")]).mockResolvedValueOnce([]);

		const page = await listAllUsers({ page: 99 });

		expect(page).toEqual({ rows: [], total: 100, page: 5, pageSize: 20 });
		expect(db.user.findMany).toHaveBeenCalledTimes(2);
		expect(db.user.findMany.mock.calls[1]?.[0].skip).toBe(80);
	});

	it("denies a caller without a platform-admin grant", async () => {
		mockGate.mockRejectedValueOnce(new Error("NEXT_REDIRECT"));

		await expect(listAllUsers()).rejects.toThrow("NEXT_REDIRECT");
		expect(db.user.count).not.toHaveBeenCalled();
	});
});

describe("listOrgs", () => {
	it("fills member and pond totals from the org's members", async () => {
		db.organization.count.mockResolvedValue(1);
		db.organization.findMany.mockResolvedValue([
			{
				id: "org-a",
				name: "Org A",
				type: "COOPERATIVE",
				status: "ACTIVE",
				createdAt: NOW,
			},
		]);
		db.membership.findMany.mockResolvedValue([
			{ orgId: "org-a", userId: "u1" },
			{ orgId: "org-a", userId: "u2" },
			// A ghost member must not contribute a pond count.
			{ orgId: "org-a", userId: "u-ghost" },
		]);
		db.user.findMany.mockResolvedValue([
			{ id: "u1", farmId: "farm-1" },
			{ id: "u2", farmId: "farm-2" },
		]);
		db.pond.findMany.mockResolvedValue([
			{ ownerId: "farm-1" },
			{ ownerId: "farm-1" },
			{ ownerId: "farm-2" },
		]);
		db.membership.groupBy.mockResolvedValue([{ orgId: "org-a", _count: { _all: 3 } }]);

		const page = await listOrgs();

		expect(page.rows).toEqual([
			{
				id: "org-a",
				name: "Org A",
				type: "COOPERATIVE",
				status: "ACTIVE",
				createdAt: NOW,
				memberCount: 3,
				pondCount: 3,
			},
		]);
	});

	it("returns an empty page without joining members when no org matches", async () => {
		db.organization.count.mockResolvedValue(0);
		db.organization.findMany.mockResolvedValue([]);

		await expect(listOrgs({ query: "nothing" })).resolves.toEqual({
			rows: [],
			total: 0,
			page: 1,
			pageSize: 20,
		});
		expect(db.membership.findMany).not.toHaveBeenCalled();
	});

	it("clamps a stale page and re-queries it", async () => {
		db.organization.count.mockResolvedValue(60);
		db.organization.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([]);

		const page = await listOrgs({ page: 99 });

		expect(page.page).toBe(3);
		expect(db.organization.findMany.mock.calls[1]?.[0].skip).toBe(40);
	});

	it("denies a caller without a platform-admin grant", async () => {
		mockGate.mockRejectedValueOnce(new Error("NEXT_REDIRECT"));

		await expect(listOrgs()).rejects.toThrow("NEXT_REDIRECT");
		expect(db.organization.count).not.toHaveBeenCalled();
	});
});

describe("listOrgOptions", () => {
	it("lists every org for the create-account selector", async () => {
		const options = [
			{ id: "org-a", name: "A Cooperative", type: "COOPERATIVE" },
			{ id: "org-b", name: "B Company", type: "COMPANY" },
		];
		db.organization.findMany.mockResolvedValue(options);

		await expect(listOrgOptions()).resolves.toEqual(options);
		expect(db.organization.findMany).toHaveBeenCalledWith({
			orderBy: { name: "asc" },
			select: { id: true, name: true, type: true },
		});
	});

	it("denies a caller without a platform-admin grant", async () => {
		mockGate.mockRejectedValueOnce(new Error("NEXT_REDIRECT"));

		await expect(listOrgOptions()).rejects.toThrow("NEXT_REDIRECT");
		expect(db.organization.findMany).not.toHaveBeenCalled();
	});
});

describe("listAllPonds", () => {
	it("maps the owner's org names once each and skips dangling joins", async () => {
		db.pond.count.mockResolvedValue(2);
		db.pond.findMany.mockResolvedValue([
			{
				id: "pond-1",
				name: "Pond One",
				status: "ACTIVE",
				ownerId: "farm-a",
				owner: { displayName: "Ana" },
			},
			{
				id: "pond-2",
				name: "Pond Two",
				status: "ARCHIVED",
				ownerId: "farm-orphan",
				owner: null,
			},
		]);
		db.user.findMany.mockResolvedValue([{ id: "u1", farmId: "farm-a" }]);
		db.membership.findMany.mockResolvedValue([
			{ userId: "u1", orgId: "org-a" },
			// Same org twice must not duplicate the label; a ghost user and an
			// unresolved org are dropped.
			{ userId: "u1", orgId: "org-a" },
			{ userId: "u-ghost", orgId: "org-b" },
			{ userId: "u1", orgId: "org-gone" },
		]);
		db.organization.findMany.mockResolvedValue([{ id: "org-a", name: "Org A" }]);

		const page = await listAllPonds();

		expect(page.rows).toEqual([
			{
				id: "pond-1",
				name: "Pond One",
				status: "ACTIVE",
				ownerFarmId: "farm-a",
				ownerName: "Ana",
				orgs: ["Org A"],
			},
			{
				id: "pond-2",
				name: "Pond Two",
				status: "ARCHIVED",
				ownerFarmId: "farm-orphan",
				ownerName: null,
				orgs: [],
			},
		]);
	});

	it("returns an empty page when ownership cannot be resolved", async () => {
		db.pond.count.mockResolvedValue(0);
		db.pond.findMany.mockResolvedValue([]);

		await expect(listAllPonds()).resolves.toEqual({
			rows: [],
			total: 0,
			page: 1,
			pageSize: 20,
		});
		expect(db.user.findMany).not.toHaveBeenCalled();
	});

	it("clamps a stale page and re-queries it", async () => {
		db.pond.count.mockResolvedValue(60);
		db.pond.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([]);

		const page = await listAllPonds({ page: 99 });

		expect(page.page).toBe(3);
		expect(db.pond.findMany.mock.calls[1]?.[0].skip).toBe(40);
	});

	it("denies a caller without a platform-admin grant", async () => {
		mockGate.mockRejectedValueOnce(new Error("NEXT_REDIRECT"));

		await expect(listAllPonds()).rejects.toThrow("NEXT_REDIRECT");
		expect(db.pond.count).not.toHaveBeenCalled();
	});
});

describe("getPlatformAdmins", () => {
	it("marks active grants and labels a grant whose user no longer exists", async () => {
		db.platformAdmin.findMany.mockResolvedValue([
			{
				userId: "u1",
				grantedBy: "admin-1",
				createdAt: NOW,
				expiresAt: null,
				revokedAt: null,
			},
			{
				userId: "u2",
				grantedBy: null,
				createdAt: NOW,
				expiresAt: PAST,
				revokedAt: null,
			},
			{
				userId: "u-ghost",
				grantedBy: "admin-1",
				createdAt: NOW,
				expiresAt: null,
				revokedAt: null,
			},
		]);
		db.user.findMany.mockResolvedValue([
			{ id: "u1", farmId: "farm-one", displayName: "One" },
			{ id: "u2", farmId: "farm-two", displayName: "Two" },
		]);

		const rows = await getPlatformAdmins();

		expect(rows[0]).toMatchObject({
			userId: "u1",
			farmId: "farm-one",
			displayName: "One",
			grantedBy: "admin-1",
			grantedAt: NOW,
			active: true,
		});
		expect(rows[1]).toMatchObject({ userId: "u2", active: false });
		expect(rows[2]).toEqual({
			userId: "u-ghost",
			farmId: "(missing user)",
			displayName: null,
			grantedBy: "admin-1",
			grantedAt: NOW,
			expiresAt: null,
			revokedAt: null,
			active: true,
		});
	});

	it("denies a caller without a platform-admin grant", async () => {
		mockGate.mockRejectedValueOnce(new Error("NEXT_REDIRECT"));

		await expect(getPlatformAdmins()).rejects.toThrow("NEXT_REDIRECT");
		expect(db.platformAdmin.findMany).not.toHaveBeenCalled();
	});
});
