import { beforeEach, describe, expect, it, vi } from "vitest";

const { db } = vi.hoisted(() => ({
	db: { biomassLog: { groupBy: vi.fn() } },
}));

vi.mock("@/lib/prisma", () => ({ default: db }));

import { getBatchSummaryPage } from "@/lib/batch-logs";

beforeEach(() => {
	vi.clearAllMocks();
});

describe("getBatchSummaryPage", () => {
	it("paginates grouped batches without loading their rows", async () => {
		db.biomassLog.groupBy.mockImplementation(async (args: { skip?: number }) =>
			args.skip === undefined
				? [{ batchLabel: "A" }, { batchLabel: "B" }, { batchLabel: "C" }]
				: [
						{
							batchLabel: "B",
							_count: { _all: 2 },
							_sum: { sampleCount: 20, sampleWeightKg: 2.4 },
							_max: { recordedAt: new Date("2026-10-02T00:00:00.000Z") },
						},
					],
		);

		const page = await getBatchSummaryPage({ pondId: "pond-1", page: 2, pageSize: 1 });

		expect(db.biomassLog.groupBy).toHaveBeenCalledWith(
			expect.objectContaining({
				by: ["batchLabel"],
				where: { pondId: "pond-1", batchLabel: { not: null } },
				skip: 1,
				take: 1,
			}),
		);
		expect(page).toMatchObject({ total: 3, page: 2, pageSize: 1 });
		expect(page.rows).toEqual([
			{
				label: "B",
				entryCount: 2,
				totalSampleCount: 20,
				totalWeightKg: 2.4,
				avgWeightKg: 0.12,
				lastSavedAt: new Date("2026-10-02T00:00:00.000Z"),
			},
		]);
	});
});
