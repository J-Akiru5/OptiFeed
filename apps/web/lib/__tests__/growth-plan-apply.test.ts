import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
	const tx = {
		energyDevice: {
			findFirst: vi.fn(),
			updateMany: vi.fn(),
		},
		deviceStateEvent: {
			findFirst: vi.fn(),
			findMany: vi.fn(),
			create: vi.fn(),
		},
		pond: {
			findUnique: vi.fn(),
			update: vi.fn(),
		},
		biomassLog: {
			findFirst: vi.fn(),
		},
	};
	return {
		tx,
		prisma: { $transaction: vi.fn() },
		loadGrowthPlan: vi.fn(),
		revalidatePath: vi.fn(),
	};
});

vi.mock("@/lib/prisma", () => ({ default: mocks.prisma }));
vi.mock("@/lib/growth-plan-loader", () => ({
	loadGrowthPlanForPond: mocks.loadGrowthPlan,
}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));

import { type GrowthPlanInput, buildGrowthPlan } from "@/lib/growth-plan";
import { applyGrowthPlanForPond } from "@/lib/growth-plan-apply";

const OWNER = "owner-1";
const POND = "pond-1";
const DEVICE = "dev-1";
const CYCLE = {
	id: "cycle-1",
	label: "Batch A",
	stockingDate: "2026-01-01",
	stockingCount: 500,
	stockingAvgWeightG: 10,
	growOutDays: 120,
	targetHarvestDate: "2026-05-01",
	targetHarvestWeightG: 330,
	expectedSurvivalPct: 90,
};

/**
 * 170 g sample on 2 Mar against a 330 g target on 1 May, 500 fish at 90%
 * survival and FCR 1.5: 108 kg of feed over 60 days is 1,800 g/day, or
 * 600 g per meal at 3 feeds. The device currently dispenses 600 g.
 */
function planInput(overrides: Partial<GrowthPlanInput> = {}): GrowthPlanInput {
	return {
		cycle: CYCLE,
		latestSample: { id: "sample-2", date: "2026-03-02", avgWeightG: 170, sampleCount: 30 },
		previousSample: null,
		population: 500,
		feedingRatePct: 3,
		feedsPerDay: 3,
		currentGramsPerFeeding: 600,
		deviceMaxGramsPerFeeding: 1000,
		latestFcr: 1.5,
		lastAdjustmentAt: null,
		today: "2026-03-02",
		pond: { areaM2: 100, averageDepthM: 1.5, feedPricePerKg: 30 },
		...overrides,
	};
}

function loaded(overrides: Partial<GrowthPlanInput> = {}, extra: Record<string, unknown> = {}) {
	return {
		plan: buildGrowthPlan(planInput(overrides)),
		pondId: POND,
		pondName: "Pond A",
		deviceId: DEVICE,
		cycleId: CYCLE.id,
		canApply: true,
		...extra,
	};
}

function usePlan(overrides: Partial<GrowthPlanInput> = {}, extra: Record<string, unknown> = {}) {
	const value = loaded(overrides, extra);
	mocks.loadGrowthPlan.mockResolvedValue(value as never);
	return value;
}

function eventMetadata(): Record<string, unknown> {
	const call = mocks.tx.deviceStateEvent.create.mock.calls[0]?.[0] as
		| { data: { metadata: Record<string, unknown> } }
		| undefined;
	if (!call) throw new Error("deviceStateEvent.create was not called");
	return call.data.metadata;
}

