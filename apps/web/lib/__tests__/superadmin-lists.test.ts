import { beforeEach, describe, expect, it, vi } from "vitest";

const { db } = vi.hoisted(() => {
	const db = {
		user: { count: vi.fn(), findMany: vi.fn() },
		organization: { count: vi.fn(), findMany: vi.fn() },
		pond: { count: vi.fn(), findMany: vi.fn() },
		membership: { findMany: vi.fn(), groupBy: vi.fn() },
		platformAdmin: { findMany: vi.fn() },
		platformAuditLog: { findMany: vi.fn() },
	};
	return { db };
});

vi.mock("@/lib/prisma", () => ({ default: db }));
vi.mock("@/lib/auth/require-platform-admin", () => ({ requirePlatformAdmin: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ getCurrentUser: vi.fn(), buildPondEmail: vi.fn() }));
vi.mock("@/lib/auth/session-cache", () => ({ invalidateFarm: vi.fn() }));
vi.mock("@/lib/auth/step-up", () => ({
	withStepUp: vi.fn(),
	isStepUpRequiredError: vi.fn(() => false),
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("next/headers", () => ({
	headers: vi.fn(async () => new Headers()),
}));

import { listAllPonds, listAllUsers, listOrgs } from "@/lib/actions/superadmin";
import { requirePlatformAdmin } from "@/lib/auth/require-platform-admin";

const mockGate = vi.mocked(requirePlatformAdmin);

beforeEach(() => {
	vi.clearAllMocks();
	mockGate.mockResolvedValue(undefined);
	db.membership.groupBy.mockResolvedValue([]);
});

describe("listAllPonds", () => {
	it("fills Organizations by mapping Pond.ownerId (farm slug) through User.farmId", async () => {
		db.pond.count.mockResolvedValue(1);
		db.pond.findMany.mockResolvedValue([
			{
				id: "pond-1",
				name: "Pond One",
				status: "ACTIVE",
				ownerId: "farm-a",
				owner: { displayName: "Ana" },
			},
		]);
		db.user.findMany.mockResolvedValue([{ id: "user-1", farmId: "farm-a" }]);
		db.membership.findMany.mockResolvedValue([{ userId: "user-1", orgId: "org-a" }]);
		db.organization.findMany.mockResolvedValue([{ id: "org-a", name: "Org A" }]);

		const result = await listAllPonds();

		expect(result.rows[0]).toMatchObject({
			id: "pond-1",
			ownerFarmId: "farm-a",
			ownerName: "Ana",
			orgs: ["Org A"],
		});
		expect(db.user.findMany).toHaveBeenCalledWith({
			where: { farmId: { in: ["farm-a"] } },
			select: { id: true, farmId: true },
		});
	});

	it("paginates at the app-wide 20 per page and searches pond, farm ID and owner name", async () => {
		db.pond.count.mockResolvedValue(120);
		db.pond.findMany.mockResolvedValue([]);

		const result = await listAllPonds({ query: "tilapia", page: 3 });

		const args = db.pond.findMany.mock.calls[0][0];
		expect(args.skip).toBe(40);
		expect(args.take).toBe(20);
		expect(args.where).toEqual({
			OR: [
				{ name: { contains: "tilapia", mode: "insensitive" } },
				{ ownerId: { contains: "tilapia", mode: "insensitive" } },
				{ owner: { displayName: { contains: "tilapia", mode: "insensitive" } } },
			],
		});
		expect(result).toEqual({ rows: [], total: 120, page: 3, pageSize: 20 });
		expect(db.user.findMany).not.toHaveBeenCalled();
	});
});

describe("listAllUsers", () => {
	it("paginates at the app-wide 20 per page, searches, and resolves orgs for the page only", async () => {
		db.user.count.mockResolvedValue(120);
		db.user.findMany.mockResolvedValue([
			{
				id: "user-1",
				farmId: "farm-a",
				email: "ana@example.test",
				displayName: "Ana",
				role: "OPERATOR",
				createdAt: new Date("2026-01-01T00:00:00.000Z"),
				_count: { ponds: 2 },
			},
		]);
		db.membership.findMany.mockResolvedValue([{ userId: "user-1", orgId: "org-a", role: "OWNER" }]);
		db.platformAdmin.findMany.mockResolvedValue([]);
		db.platformAuditLog.findMany.mockResolvedValue([]);
		db.membership.groupBy.mockResolvedValue([{ orgId: "org-a", _count: { _all: 3 } }]);
		db.organization.findMany.mockResolvedValue([{ id: "org-a", name: "Org A" }]);

		const result = await listAllUsers({ query: "ana", page: 2 });

		const args = db.user.findMany.mock.calls[0][0];
		expect(args.skip).toBe(20);
		expect(args.take).toBe(20);
		expect(args.where).toEqual({
			OR: [
				{ farmId: { contains: "ana", mode: "insensitive" } },
				{ email: { contains: "ana", mode: "insensitive" } },
				{ displayName: { contains: "ana", mode: "insensitive" } },
			],
		});
		expect(result).toMatchObject({ total: 120, page: 2, pageSize: 20 });
		expect(result.rows[0]).toMatchObject({
			id: "user-1",
			farmId: "farm-a",
			pondCount: 2,
			orgs: [{ id: "org-a", name: "Org A", role: "OWNER", memberCount: 3 }],
		});
		expect(db.membership.findMany).toHaveBeenCalledWith({
			where: { userId: { in: ["user-1"] }, revokedAt: null },
		});
	});
});

describe("listOrgs", () => {
	it("paginates at the app-wide 20 per page, searches by name, and keeps pond totals", async () => {
		db.organization.count.mockResolvedValue(60);
		db.organization.findMany.mockResolvedValue([
			{
				id: "org-a",
				name: "Org A",
				type: "COOPERATIVE",
				status: "ACTIVE",
				createdAt: new Date("2026-01-01T00:00:00.000Z"),
			},
		]);
		db.membership.findMany.mockResolvedValue([{ orgId: "org-a", userId: "user-1" }]);
		db.user.findMany.mockResolvedValue([{ id: "user-1", farmId: "farm-a" }]);
		db.pond.findMany.mockResolvedValue([{ ownerId: "farm-a" }, { ownerId: "farm-a" }]);
		db.membership.groupBy.mockResolvedValue([{ orgId: "org-a", _count: { _all: 1 } }]);

		const result = await listOrgs({ query: "org", page: 2 });

		const args = db.organization.findMany.mock.calls[0][0];
		expect(args.skip).toBe(20);
		expect(args.take).toBe(20);
		expect(args.where).toEqual({ name: { contains: "org", mode: "insensitive" } });
		expect(result).toMatchObject({ total: 60, page: 2, pageSize: 20 });
		expect(result.rows[0]).toMatchObject({ memberCount: 1, pondCount: 2 });
	});
});

describe("platform admin gate", () => {
	it.each([
		["listAllUsers", () => listAllUsers()],
		["listOrgs", () => listOrgs()],
		["listAllPonds", () => listAllPonds()],
	])("%s requires a platform admin", async (_name, call) => {
		mockGate.mockRejectedValueOnce(new Error("NEXT_REDIRECT"));
		await expect(call()).rejects.toThrow("NEXT_REDIRECT");
	});
});
