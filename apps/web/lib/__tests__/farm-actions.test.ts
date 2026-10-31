import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({
	default: {
		farm: {
			findUnique: vi.fn(),
			update: vi.fn(),
		},
		pond: {
			update: vi.fn(),
		},
		user: {
			findUnique: vi.fn(),
			findMany: vi.fn(),
		},
		membership: {
			findMany: vi.fn(),
		},
		platformAdmin: {
			findMany: vi.fn(),
		},
	},
}));

vi.mock("@/lib/auth/session", () => ({
	getCurrentPondOwnerId: vi.fn().mockResolvedValue("test-farm"),
	getCurrentUser: vi.fn().mockResolvedValue(null),
	requireWriteAccess: vi.fn().mockResolvedValue(undefined),
	buildPondEmail: vi.fn((farmId: string) => `${farmId}@pond.optifeed.local`),
}));

vi.mock("@/lib/auth/tenant-admin", () => ({
	requireTenantAdmin: vi.fn().mockResolvedValue(undefined),
}));

// admin.ts now calls requirePermission(); it is DB-backed and stubbed open here
// so these tests keep exercising the action logic rather than permission rows.
vi.mock("@/lib/auth/permissions", () => ({
	requirePermission: vi.fn().mockResolvedValue(undefined),
	hasPermission: vi.fn().mockResolvedValue(true),
}));

// The /admin reads are Membership-scoped (fail-closed), so every test that
// exercises one must declare the scope it expects to see applied.
vi.mock("@/lib/auth/org-scope", () => ({
	EMPTY_SCOPE: { orgIds: [], memberUserIds: [], farmIds: [], pondIds: [] },
	resolveOrgScope: vi.fn(),
}));

vi.mock("@/i18n/routing", () => ({
	redirect: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
	createClient: vi.fn(),
}));

vi.mock("next-intl/server", () => ({
	getLocale: vi.fn().mockResolvedValue("en"),
}));

import { getAllFarmHierarchies, setPondStatus } from "@/lib/actions/admin";
import { getFarmOverview, renameFarm } from "@/lib/actions/farm";
import { EMPTY_SCOPE, resolveOrgScope } from "@/lib/auth/org-scope";
import { requireTenantAdmin } from "@/lib/auth/tenant-admin";
import prisma from "@/lib/prisma";

const mockFarm = vi.mocked(prisma.farm);
const mockPond = vi.mocked(prisma.pond);
const mockUser = vi.mocked(prisma.user);
const mockMembership = vi.mocked(prisma.membership);
const mockPlatformAdmin = vi.mocked(prisma.platformAdmin);
const mockRequireTenantAdmin = vi.mocked(requireTenantAdmin);
const mockResolveOrgScope = vi.mocked(resolveOrgScope);

const TENANT_SCOPE = {
	orgIds: ["org_a"],
	memberUserIds: ["u1", "u2"],
	farmIds: ["test-farm", "no-farm"],
	pondIds: ["pond-1"],
};

describe("getFarmOverview", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("returns null when the farmer has no farm row", async () => {
		mockFarm.findUnique.mockResolvedValue(null);
		expect(await getFarmOverview()).toBeNull();
	});

	it("maps farm and ordered ponds", async () => {
		mockFarm.findUnique.mockResolvedValue({
			id: "farm_1",
			ownerId: "test-farm",
			name: "Test Farm",
			ponds: [{ id: "p1", name: "Pond One" }],
		} as never);

		const result = await getFarmOverview();

		expect(result).toEqual({
			ownerId: "test-farm",
			farmId: "farm_1",
			name: "Test Farm",
			ponds: [{ id: "p1", name: "Pond One" }],
		});
		expect(mockFarm.findUnique).toHaveBeenCalledWith(
			expect.objectContaining({ where: { ownerId: "test-farm" } }),
		);
	});
});

describe("renameFarm", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("rejects names shorter than 2 characters", async () => {
		const result = await renameFarm(" a ");
		expect(result).toEqual({ error: "Farm name must be between 2 and 60 characters." });
		expect(mockFarm.update).not.toHaveBeenCalled();
	});

	it("rejects names longer than 60 characters", async () => {
		const result = await renameFarm("x".repeat(61));
		expect(result).toEqual({ error: "Farm name must be between 2 and 60 characters." });
		expect(mockFarm.update).not.toHaveBeenCalled();
	});

	it("renames the current user's own farm with a trimmed name", async () => {
		mockFarm.update.mockResolvedValue({ name: "New Farm Name" } as never);

		const result = await renameFarm("  New Farm Name  ");

		expect(result).toEqual({ success: true, name: "New Farm Name" });
		expect(mockFarm.update).toHaveBeenCalledWith({
			where: { ownerId: "test-farm" },
			data: { name: "New Farm Name" },
		});
	});

	it("returns an error when the update fails (e.g. no farm row)", async () => {
		mockFarm.update.mockRejectedValue(new Error("Record not found"));

		const result = await renameFarm("Valid Name");

		expect(result).toEqual({ error: "Failed to rename farm." });
	});
});