beforeEach(() => {
	vi.clearAllMocks();
	usePlan();
	mocks.tx.energyDevice.findFirst.mockResolvedValue({ id: DEVICE, gramsPerFeeding: 600 });
	mocks.tx.energyDevice.updateMany.mockResolvedValue({ count: 1 });
	mocks.tx.deviceStateEvent.findFirst.mockResolvedValue(null);
	mocks.tx.deviceStateEvent.findMany.mockResolvedValue([]);
	mocks.tx.deviceStateEvent.create.mockResolvedValue({});
	mocks.tx.pond.findUnique.mockResolvedValue({
		feedingRatePct: 3,
		feedsPerDay: 3,
		population: 500,
	});
	mocks.tx.pond.update.mockResolvedValue({});
	mocks.tx.biomassLog.findFirst.mockResolvedValue({ avgWeightKg: 0.17 });
	mocks.prisma.$transaction.mockImplementation(async (callback: (tx: unknown) => unknown) =>
		callback(mocks.tx),
	);
});

describe("applyGrowthPlanForPond refusals before the transaction", () => {
	it("refuses a pond the caller cannot see", async () => {
		mocks.loadGrowthPlan.mockResolvedValue(null);
		const result = await applyGrowthPlanForPond({ pondId: POND, ownerId: OWNER, actorId: OWNER });
		expect(result).toEqual({ success: false, error: "Pond not found." });
		expect(mocks.loadGrowthPlan).toHaveBeenCalledWith(POND, { ownerId: OWNER });
		expect(mocks.prisma.$transaction).not.toHaveBeenCalled();
	});

	it("refuses a pond without a linked feeder", async () => {
		usePlan({}, { deviceId: null });
		const result = await applyGrowthPlanForPond({ pondId: POND, ownerId: OWNER, actorId: OWNER });
		expect(result).toEqual({ success: false, error: "No feeder is linked to this pond." });
	});

	it("refuses a pond without an active cycle", async () => {
		usePlan({ cycle: null }, { cycleId: null, canApply: false });
		const result = await applyGrowthPlanForPond({ pondId: POND, ownerId: OWNER, actorId: OWNER });
		expect(result).toEqual({ success: false, error: "Start a grow-out cycle first." });
	});

	it("refuses a second initialization for a cycle that already has one", async () => {
		usePlan({ lastAdjustmentAt: "2026-02-25" });
		const result = await applyGrowthPlanForPond({
			pondId: POND,
			ownerId: OWNER,
			actorId: OWNER,
			initialize: true,
		});
		expect(result).toEqual({
			success: false,
			error: "This cycle already has a feeding adjustment. Use the normal 10% adjustment instead.",
		});
		expect(mocks.prisma.$transaction).not.toHaveBeenCalled();
	});

	it("refuses to initialize without a recommended starting amount", async () => {
		usePlan({
			latestSample: { id: "sample-2", date: "2026-03-02", avgWeightG: 340, sampleCount: 30 },
		});
		const result = await applyGrowthPlanForPond({
			pondId: POND,
			ownerId: OWNER,
			actorId: OWNER,
			initialize: true,
		});
		expect(result).toEqual({
			success: false,
			error: "No starting feeding amount is available yet.",
		});
	});

	it("refuses an initialization the feeder cannot physically deliver", async () => {
		usePlan({ deviceMaxGramsPerFeeding: 500 });
		const result = await applyGrowthPlanForPond({
			pondId: POND,
			ownerId: OWNER,
			actorId: OWNER,
			initialize: true,
		});
		expect(result.success).toBe(false);
		expect(result.error).toMatch(/more feed per meal than the feeder supports/);
		expect(mocks.prisma.$transaction).not.toHaveBeenCalled();
	});

	it("reports the next date when the 15-day window is still closed", async () => {
		usePlan({ lastAdjustmentAt: "2026-02-25" });
		const result = await applyGrowthPlanForPond({ pondId: POND, ownerId: OWNER, actorId: OWNER });
		expect(result).toEqual({
			success: false,
			error: "The last adjustment was too recent. The next one is available on 2026-03-12.",
		});
	});

	it("reports the per-meal device cap instead of a generic refusal", async () => {
		usePlan({ deviceMaxGramsPerFeeding: 500 });
		const result = await applyGrowthPlanForPond({ pondId: POND, ownerId: OWNER, actorId: OWNER });
		expect(result.success).toBe(false);
		expect(result.error).toMatch(/more feed per meal than the feeder supports/);
	});

	it("uses a generic refusal when the plan has no usable sample", async () => {
		usePlan({ latestSample: null });
		const result = await applyGrowthPlanForPond({ pondId: POND, ownerId: OWNER, actorId: OWNER });
		expect(result).toEqual({
			success: false,
			error: "The plan is not ready for an adjustment yet.",
		});
	});

	it("refuses a requested amount above the device per-meal cap", async () => {
		const result = await applyGrowthPlanForPond({
			pondId: POND,
			ownerId: OWNER,
			actorId: OWNER,
			grams: 1200,
		});
		expect(result).toEqual({
			success: false,
			error: "The feeder limit is 1000.0g per meal.",
		});
		expect(mocks.prisma.$transaction).not.toHaveBeenCalled();
	});

	it("refuses a requested amount below the 1 g feed schema minimum", async () => {
		usePlan({
			population: 10,
			currentGramsPerFeeding: null,
			latestSample: { id: "sample-2", date: "2026-03-02", avgWeightG: 329, sampleCount: 30 },
		});
		const result = await applyGrowthPlanForPond({ pondId: POND, ownerId: OWNER, actorId: OWNER });
		expect(result).toEqual({ success: false, error: "Feed amount must be at least 1 g" });
		expect(mocks.prisma.$transaction).not.toHaveBeenCalled();
	});
});

