import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The history loaders feed the table and the growth summary. The summary row
 * needs one sample older than the page to compute "gain since last", so the
 * page size, the extra-row fetch and the per-row maths are all asserted.
 */

const { prisma } = vi.hoisted(() => ({
	prisma: {
		feedLevelLog: { count: vi.fn(), findMany: vi.fn() },
		biomassLog: { count: vi.fn(), findMany: vi.fn() },
	},
}));

vi.mock("@/lib/prisma", () => ({ default: prisma }));

import {
	getBiomassHistory,
	getFeedLevelHistory,
	getGrowthHistory,
	isGrowthHistoryTab,
} from "@/lib/growth-history";

const DAY = 86_400_000;

function at(iso: string): Date {
	return new Date(`${iso}T00:00:00.000Z`);
}

beforeEach(() => {
	vi.clearAllMocks();
	prisma.feedLevelLog.count.mockResolvedValue(0);
	prisma.feedLevelLog.findMany.mockResolvedValue([]);
	prisma.biomassLog.count.mockResolvedValue(0);
	prisma.biomassLog.findMany.mockResolvedValue([]);
});

describe("isGrowthHistoryTab", () => {
	it("accepts the three known tabs and rejects anything else", () => {
		expect(isGrowthHistoryTab("feed")).toBe(true);
		expect(isGrowthHistoryTab("growth")).toBe(true);
		expect(isGrowthHistoryTab("biomass")).toBe(true);
		expect(isGrowthHistoryTab("audit")).toBe(false);
		expect(isGrowthHistoryTab(undefined)).toBe(false);
		expect(isGrowthHistoryTab("")).toBe(false);
	});
});

describe("getFeedLevelHistory", () => {
	it("pages by device and reports the unfiltered total", async () => {
		prisma.feedLevelLog.count.mockResolvedValue(7);
		prisma.feedLevelLog.findMany.mockResolvedValue([
			{ id: "fl-2", recordedAt: at("2026-03-02"), levelPercent: 60, distanceCm: 18 },
		]);

		const result = await getFeedLevelHistory({ deviceId: "dev-1", page: 3, pageSize: 2 });

		expect(result.total).toBe(7);
		expect(result.items[0]).toMatchObject({ id: "fl-2", levelPercent: 60 });
		expect(prisma.feedLevelLog.count).toHaveBeenCalledWith({ where: { deviceId: "dev-1" } });
		expect(prisma.feedLevelLog.findMany).toHaveBeenCalledWith(
			expect.objectContaining({
				where: { deviceId: "dev-1" },
				orderBy: [{ recordedAt: "desc" }, { id: "desc" }],
				skip: 4,
				take: 2,
			}),
		);
	});

	it("passes a date range through to both queries", async () => {
		const range = { gte: at("2026-03-01"), lt: at("2026-04-01") };

		await getFeedLevelHistory({ deviceId: "dev-1", page: 1, pageSize: 10, range });

		const expectedWhere = { deviceId: "dev-1", recordedAt: range };
		expect(prisma.feedLevelLog.count).toHaveBeenCalledWith({ where: expectedWhere });
		expect(prisma.feedLevelLog.findMany).toHaveBeenCalledWith(
			expect.objectContaining({ where: expectedWhere }),
		);
	});
});

describe("getBiomassHistory", () => {
	it("includes the per-fish samples with each log", async () => {
		prisma.biomassLog.count.mockResolvedValue(1);
		prisma.biomassLog.findMany.mockResolvedValue([
			{
				id: "log-1",
				recordedAt: at("2026-03-02"),
				batchLabel: "Batch A",
				source: "manual",
				sampleWeightKg: 1.5,
				sampleCount: 10,
				sampleLengthCm: 22,
				avgWeightKg: 0.15,
				fishSamples: [{ id: "s-1", weightGrams: 150, lengthCm: 22 }],
			},
		]);

		const result = await getBiomassHistory({ pondId: "pond-1", page: 1, pageSize: 10 });

		expect(result.items[0].fishSamples).toEqual([{ id: "s-1", weightGrams: 150, lengthCm: 22 }]);
		expect(prisma.biomassLog.findMany).toHaveBeenCalledWith(
			expect.objectContaining({
				where: { pondId: "pond-1" },
				include: {
					fishSamples: { select: { id: true, weightGrams: true, lengthCm: true } },
				},
			}),
		);
	});
});

describe("getGrowthHistory", () => {
	it("asks for one row beyond the page and drops it from the result", async () => {
		prisma.biomassLog.count.mockResolvedValue(9);
		prisma.biomassLog.findMany.mockResolvedValue([
			{
				id: "log-3",
				recordedAt: at("2026-03-31"),
				batchLabel: null,
				avgWeightKg: 0.3,
				sampleLengthCm: 30,
			},
			{
				id: "log-2",
				recordedAt: at("2026-03-01"),
				batchLabel: null,
				avgWeightKg: 0.2,
				sampleLengthCm: 28,
			},
			{
				id: "log-1",
				recordedAt: at("2026-01-30"),
				batchLabel: null,
				avgWeightKg: 0.1,
				sampleLengthCm: 25,
			},
		]);

		const result = await getGrowthHistory({ pondId: "pond-1", page: 1, pageSize: 2 });

		expect(prisma.biomassLog.findMany).toHaveBeenCalledWith(
			expect.objectContaining({ skip: 0, take: 3 }),
		);
		expect(result.total).toBe(9);
		expect(result.items.map((item) => item.id)).toEqual(["log-3", "log-2"]);
	});

	it("computes weight gain, length gain, the day gap and SGR against the older row", async () => {
		prisma.biomassLog.findMany.mockResolvedValue([
			{
				id: "log-2",
				recordedAt: at("2026-03-31"),
				batchLabel: "B",
				avgWeightKg: 0.3,
				sampleLengthCm: 30,
			},
			{
				id: "log-1",
				recordedAt: at("2026-03-01"),
				batchLabel: "B",
				avgWeightKg: 0.2,
				sampleLengthCm: 28,
			},
		]);

		const [row] = (await getGrowthHistory({ pondId: "pond-1", page: 1, pageSize: 1 })).items;

		expect(row).toMatchObject({
			id: "log-2",
			avgWeightG: 300,
			weightGainG: expect.closeTo(100, 6),
			lengthGainCm: 2,
			daysSinceLast: 30,
		});
		// 100 × (ln 0.3 − ln 0.2) / 30 days
		expect(row.sgrPctPerDay).toBeCloseTo((100 * Math.log(0.3 / 0.2)) / 30, 6);
	});

	it("leaves the gain columns null for the oldest sample on the page", async () => {
		prisma.biomassLog.findMany.mockResolvedValue([
			{
				id: "log-1",
				recordedAt: at("2026-03-01"),
				batchLabel: null,
				avgWeightKg: 0.2,
				sampleLengthCm: 28,
			},
		]);

		const [row] = (await getGrowthHistory({ pondId: "pond-1", page: 1, pageSize: 1 })).items;

		expect(row).toMatchObject({
			weightGainG: null,
			lengthGainCm: null,
			daysSinceLast: null,
			sgrPctPerDay: null,
		});
	});

	it("offsets the window for later pages and keeps the range filter", async () => {
		const range = { gte: at("2026-01-01") };

		await getGrowthHistory({ pondId: "pond-1", page: 4, pageSize: 5, range });

		expect(prisma.biomassLog.findMany).toHaveBeenCalledWith(
			expect.objectContaining({
				where: { pondId: "pond-1", recordedAt: range },
				skip: 15,
				take: 6,
			}),
		);
	});
});