describe("setPondStatus", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockResolveOrgScope.mockResolvedValue(TENANT_SCOPE);
	});

	it("requires a tenant admin membership", async () => {
		mockPond.update.mockResolvedValue({} as never);
		await setPondStatus("pond-1", "ARCHIVED");
		expect(mockRequireTenantAdmin).toHaveBeenCalled();
	});

	it("rejects invalid status values", async () => {
		const result = await setPondStatus("pond-1", "BOGUS" as never);
		expect(result).toEqual({ error: "Invalid pond status." });
		expect(mockPond.update).not.toHaveBeenCalled();
	});

	it("refuses to touch a pond outside the caller's organization", async () => {
		const result = await setPondStatus("other-tenant-pond", "ARCHIVED");
		expect(result).toEqual({ error: "That pond is outside your organization." });
		expect(mockPond.update).not.toHaveBeenCalled();
	});

	it("archives a pond", async () => {
		mockPond.update.mockResolvedValue({} as never);
		const result = await setPondStatus("pond-1", "ARCHIVED");
		expect(result).toEqual({ success: true });
		expect(mockPond.update).toHaveBeenCalledWith({
			where: { id: "pond-1" },
			data: { status: "ARCHIVED" },
		});
	});

	it("restores a pond", async () => {
		mockPond.update.mockResolvedValue({} as never);
		const result = await setPondStatus("pond-1", "ACTIVE");
		expect(result).toEqual({ success: true });
		expect(mockPond.update).toHaveBeenCalledWith({
			where: { id: "pond-1" },
			data: { status: "ACTIVE" },
		});
	});

	it("returns an error when the update fails", async () => {
		mockPond.update.mockRejectedValue(new Error("Record not found"));
		const result = await setPondStatus("pond-1", "ARCHIVED");
		expect(result).toEqual({ error: "Failed to update pond status." });
	});
});

describe("getAllFarmHierarchies", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockResolveOrgScope.mockResolvedValue(TENANT_SCOPE);
		mockPlatformAdmin.findMany.mockResolvedValue([]);
	});

	it("requires a tenant admin membership", async () => {
		mockUser.findMany.mockResolvedValue([]);
		await getAllFarmHierarchies();
		expect(mockRequireTenantAdmin).toHaveBeenCalled();
	});

	it("scopes the query to the caller's tenant members", async () => {
		mockUser.findMany.mockResolvedValue([]);

		await getAllFarmHierarchies();

		expect(mockUser.findMany).toHaveBeenCalledWith(
			expect.objectContaining({ where: { id: { in: TENANT_SCOPE.memberUserIds } } }),
		);
	});

	it("returns an empty list when the caller has no admin membership", async () => {
		mockResolveOrgScope.mockResolvedValue(EMPTY_SCOPE);

		const result = await getAllFarmHierarchies();

		expect(result).toEqual([]);
		expect(mockUser.findMany).toHaveBeenCalledWith(
			expect.objectContaining({ where: { id: { in: [] } } }),
		);
	});

	it("maps users with and without farms", async () => {
		mockMembership.findMany.mockResolvedValue([
			{ userId: "u1", role: "ADMIN" } as never,
			{ userId: "u2", role: "VIEWER" } as never,
		]);
		mockUser.findMany.mockResolvedValue([
			{
				id: "u1",
				displayName: "Juan",
				email: "juan@x.test",
				farmId: "test-farm",
				role: "ADMIN",
				farm: {
					id: "farm_1",
					ownerId: "test-farm",
					name: "Test Farm",
					ponds: [
						{
							id: "p1",
							name: "Pond One",
							status: "ACTIVE",
							energyDevices: [
								{
									id: "d1",
									label: "Feeder",
									lastSeenAt: new Date("2026-01-01T00:00:00.000Z"),
									wifiRssiDbm: -79,
									wifiRssiUpdatedAt: new Date("2026-01-01T00:00:00.000Z"),
								},
							],
						},
					],
				},
			},
			{
				id: "u2",
				displayName: null,
				email: "someone@x.test",
				farmId: "no-farm",
				role: "VIEWER",
				farm: null,
			},
		] as never);

		const result = await getAllFarmHierarchies();

		expect(result).toHaveLength(2);
		expect(result[0]).toEqual({
			user: {
				id: "u1",
				displayName: "Juan",
				email: "juan@x.test",
				farmId: "test-farm",
				role: "ADMIN",
				membershipRole: "ADMIN",
			},
			farm: { id: "farm_1", name: "Test Farm", ownerId: "test-farm" },
			ponds: [
				{
					id: "p1",
					name: "Pond One",
					status: "ACTIVE",
					devices: [
						{
							id: "d1",
							label: "Feeder",
							lastSeenAt: "2026-01-01T00:00:00.000Z",
							wifiRssiDbm: -79,
							wifiRssiUpdatedAt: "2026-01-01T00:00:00.000Z",
						},
					],
				},
			],
		});
		expect(result[1].farm).toBeNull();
		expect(result[1].ponds).toEqual([]);
	});
});