describe("applyGrowthPlanForPond transaction guards", () => {
	it("refuses when the feeder vanished between load and write", async () => {
		mocks.tx.energyDevice.findFirst.mockResolvedValue(null);
		const result = await applyGrowthPlanForPond({ pondId: POND, ownerId: OWNER, actorId: OWNER });
		expect(result).toEqual({ success: false, error: "Feeder not found." });
		expect(mocks.tx.pond.findUnique).not.toHaveBeenCalled();
	});

	it("enforces the 15-day window against the latest recorded event", async () => {
		mocks.tx.deviceStateEvent.findFirst.mockResolvedValue({ id: "event-1" });
		const result = await applyGrowthPlanForPond({ pondId: POND, ownerId: OWNER, actorId: OWNER });
		expect(result).toEqual({
			success: false,
			error: "The previous adjustment is still inside the 15-day window.",
		});
		expect(mocks.tx.energyDevice.updateMany).not.toHaveBeenCalled();

		const query = mocks.tx.deviceStateEvent.findFirst.mock.calls[0]?.[0] as {
			where: { deviceId: string; eventType: string; createdAt: { gte: Date } };
		};
		expect(query.where.deviceId).toBe(DEVICE);
		expect(query.where.eventType).toBe("growth_plan_applied");
		const windowMs = Date.now() - query.where.createdAt.gte.getTime();
		expect(Math.abs(windowMs - 15 * 86_400_000)).toBeLessThan(5_000);
	});

	it("refuses a single step larger than 10% of the device value", async () => {
		const result = await applyGrowthPlanForPond({
			pondId: POND,
			ownerId: OWNER,
			actorId: OWNER,
			grams: 700,
		});
		expect(result).toEqual({
			success: false,
			error: "A single adjustment is limited to 10%.",
		});
		expect(mocks.tx.energyDevice.updateMany).not.toHaveBeenCalled();
	});

	it("refuses when the pond disappeared inside the transaction", async () => {
		mocks.tx.pond.findUnique.mockResolvedValue(null);
		const result = await applyGrowthPlanForPond({ pondId: POND, ownerId: OWNER, actorId: OWNER });
		expect(result).toEqual({ success: false, error: "Pond not found." });
	});

	it("refuses when the pond has no fish count", async () => {
		mocks.tx.pond.findUnique.mockResolvedValue({
			feedingRatePct: 3,
			feedsPerDay: 3,
			population: null,
		});
		const result = await applyGrowthPlanForPond({ pondId: POND, ownerId: OWNER, actorId: OWNER });
		expect(result).toEqual({
			success: false,
			error: "Set the pond's fish count before applying a feeding plan.",
		});
	});

	it("refuses when there is no biomass sample to derive the rate from", async () => {
		mocks.tx.biomassLog.findFirst.mockResolvedValue(null);
		const result = await applyGrowthPlanForPond({ pondId: POND, ownerId: OWNER, actorId: OWNER });
		expect(result).toEqual({
			success: false,
			error: "Log a biomass sample before applying a feeding plan.",
		});
	});

	it("refuses when the rate and sample cannot produce a dose", async () => {
		mocks.tx.biomassLog.findFirst.mockResolvedValue({ avgWeightKg: 0 });
		const result = await applyGrowthPlanForPond({ pondId: POND, ownerId: OWNER, actorId: OWNER });
		expect(result).toEqual({
			success: false,
			error: "The feeding plan could not produce a valid dose. Check the fish count and sample.",
		});
	});

	it("refuses a derived dose outside the feeder limits", async () => {
		// 500 fish at 0.5 kg on a 3.3% rate is 8,250 g/day, or 2,750 g/meal.
		mocks.tx.biomassLog.findFirst.mockResolvedValue({ avgWeightKg: 0.5 });
		const result = await applyGrowthPlanForPond({ pondId: POND, ownerId: OWNER, actorId: OWNER });
		expect(result).toEqual({
			success: false,
			error: "The feeding plan produced a dose outside the feeder limits.",
		});
	});

	it("refuses when the optimistic device write loses the race", async () => {
		mocks.tx.energyDevice.updateMany.mockResolvedValue({ count: 0 });
		const result = await applyGrowthPlanForPond({ pondId: POND, ownerId: OWNER, actorId: OWNER });
		expect(result).toEqual({
			success: false,
			error: "The schedule changed while you were reviewing. Refresh and try again.",
		});
		expect(mocks.tx.pond.update).not.toHaveBeenCalled();
		expect(mocks.tx.deviceStateEvent.create).not.toHaveBeenCalled();
	});

	it("returns a user-facing error when the loader throws", async () => {
		const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
		mocks.loadGrowthPlan.mockRejectedValueOnce(new Error("database unavailable"));

		const result = await applyGrowthPlanForPond({ pondId: POND, ownerId: OWNER, actorId: OWNER });

		expect(result).toEqual({
			success: false,
			error: "Could not apply the growth plan. Try again.",
		});
		expect(consoleError).toHaveBeenCalledWith(
			"[growth-plan] apply failed:",
			expect.objectContaining({ message: "database unavailable" }),
		);
		consoleError.mockRestore();
	});
});

