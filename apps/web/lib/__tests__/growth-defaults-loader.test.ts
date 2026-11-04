import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * #828 tenant isolation: defaults and suggestions are read only through the
 * pond's own farm. Pond A must not see Pond B's history even when both are in
 * the same organization, and a farm without history gets no suggestion.
 */

const mocks = vi.hoisted(() => ({
	cropCycleFindMany: vi.fn(),
	pondGrowthOverrideFindMany: vi.fn(),
	getOrgSettingsForFarms: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
	default: {
		cropCycle: { findMany: mocks.cropCycleFindMany },
		pondGrowthOverride: { findMany: mocks.pondGrowthOverrideFindMany },
	},
}));

vi.mock("@/lib/settings/org", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@/lib/settings/org")>();
	return {
		...actual,
		getOrgSettingsForFarms: mocks.getOrgSettingsForFarms,
	};
});

import { loadPondGrowthDefaultContexts } from "@/lib/growth/defaults-loader";

function completedCycle(farmId: string, id: string) {
	return {
		id,
		farmId,
		label: id,
		stockingDate: new Date("2026-09-01T00:00:00.000Z"),
		stockingCount: 1000,
		actualHarvestDate: new Date("2027-01-05T00:00:00.000Z"),
		actualHarvestWeightKg: 210,
		actualHarvestCount: 820,
		pond: { name: "Pond A" },
	};
}

beforeEach(() => {
	vi.clearAllMocks();
	mocks.getOrgSettingsForFarms.mockResolvedValue(new Map());
	mocks.pondGrowthOverrideFindMany.mockResolvedValue([]);
	mocks.cropCycleFindMany.mockImplementation(async ({ where }: { where: { farmId: string } }) =>
		where.farmId === "farm-a" ? [completedCycle("farm-a", "cycle-a")] : [],
	);
});

describe("growth defaults loader (#828)", () => {
	it("reads history per farm and attaches it only to that farm's ponds", async () => {
		const contexts = await loadPondGrowthDefaultContexts([
			{ id: "pond-a", ownerId: "owner-a", farmId: "farm-a" },
			{ id: "pond-b", ownerId: "owner-b", farmId: "farm-b" },
		]);

		expect(mocks.getOrgSettingsForFarms).toHaveBeenCalledWith(["owner-a", "owner-b"]);
		expect(mocks.cropCycleFindMany).toHaveBeenCalledWith(
			expect.objectContaining({ where: expect.objectContaining({ farmId: "farm-a" }) }),
		);
		expect(mocks.cropCycleFindMany).toHaveBeenCalledWith(
			expect.objectContaining({ where: expect.objectContaining({ farmId: "farm-b" }) }),
		);

		expect(contexts.get("pond-a")?.suggestions).toHaveLength(3);
		expect(contexts.get("pond-b")?.suggestions).toEqual([]);
	});

	it("applies a pond override over the farm default", async () => {
		mocks.getOrgSettingsForFarms.mockResolvedValue(
			new Map([
				[
					"owner-a",
					{
						orgId: "org-1",
						settings: {
							defaultGrowOutDays: 120,
							defaultTargetHarvestWeightG: 300,
							defaultExpectedSurvivalPct: 90,
							defaultStockingAvgWeightG: null,
							densityAdvisoryPerM2: null,
						},
					},
				],
			]),
		);
		mocks.pondGrowthOverrideFindMany.mockResolvedValue([{ pondId: "pond-a", growOutDays: 150 }]);

		const contexts = await loadPondGrowthDefaultContexts([
			{ id: "pond-a", ownerId: "owner-a", farmId: "farm-a" },
		]);

		expect(contexts.get("pond-a")?.resolved.growOutDays).toEqual({
			value: 150,
			source: "pond",
		});
		expect(contexts.get("pond-a")?.resolved.targetHarvestWeightG).toEqual({
			value: 300,
			source: "farm",
		});
	});

	it("degrades to the constants when the history read fails", async () => {
		mocks.cropCycleFindMany.mockRejectedValue(new Error("db down"));

		const contexts = await loadPondGrowthDefaultContexts([
			{ id: "pond-a", ownerId: "owner-a", farmId: "farm-a" },
		]);

		expect(contexts.get("pond-a")?.suggestions).toEqual([]);
		expect(contexts.get("pond-a")?.resolved.growOutDays.value).toBe(135);
	});
});
