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
	},
}));

vi.mock("@/lib/auth/session", () => ({
	getCurrentPondOwnerId: vi.fn().mockResolvedValue("test-farm"),
	requireRole: vi.fn().mockResolvedValue(undefined),
	requireWriteAccess: vi.fn().mockResolvedValue(undefined),
	buildPondEmail: vi.fn((farmId: string) => `${farmId}@pond.optifeed.local`),
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
import { requireRole } from "@/lib/auth/session";
import prisma from "@/lib/prisma";

const mockFarm = vi.mocked(prisma.farm);
const mockPond = vi.mocked(prisma.pond);
const mockUser = vi.mocked(prisma.user);
const mockRequireRole = vi.mocked(requireRole);

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
	});

	it("requires the ADMIN role", async () => {
		mockPond.update.mockResolvedValue({} as never);
		await setPondStatus("pond-1", "ARCHIVED");
		expect(mockRequireRole).toHaveBeenCalledWith("ADMIN");
	});

	it("rejects invalid status values", async () => {
		const result = await setPondStatus("pond-1", "BOGUS" as never);
		expect(result).toEqual({ error: "Invalid pond status." });
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
		const result = await setPondStatus("missing", "ARCHIVED");
		expect(result).toEqual({ error: "Failed to update pond status." });
	});
});

describe("getAllFarmHierarchies", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("requires the ADMIN role", async () => {
		mockUser.findMany.mockResolvedValue([]);
		await getAllFarmHierarchies();
		expect(mockRequireRole).toHaveBeenCalledWith("ADMIN");
	});

	it("maps users with and without farms", async () => {
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
			},
			farm: { id: "farm_1", name: "Test Farm", ownerId: "test-farm" },
			ponds: [
				{
					id: "p1",
					name: "Pond One",
					status: "ACTIVE",
					devices: [{ id: "d1", label: "Feeder", lastSeenAt: "2026-01-01T00:00:00.000Z" }],
				},
			],
		});
		expect(result[1].farm).toBeNull();
		expect(result[1].ponds).toEqual([]);
	});
});