describe("applyGrowthPlanForPond initialization", () => {
	it("initializes from the cycle target and ignores a caller-supplied amount", async () => {
		usePlan();
		const result = await applyGrowthPlanForPond({
			pondId: POND,
			ownerId: OWNER,
			actorId: "user-9",
			initializeIfFirst: true,
			grams: 700,
			note: "First target plan.",
		});

		expect(result).toEqual({
			success: true,
			previousGrams: 600,
			newGrams: 665.83,
			appliedAt: expect.any(String),
		});
		expect(mocks.tx.energyDevice.updateMany).toHaveBeenCalledWith({
			where: { id: DEVICE, gramsPerFeeding: 600 },
			data: { gramsPerFeeding: 665.83 },
		});
		// Initialization writes the plan's required rate, not a proportional step.
		expect(mocks.tx.pond.update).toHaveBeenCalledWith({
			where: { id: POND },
			data: { feedingRatePct: 2.35 },
		});
		expect(eventMetadata()).toMatchObject({
			cycleId: CYCLE.id,
			targetWeightG: 330,
			targetSource: "cycle",
			gramsRequested: 600,
			gramsApplied: 665.83,
			gramsPrevious: 600,
			ratePrevious: 3,
			rateApplied: 2.35,
			initialized: true,
			note: "First target plan.",
		});
		expect(mocks.tx.deviceStateEvent.create).toHaveBeenCalledWith({
			data: expect.objectContaining({
				deviceId: DEVICE,
				eventType: "growth_plan_applied",
				source: "user",
				actorId: "user-9",
			}),
		});
	});

	it("initializes from a saved calculator target for the same cycle", async () => {
		usePlan({
			savedTarget: { targetWeightG: 400, cycleId: CYCLE.id, population: 500 },
		});
		const result = await applyGrowthPlanForPond({
			pondId: POND,
			ownerId: OWNER,
			actorId: OWNER,
			initialize: true,
		});

		expect(result).toEqual({
			success: true,
			previousGrams: 600,
			newGrams: 957.67,
			appliedAt: expect.any(String),
		});
		expect(mocks.tx.pond.update).toHaveBeenCalledWith({
			where: { id: POND },
			data: { feedingRatePct: 3.38 },
		});
		expect(eventMetadata()).toMatchObject({
			targetWeightG: 400,
			targetSource: "saved",
			recommendedGrams: 862.5,
			gramsRequested: 862.5,
			gramsApplied: 957.67,
			rateApplied: 3.38,
			initialized: true,
			note: null,
		});
	});

	it("ignores a saved target that belongs to a different cycle", async () => {
		usePlan({ savedTarget: { targetWeightG: 400, cycleId: "cycle-old", population: 500 } });
		const result = await applyGrowthPlanForPond({
			pondId: POND,
			ownerId: OWNER,
			actorId: OWNER,
			initialize: true,
		});

		expect(result.success).toBe(true);
		expect(eventMetadata()).toMatchObject({
			targetWeightG: 330,
			targetSource: "cycle",
			gramsRequested: 600,
		});
	});

	it("does not re-initialize a cycle that already has a recorded event", async () => {
		mocks.tx.deviceStateEvent.findMany.mockResolvedValue([
			{ metadata: null },
			{ metadata: ["cycle-1"] },
			{ metadata: { cycleId: "cycle-old" } },
			{ metadata: { cycleId: CYCLE.id } },
		]);
		const result = await applyGrowthPlanForPond({
			pondId: POND,
			ownerId: OWNER,
			actorId: OWNER,
			initializeIfFirst: true,
		});

		expect(result).toEqual({
			success: false,
			error: "This cycle already has a feeding adjustment. Use the normal 10% adjustment instead.",
		});
		expect(mocks.tx.energyDevice.updateMany).not.toHaveBeenCalled();
		const query = mocks.tx.deviceStateEvent.findMany.mock.calls[0]?.[0] as {
			where: { deviceId: string; eventType: string };
			take: number;
		};
		expect(query.where).toEqual({ deviceId: DEVICE, eventType: "growth_plan_applied" });
		expect(query.take).toBe(20);
	});

	it("initializes when prior events belong to other cycles or have no object metadata", async () => {
		mocks.tx.deviceStateEvent.findMany.mockResolvedValue([
			{ metadata: null },
			{ metadata: [CYCLE.id] },
			{ metadata: { cycleId: "cycle-old" } },
		]);
		const result = await applyGrowthPlanForPond({
			pondId: POND,
			ownerId: OWNER,
			actorId: OWNER,
			initializeIfFirst: true,
		});

		expect(result.success).toBe(true);
		expect(eventMetadata()).toMatchObject({ initialized: true, gramsApplied: 665.83 });
	});
});

