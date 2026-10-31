import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The growth loader is the single read path behind the Growth page, the
 * assistant context and the apply action, so its joins and fallbacks are
 * asserted directly: pond scoping, the newest two samples, the feeder's
 * current schedule, the saved calculator target, and the "last adjustment"
 * event that only counts when it belongs to the active cycle.
 */

const { prisma, resolveCurrentSchedule } = vi.hoisted(() => ({
	prisma: {
		pond: { findFirst: vi.fn() },
		cropCycle: { findFirst: vi.fn() },
		biomassLog: { findMany: vi.fn() },
		energyDevice: { findFirst: vi.fn() },
		fcrReport: { findFirst: vi.fn() },
		deviceStateEvent: { findMany: vi.fn() },
	},
	resolveCurrentSchedule: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({ default: prisma }));
vi.mock("@/lib/schedule/resolve-current", () => ({ resolveCurrentSchedule }));

import { loadGrowthPlanForPond } from "@/lib/growth-plan-loader";

const POND = {
	id: "pond-1",
	name: "Pond One",
	population: 1000,
	feedingRatePct: 3,
	feedsPerDay: 3,
	isFallow: false,
	notificationPrefs: {},
};

const CYCLE = {
	id: "cycle-1",
	label: "Batch 2026-A",
	stockingDate: new Date("2026-01-01T00:00:00.000Z"),
	stockingCount: 1000,
	stockingAvgWeightG: 10,
	growOutDays: 120,
	targetHarvestDate: new Date("2026-05-01T00:00:00.000Z"),
	targetHarvestWeightG: 330,
	expectedSurvivalPct: 90,
};

const DEVICE = {
	id: "dev-1",
	gramsPerFeeding: 1000,
	hopperCapacityG: 22_190,
	dailyCapG: 6000,
};

const SAMPLES = [
	{
		id: "sample-2",
		recordedAt: new Date("2026-03-02T00:00:00.000Z"),
		avgWeightKg: 0.12,
		sampleCount: 30,
	},
	{
		id: "sample-1",
		recordedAt: new Date("2026-02-01T00:00:00.000Z"),
		avgWeightKg: 0.1,
		sampleCount: 30,
	},
];

beforeEach(() => {
	vi.clearAllMocks();
	vi.useFakeTimers({ toFake: ["Date"] });
	vi.setSystemTime(new Date("2026-03-02T02:00:00.000Z"));
	prisma.pond.findFirst.mockResolvedValue(POND);
	prisma.cropCycle.findFirst.mockResolvedValue(CYCLE);
	prisma.biomassLog.findMany.mockResolvedValue(SAMPLES);
	prisma.energyDevice.findFirst.mockResolvedValue(DEVICE);
	prisma.fcrReport.findFirst.mockResolvedValue({ fcrValue: 1.5 });
	prisma.deviceStateEvent.findMany.mockResolvedValue([]);
	resolveCurrentSchedule.mockResolvedValue(null);
});

afterEach(() => {
	vi.useRealTimers();
});

describe("pond scoping", () => {
	it("returns null when the pond does not exist", async () => {
		prisma.pond.findFirst.mockResolvedValue(null);

		await expect(loadGrowthPlanForPond("pond-9")).resolves.toBeNull();
		expect(prisma.cropCycle.findFirst).not.toHaveBeenCalled();
	});

	it("filters by owner only when the caller supplies one", async () => {
		await loadGrowthPlanForPond("pond-1");
		expect(prisma.pond.findFirst.mock.calls[0][0].where).toEqual({ id: "pond-1" });

		vi.clearAllMocks();
		prisma.pond.findFirst.mockResolvedValue(POND);
		prisma.cropCycle.findFirst.mockResolvedValue(CYCLE);
		prisma.biomassLog.findMany.mockResolvedValue([]);
		prisma.energyDevice.findFirst.mockResolvedValue(null);
		prisma.fcrReport.findFirst.mockResolvedValue(null);

		await loadGrowthPlanForPond("pond-1", { ownerId: "farm-a" });
		expect(prisma.pond.findFirst.mock.calls[0][0].where).toEqual({
			id: "pond-1",
			ownerId: "farm-a",
		});
	});
});

describe("a fully configured pond", () => {
	it("builds the plan from the active cycle, the two newest samples and the device", async () => {
		const loaded = await loadGrowthPlanForPond("pond-1");

		expect(loaded).not.toBeNull();
		expect(loaded).toMatchObject({
			pondId: "pond-1",
			pondName: "Pond One",
			deviceId: "dev-1",
			cycleId: "cycle-1",
			canApply: true,
		});
		expect(loaded?.plan).toMatchObject({
			status: "ok",
			today: "2026-03-02",
			growOutDay: 61,
			daysToHarvest: 60,
			// 0.12 kg × 1000 g/kg
			currentWeightG: 120,
			currentSampleDate: "2026-03-02",
			targetSource: "cycle",
			targetWeightG: 330,
		});
	});

	it("asks for the newest two biomass samples in one query", async () => {
		await loadGrowthPlanForPond("pond-1");

		expect(prisma.biomassLog.findMany).toHaveBeenCalledWith({
			where: { pondId: "pond-1" },
			orderBy: [{ recordedAt: "desc" }, { id: "desc" }],
			take: 2,
			select: { id: true, recordedAt: true, avgWeightKg: true, sampleCount: true },
		});
	});

	it("derives the device ceiling from the hopper and the daily cap", async () => {
		const loaded = await loadGrowthPlanForPond("pond-1");

		// 6,000 g configured (capped at the 5,000 g guard) over 3 meals is the
		// daily ceiling shared three ways; there is no 1,000 g per-request cap.
		expect(loaded?.plan.device.maxGramsPerFeeding).toBeCloseTo(1666.7, 1);
	});
});

describe("missing device and schedule", () => {
	beforeEach(() => {
		prisma.energyDevice.findFirst.mockResolvedValue(null);
		prisma.fcrReport.findFirst.mockResolvedValue(null);
	});

	it("falls back to the pond settings and reports the plan as not applicable", async () => {
		const loaded = await loadGrowthPlanForPond("pond-1");

		expect(loaded).toMatchObject({ deviceId: null, canApply: false });
		expect(loaded?.plan.adjustmentBlock).toBe("noDevice");
		expect(loaded?.plan.currentGramsPerFeeding).toBeNull();
		expect(resolveCurrentSchedule).toHaveBeenCalledWith("pond-1", null);
	});

	it("does not look for growth-plan events without a device", async () => {
		await loadGrowthPlanForPond("pond-1");

		expect(prisma.deviceStateEvent.findMany).not.toHaveBeenCalled();
	});
});

describe("effective schedule", () => {
	it("prefers the resolved schedule over the pond columns", async () => {
		// 5 meals at 4% instead of the pond's 3 × 3%: the plan's feed budget must
		// follow the schedule the feeder is actually running.
		resolveCurrentSchedule.mockResolvedValue({ feedsPerDay: 5, feedingRatePct: 4 });
		const fromSchedule = (await loadGrowthPlanForPond("pond-1"))?.plan;

		resolveCurrentSchedule.mockResolvedValue(null);
		const fromPond = (await loadGrowthPlanForPond("pond-1"))?.plan;

		expect(resolveCurrentSchedule).toHaveBeenCalledWith("pond-1", "dev-1");
		// 4.73 kg/day over 5 meals ≈ 945 g; over 3 meals ≈ 1,575 g.
		expect(fromSchedule?.recommendedGramsPerFeeding).toBe(945);
		expect(fromPond?.recommendedGramsPerFeeding).toBe(1575);
	});
});

describe("last applied adjustment", () => {
	it("uses the newest event whose metadata names the active cycle", async () => {
		prisma.deviceStateEvent.findMany.mockResolvedValue([
			{ createdAt: new Date("2026-02-28T00:00:00.000Z"), metadata: null },
			{ createdAt: new Date("2026-02-27T00:00:00.000Z"), metadata: ["not", "an", "object"] },
			{ createdAt: new Date("2026-02-26T00:00:00.000Z"), metadata: { cycleId: "cycle-old" } },
			{ createdAt: new Date("2026-02-20T00:00:00.000Z"), metadata: { cycleId: "cycle-1" } },
		]);

		const plan = (await loadGrowthPlanForPond("pond-1"))?.plan;

		expect(plan).toMatchObject({ hasPriorAdjustment: true, nextAdjustmentDate: "2026-03-07" });
		expect(plan?.adjustmentAllowed).toBe(false);
		expect(plan?.adjustmentBlock).toBe("adjustmentWindow");
	});

	it("ignores an adjustment recorded for a different cycle", async () => {
		prisma.deviceStateEvent.findMany.mockResolvedValue([
			{ createdAt: new Date("2026-02-20T00:00:00.000Z"), metadata: { cycleId: "cycle-old" } },
		]);

		const plan = (await loadGrowthPlanForPond("pond-1"))?.plan;

		expect(plan).toMatchObject({ hasPriorAdjustment: false, nextAdjustmentDate: null });
		// A different cycle's adjustment must not open the 15-day window; this plan
		// is blocked by the device ceiling instead.
		expect(plan?.adjustmentBlock).not.toBe("adjustmentWindow");
	});

	it("queries only growth_plan_applied events for the device", async () => {
		await loadGrowthPlanForPond("pond-1");

		expect(prisma.deviceStateEvent.findMany).toHaveBeenCalledWith({
			where: { deviceId: "dev-1", eventType: "growth_plan_applied" },
			orderBy: { createdAt: "desc" },
			take: 20,
			select: { createdAt: true, metadata: true },
		});
	});
});

describe("samples and targets", () => {
	it("starts from the stocking weight when no sample exists", async () => {
		prisma.biomassLog.findMany.mockResolvedValue([]);

		const plan = (await loadGrowthPlanForPond("pond-1"))?.plan;

		expect(plan).toMatchObject({ currentWeightG: 10, adjustmentBlock: "noSample" });
	});

	it("projects from the stocking weight when only one sample exists", async () => {
		prisma.biomassLog.findMany.mockResolvedValue([SAMPLES[0]]);

		const plan = (await loadGrowthPlanForPond("pond-1"))?.plan;

		expect(plan?.currentWeightG).toBe(120);
		// (120 - 10) g over 60 days, carried to the harvest date 60 days out.
		expect(plan?.projectedHarvestWeightG).toBe(230);
	});

	it("uses a calculator target saved for the active cycle", async () => {
		prisma.pond.findFirst.mockResolvedValue({
			...POND,
			notificationPrefs: {
				profile: {
					growthTarget: {
						targetWeightG: 400,
						population: 1000,
						cycleId: "cycle-1",
						setAt: "2026-02-01T00:00:00.000Z",
					},
				},
			},
		});

		const plan = (await loadGrowthPlanForPond("pond-1"))?.plan;

		expect(plan).toMatchObject({ targetSource: "saved", targetWeightG: 400 });
	});

	it("reads the pond area and depth from the shared profile blob", async () => {
		prisma.pond.findFirst.mockResolvedValue({
			...POND,
			notificationPrefs: {
				profile: { areaM2: 100, averageDepthM: 1.5, feedPricePerKg: 30 },
			},
		});

		const plan = (await loadGrowthPlanForPond("pond-1"))?.plan;

		expect(plan?.density).toMatchObject({ areaM2: 100, averageDepthM: 1.5, fishPerM2: 10 });
	});

	it("reports a missing area as unknown density instead of guessing", async () => {
		const plan = (await loadGrowthPlanForPond("pond-1"))?.plan;

		expect(plan?.density.advisory).toBe("unknown");
	});
});

describe("no active cycle", () => {
	it("returns a no-cycle plan with nothing to apply", async () => {
		prisma.cropCycle.findFirst.mockResolvedValue(null);

		const loaded = await loadGrowthPlanForPond("pond-1");

		expect(loaded).toMatchObject({ cycleId: null, canApply: false });
		expect(loaded?.plan.status).toBe("noCycle");
		expect(loaded?.plan.targetWeightG).toBeNull();
	});
});
