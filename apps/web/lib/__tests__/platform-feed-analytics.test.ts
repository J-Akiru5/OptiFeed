import { beforeEach, describe, expect, it, vi } from "vitest";

const { db, gateMock } = vi.hoisted(() => ({
	db: {
		$queryRaw: vi.fn(),
		user: { findMany: vi.fn() },
		membership: { findMany: vi.fn() },
		organization: { findMany: vi.fn() },
	},
	gateMock: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({ default: db }));
vi.mock("@/lib/auth/require-platform-admin", () => ({ requirePlatformAdmin: gateMock }));

import { getFeedBreakdown, getFeedHeatmap } from "@/lib/platform/feed-analytics";

const NOW = new Date("2026-11-02T04:00:00.000Z"); // 12:00 Asia/Manila

function primeTenants() {
	db.user.findMany.mockResolvedValue([
		{ id: "u1", farmId: "farm-a" },
		{ id: "u2", farmId: "farm-b" },
	]);
	db.membership.findMany.mockResolvedValue([
		{ userId: "u1", orgId: "org-1" },
		{ userId: "u2", orgId: "org-2" },
	]);
	db.organization.findMany.mockResolvedValue([
		{ id: "org-1", name: "Alpha Farm" },
		{ id: "org-2", name: "Beta Farm" },
	]);
}

describe("getFeedBreakdown", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		primeTenants();
	});

	it("splits operations and mass by organization and by pond", async () => {
		db.$queryRaw.mockResolvedValue([
			{ farmId: "farm-a", pondId: "pond-1", pondName: "Pond One", operations: 3, grams: 1500 },
			// Same pond in a second row: the slices must aggregate, not duplicate.
			{ farmId: "farm-a", pondId: "pond-1", pondName: "Pond One", operations: 2, grams: 500 },
			{ farmId: "farm-b", pondId: "pond-2", pondName: "Pond Two", operations: 1, grams: 500 },
			// A farm with no active membership cannot be attributed to a tenant.
			{ farmId: "farm-c", pondId: "pond-3", pondName: "Pond Three", operations: 1, grams: 200 },
			{ farmId: null, pondId: null, pondName: null, operations: 1, grams: 100 },
		]);

		const result = await getFeedBreakdown(30, NOW);

		expect(gateMock).toHaveBeenCalledTimes(1);
		expect(result.totals).toEqual({ operations: 8, grams: 2800, kg: 2.8 });
		expect(result.byOrg).toEqual([
			expect.objectContaining({
				key: "org-1",
				label: "Alpha Farm",
				operations: 5,
				grams: 2000,
				kg: 2,
			}),
			expect.objectContaining({
				key: "org-2",
				label: "Beta Farm",
				operations: 1,
				grams: 500,
				kg: 0.5,
			}),
			expect.objectContaining({
				key: "__unattributed__",
				label: "Unattributed",
				orgId: null,
				operations: 2,
				grams: 300,
				kg: 0.3,
			}),
		]);
		expect(result.byPond).toHaveLength(4);
		expect(result.byPond[0]).toEqual(
			expect.objectContaining({
				key: "pond-1",
				label: "Pond One",
				orgId: "org-1",
				operations: 5,
				kg: 2,
			}),
		);
		expect(result.unattributed).toEqual({ operations: 2, grams: 300, kg: 0.3 });
	});

	it("returns empty splits without issuing tenant reads when there is no feeding", async () => {
		db.$queryRaw.mockResolvedValue([]);

		const result = await getFeedBreakdown(7, NOW);

		expect(result.totals).toEqual({ operations: 0, grams: 0, kg: 0 });
		expect(result.byOrg).toEqual([]);
		expect(result.byPond).toEqual([]);
		expect(result.unattributed).toEqual({ operations: 0, grams: 0, kg: 0 });
		expect(db.user.findMany).not.toHaveBeenCalled();
		expect(db.membership.findMany).not.toHaveBeenCalled();
		expect(db.organization.findMany).not.toHaveBeenCalled();
	});
});

describe("getFeedHeatmap", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("returns sparse day/hour cells with a scale hint", async () => {
		db.$queryRaw.mockResolvedValue([
			{ day: "2026-11-01", hour: 6, operations: 4, grams: 2000 },
			{ day: "2026-11-01", hour: 18, operations: 2, grams: 1000 },
			{ day: "2026-11-02", hour: 6, operations: 1, grams: 500 },
		]);

		const result = await getFeedHeatmap(7, NOW);

		expect(gateMock).toHaveBeenCalledTimes(1);
		expect(result.dayKeys).toHaveLength(7);
		expect(result.cells).toEqual([
			{ day: "2026-11-01", hour: 6, operations: 4, grams: 2000 },
			{ day: "2026-11-01", hour: 18, operations: 2, grams: 1000 },
			{ day: "2026-11-02", hour: 6, operations: 1, grams: 500 },
		]);
		expect(result.maxOperations).toBe(4);
		expect(db.$queryRaw).toHaveBeenCalledTimes(1);
	});

	it("returns an empty grid when there is no feeding in the window", async () => {
		db.$queryRaw.mockResolvedValue([]);

		const result = await getFeedHeatmap(7, NOW);

		expect(result.cells).toEqual([]);
		expect(result.maxOperations).toBe(0);
		expect(result.dayKeys).toHaveLength(7);
	});
});