describe("applyGrowthPlanForPond success path", () => {
	it("applies the plan envelope, re-derives the device dose and records the audit event", async () => {
		usePlan();
		const result = await applyGrowthPlanForPond({
			pondId: POND,
			ownerId: OWNER,
			actorId: "user-7",
			note: "Weekly review.",
		});

		expect(result.success).toBe(true);
		expect(result.previousGrams).toBe(600);
		expect(result.newGrams).toBe(850);
		expect(Date.parse(result.appliedAt ?? "")).toBeGreaterThan(Date.now() - 60_000);

		expect(mocks.tx.energyDevice.updateMany).toHaveBeenCalledWith({
			where: { id: DEVICE, gramsPerFeeding: 600 },
			data: { gramsPerFeeding: 850 },
		});
		// A 600 g -> 600 g request keeps the rate at 3%; the device dose is
		// derived from that rate and the latest sample (500 x 0.17 kg x 3% / 3).
		expect(mocks.tx.pond.update).toHaveBeenCalledWith({
			where: { id: POND },
			data: { feedingRatePct: 3 },
		});

		const event = mocks.tx.deviceStateEvent.create.mock.calls[0]?.[0] as {
			data: {
				deviceId: string;
				eventType: string;
				source: string;
				actorId: string;
				metadata: Record<string, unknown>;
			};
		};
		expect(event.data).toMatchObject({
			deviceId: DEVICE,
			eventType: "growth_plan_applied",
			source: "user",
			actorId: "user-7",
		});
		expect(event.data.metadata).toEqual({
			cycleId: CYCLE.id,
			targetWeightG: 330,
			targetDate: "2026-05-01",
			targetSource: "cycle",
			sampleDate: "2026-03-02",
			recommendedGrams: 600,
			applicableGrams: 600,
			gramsRequested: 600,
			gramsApplied: 850,
			gramsPrevious: 600,
			ratePrevious: 3,
			rateApplied: 3,
			adjustmentPct: 0,
			confidence: "high",
			fcrAssumption: 1.5,
			initialized: false,
			note: "Weekly review.",
		});

		expect(mocks.revalidatePath.mock.calls).toEqual([
			["/[locale]/(dashboard)/dashboard/growth", "page"],
			["/[locale]/(dashboard)/dashboard/calendar", "page"],
			["/[locale]/(dashboard)/dashboard", "page"],
		]);
	});

	it("rounds a caller-supplied amount to 0.1 g and scales the rate proportionally", async () => {
		usePlan({ population: 100, currentGramsPerFeeding: 600 });
		mocks.tx.pond.findUnique.mockResolvedValue({
			feedingRatePct: 3,
			feedsPerDay: 3,
			population: 100,
		});
		const result = await applyGrowthPlanForPond({
			pondId: POND,
			ownerId: OWNER,
			actorId: OWNER,
			grams: 650.27,
		});

		expect(result.success).toBe(true);
		// 650.27 rounds to 650.3, a 8.38% step above 600.
		expect(eventMetadata().gramsRequested).toBe(650.3);
		const rateUpdate = mocks.tx.pond.update.mock.calls[0]?.[0] as {
			data: { feedingRatePct: number };
		};
		expect(rateUpdate.data.feedingRatePct).toBeCloseTo(3.2515, 6);
		// 100 fish at 0.17 kg on the 3.2515% rate is 184.25 g per meal.
		expect(result.newGrams).toBe(184.25);
	});

	it.each([
		{ label: "upper", rate: 9.9, grams: 660, expectedRate: 10 },
		{ label: "lower", rate: 0.11, grams: 540, expectedRate: 0.1 },
	])(
		"clamps the stored feeding rate at the $label bound",
		async ({ rate, grams, expectedRate }) => {
			usePlan({ population: 100, feedingRatePct: rate });
			mocks.tx.pond.findUnique.mockResolvedValue({
				feedingRatePct: rate,
				feedsPerDay: 3,
				population: 100,
			});
			mocks.tx.biomassLog.findFirst.mockResolvedValue({ avgWeightKg: 0.17 });

			const result = await applyGrowthPlanForPond({
				pondId: POND,
				ownerId: OWNER,
				actorId: OWNER,
				grams,
			});

			expect(result.success).toBe(true);
			expect(mocks.tx.pond.update).toHaveBeenCalledWith({
				where: { id: POND },
				data: { feedingRatePct: expectedRate },
			});
		},
	);
});
