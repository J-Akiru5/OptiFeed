import { computeFcr, feedGivenKgInWindow, feedWindowForSamples } from "@/lib/analytics/fcr";
import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
	findMany: vi.fn(),
	aggregate: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
	default: {
		energyDevice: { findMany: prismaMock.findMany },
		feedEvent: { aggregate: prismaMock.aggregate },
	},
}));

/**
 * Fixed data set for the in-app FCR (issue #453), tilapia-realistic units
 * (BiomassLog.avgWeightKg is kilograms per fish, FeedEvent grams are feed):
 *
 * Pond cycle: 300 fish stocked at 2 g average (0.002 kg/fish)
 * Mortality:  15 fish logged → live = 285 (derived live count, issue #452)
 * First sampling: 0.002 kg × 300 stocked =   0.6 kg biomass
 * Last sampling:  0.250 kg × 285 live   = 71.25 kg biomass
 * Biomass gain:   71.25 − 0.6           = 70.65 kg
 * Feed given:     70.65 kg × FCR 1.5    = 105.975 kg
 * Expectation:    105.975 / 70.65       = 1.5 exactly
 */

const EXPECT = {
	gainKg: 70.65,
	fcr: 1.5,
};

const FIRST = { avgWeightKg: 0.002, count: 300 };
const LAST = { avgWeightKg: 0.25, count: 285 };

describe("computeFcr (fixed data set)", () => {
	it("returns the hand-computed FCR for the fixed cycle", () => {
		const result = computeFcr(105.975, FIRST, LAST);
		expect(result.feedGivenKg).toBeCloseTo(105.975, 10);
		expect(result.biomassGainKg).toBeCloseTo(EXPECT.gainKg, 10);
		expect(result.fcr).toBeCloseTo(EXPECT.fcr, 10);
	});

	it("is not computable when a side is missing, instead of dividing by nothing", () => {
		expect(computeFcr(105.975, null, LAST).fcr).toBeNull();
		expect(computeFcr(105.975, FIRST, null).fcr).toBeNull();
	});

	it("counts flat biomass as no gain and reports no ratio", () => {
		const result = computeFcr(105.975, LAST, LAST);
		expect(result.biomassGainKg).toBe(0);
		expect(result.fcr).toBeNull();
	});

	it("never produces a negative gain when the pond shrank (mortality on top)", () => {
		const result = computeFcr(105.975, { avgWeightKg: 0.25, count: 300 }, LAST);
		expect(result.biomassGainKg).toBe(0);
		expect(result.fcr).toBeNull();
	});

	it("treats negative feed input as nothing given", () => {
		const result = computeFcr(-5, FIRST, LAST);
		expect(result.feedGivenKg).toBe(0);
		expect(result.fcr).toBeCloseTo(0, 10);
	});
});

describe("feedWindowForSamples (Asia/Manila)", () => {
	it("covers the whole first and last sampling days, not just their timestamps", () => {
		const window = feedWindowForSamples([
			{ recordedAt: new Date("2026-08-22T01:00:00Z") }, // 09:00 Manila
			{ recordedAt: new Date("2026-10-22T01:00:00Z") }, // 09:00 Manila
		]);
		// 00:00 Manila on Aug 22 and 00:00 Manila on Oct 23 (exclusive).
		expect(window?.from.toISOString()).toBe("2026-08-21T16:00:00.000Z");
		expect(window?.toExclusive.toISOString()).toBe("2026-10-22T16:00:00.000Z");
	});

	it("is not defined when there is no sample", () => {
		expect(feedWindowForSamples([])).toBeNull();
	});
});

describe("feedGivenKgInWindow (FCR scope)", () => {
	beforeEach(() => {
		prismaMock.findMany.mockReset();
		prismaMock.aggregate.mockReset();
	});

	it("excludes seeded and synthetic rows and bounds by the sampling days", async () => {
		prismaMock.findMany.mockResolvedValue([{ id: "device-1" }]);
		prismaMock.aggregate.mockResolvedValue({ _sum: { grams: 33_000 } });

		const window = feedWindowForSamples([
			{ recordedAt: new Date("2026-08-22T01:00:00Z") },
			{ recordedAt: new Date("2026-10-22T01:00:00Z") },
		]);
		const kg = await feedGivenKgInWindow("pond-1", window ?? { from: null });

		expect(kg).toBeCloseTo(33, 10);
		const where = prismaMock.aggregate.mock.calls[0][0].where;
		expect(where.dataSource).toEqual({ notIn: ["seed", "synthetic"] });
		// Feed before the first sampling day and after the last one cannot enter.
		expect(where.receivedAt.gte.toISOString()).toBe("2026-08-21T16:00:00.000Z");
		expect(where.receivedAt.lt.toISOString()).toBe("2026-10-22T16:00:00.000Z");
	});

	it("does not query feed for a pond with no device", async () => {
		prismaMock.findMany.mockResolvedValue([]);
		await expect(feedGivenKgInWindow("pond-1", { from: null })).resolves.toBe(0);
		expect(prismaMock.aggregate).not.toHaveBeenCalled();
	});
});
