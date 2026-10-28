import { Prisma } from "@prisma/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
	const tx = {
		pond: {
			findFirst: vi.fn(),
			update: vi.fn(),
		},
		cropCycle: {
			findFirst: vi.fn(),
			create: vi.fn(),
			update: vi.fn(),
		},
		pondEvent: {
			createMany: vi.fn(),
			updateMany: vi.fn(),
			create: vi.fn(),
		},
		energyDevice: {
			findMany: vi.fn(),
			updateMany: vi.fn(),
		},
		feedEvent: {
			aggregate: vi.fn(),
		},
		notification: {
			create: vi.fn(),
		},
		deviceStateEvent: {
			create: vi.fn(),
		},
	};
	const prisma = {
		pond: { findFirst: vi.fn() },
		cropCycle: { findFirst: vi.fn() },
		pondEvent: {
			findFirst: vi.fn(),
			create: vi.fn(),
			update: vi.fn(),
			delete: vi.fn(),
		},
		$transaction: vi.fn(),
	};
	return {
		tx,
		prisma,
		requireWriteAccess: vi.fn(),
		requirePermission: vi.fn(),
		getCurrentPondOwnerId: vi.fn(),
		resolveCalendarWriteScope: vi.fn(),
		revalidatePath: vi.fn(),
	};
});

vi.mock("@/lib/prisma", () => ({ default: mocks.prisma }));
vi.mock("@/lib/auth/session", () => ({
	requireWriteAccess: mocks.requireWriteAccess,
	getCurrentPondOwnerId: mocks.getCurrentPondOwnerId,
}));
vi.mock("@/lib/auth/permissions", () => ({
	requirePermission: mocks.requirePermission,
}));
vi.mock("@/lib/calendar/write-scope", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@/lib/calendar/write-scope")>();
	return { ...actual, resolveCalendarWriteScope: mocks.resolveCalendarWriteScope };
});
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));

import {
	cancelCropCycle,
	createCropCycle,
	markCycleHarvested,
	updateCropCycle,
} from "../actions/crop-cycle";
import {
	completePondEvent,
	createPondEvent,
	deletePondEvent,
	uncompletePondEvent,
	updatePondEvent,
} from "../actions/pond-event";
import { addDays, todayDateOnly } from "../crop-cycle/dates";
import type { PondEventInput } from "../crop-cycle/schema";

const OWNER = "owner-1";
const TODAY = todayDateOnly();
const STOCKING_DATE = addDays(TODAY, -30);
const TARGET_DATE = addDays(STOCKING_DATE, 135);
const STOCKING_UTC = new Date(`${STOCKING_DATE}T00:00:00.000Z`);
const TARGET_UTC = new Date(`${TARGET_DATE}T00:00:00.000Z`);

const pond = { id: "pond-1", name: "Pond A", farmId: "farm-1" };

const activeCycle = {
	id: "cycle-1",
	pondId: "pond-1",
	status: "ACTIVE",
	label: "Batch 2026-10",
	stockingDate: STOCKING_UTC,
	stockingCount: 1000,
	stockingAvgWeightG: 50,
	notes: null,
	pond,
};

type MockedFunction = { mockReset: () => void };

function resetMockTree(value: unknown): void {
	if (!value || typeof value !== "object") return;
	for (const nested of Object.values(value as Record<string, unknown>)) {
		if (typeof nested === "function" && "mockReset" in nested) {
			(nested as MockedFunction).mockReset();
			continue;
		}
		if (nested && typeof nested === "object") resetMockTree(nested);
	}
}

function resetAllMocks(): void {
	for (const value of Object.values(mocks)) {
		if (typeof value === "function" && "mockReset" in value) {
			(value as MockedFunction).mockReset();
			continue;
		}
		if (value && typeof value === "object") resetMockTree(value);
	}
}

function validCycleInput(overrides: Record<string, unknown> = {}) {
	return {
		pondId: "pond-1",
		label: "Batch 2026-10",
		stockingDate: STOCKING_DATE,
		stockingCount: 1000,
		stockingAvgWeightG: 50,
		growOutDays: 135,
		targetHarvestDate: TARGET_DATE,
		targetHarvestWeightG: 250,
		expectedSurvivalPct: 85,
		notes: null,
		...overrides,
	};
}

function harvestInput(overrides: Record<string, unknown> = {}) {
	return {
		pondId: "pond-1",
		cycleId: "cycle-1",
		actualHarvestDate: addDays(TODAY, -1),
		actualHarvestWeightKg: 150,
		actualHarvestCount: 950,
		actualFcr: null,
		notes: null,
		...overrides,
	};
}

function manualEventInput(overrides: Partial<PondEventInput> = {}): PondEventInput {
	return {
		pondId: "pond-1",
		type: "MAINTENANCE",
		title: "Clean the aerator",
		startsAt: TODAY,
		notes: null,
		...overrides,
	};
}

let consoleError: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
	resetAllMocks();
	consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

	mocks.requireWriteAccess.mockResolvedValue(undefined);
	mocks.requirePermission.mockResolvedValue(undefined);
	mocks.getCurrentPondOwnerId.mockResolvedValue(OWNER);
	mocks.resolveCalendarWriteScope.mockResolvedValue({ ownerId: OWNER, orgPondIds: [] });
	mocks.prisma.$transaction.mockImplementation(
		(run: (client: typeof mocks.tx) => Promise<unknown>) => run(mocks.tx),
	);

	mocks.tx.pond.findFirst.mockResolvedValue(null);
	mocks.tx.pond.update.mockResolvedValue({});
	mocks.tx.cropCycle.findFirst.mockResolvedValue(null);
	mocks.tx.cropCycle.create.mockResolvedValue({ id: "cycle-1" });
	mocks.tx.cropCycle.update.mockResolvedValue({});
	mocks.tx.pondEvent.createMany.mockResolvedValue({ count: 2 });
	mocks.tx.pondEvent.updateMany.mockResolvedValue({ count: 1 });
	mocks.tx.pondEvent.create.mockResolvedValue({ id: "event-1" });
	mocks.tx.energyDevice.findMany.mockResolvedValue([]);
	mocks.tx.energyDevice.updateMany.mockResolvedValue({ count: 0 });
	mocks.tx.feedEvent.aggregate.mockResolvedValue({ _sum: { grams: 0 } });
	mocks.tx.notification.create.mockResolvedValue({});
	mocks.tx.deviceStateEvent.create.mockResolvedValue({});

	mocks.prisma.pond.findFirst.mockResolvedValue(null);
	mocks.prisma.cropCycle.findFirst.mockResolvedValue(null);
	mocks.prisma.pondEvent.findFirst.mockResolvedValue(null);
	mocks.prisma.pondEvent.create.mockResolvedValue({ id: "event-1" });
	mocks.prisma.pondEvent.update.mockResolvedValue({});
	mocks.prisma.pondEvent.delete.mockResolvedValue({});
});

afterEach(() => {
	consoleError.mockRestore();
});

describe("createCropCycle", () => {
	it("creates the cycle, stocking and harvest events, and updates the pond", async () => {
		mocks.tx.pond.findFirst.mockResolvedValue(pond);
		mocks.tx.cropCycle.findFirst.mockResolvedValue(null);

		const result = await createCropCycle(validCycleInput());

		expect(result).toEqual({ success: true, cycleId: "cycle-1" });
		expect(mocks.prisma.$transaction).toHaveBeenCalledTimes(1);
		expect(mocks.tx.pond.findFirst).toHaveBeenCalledWith({
			where: { id: "pond-1", ownerId: OWNER },
			select: { id: true, name: true, farmId: true },
		});

		const created = mocks.tx.cropCycle.create.mock.calls[0]?.[0] as {
			data: Record<string, unknown>;
		};
		expect(created.data).toMatchObject({
			pondId: "pond-1",
			farmId: "farm-1",
			label: "Batch 2026-10",
			status: "ACTIVE",
			stockingDate: STOCKING_UTC,
			stockingCount: 1000,
			stockingAvgWeightG: 50,
			growOutDays: 135,
			targetHarvestDate: TARGET_UTC,
			targetHarvestWeightG: 250,
			expectedSurvivalPct: 85,
			notes: null,
			createdBy: OWNER,
		});

		const events = mocks.tx.pondEvent.createMany.mock.calls[0]?.[0] as {
			data: Array<Record<string, unknown>>;
		};
		expect(events.data).toHaveLength(2);
		expect(events.data[0]).toMatchObject({
			pondId: "pond-1",
			cropCycleId: "cycle-1",
			farmId: "farm-1",
			type: "STOCKING",
			status: "DONE",
			title: "Stocking — Batch 2026-10",
			startsAt: STOCKING_UTC,
			allDay: true,
			source: "cycle",
			createdBy: OWNER,
			completedBy: OWNER,
			completedAt: expect.any(Date),
		});
		expect(events.data[1]).toMatchObject({
			type: "HARVEST_PLANNED",
			status: "PLANNED",
			title: "Harvest planned — Batch 2026-10",
			startsAt: TARGET_UTC,
			allDay: true,
			source: "cycle",
			createdBy: OWNER,
		});

		expect(mocks.tx.pond.update).toHaveBeenCalledWith({
			where: { id: "pond-1" },
			data: { population: 1000, isFallow: false },
		});
		expect(mocks.revalidatePath).toHaveBeenCalledWith(
			"/[locale]/(dashboard)/dashboard/harvest",
			"page",
		);
		expect(mocks.revalidatePath).toHaveBeenCalledWith("/[locale]/(dashboard)/dashboard", "page");
		expect(mocks.revalidatePath).toHaveBeenCalledWith(
			"/[locale]/(dashboard)/dashboard/growth",
			"page",
		);
	});

	it("derives growOutDays from the submitted dates instead of trusting the field", async () => {
		mocks.tx.pond.findFirst.mockResolvedValue(pond);
		const input = validCycleInput({
			stockingDate: addDays(TODAY, -60),
			targetHarvestDate: addDays(TODAY, 60),
			growOutDays: 365,
		});

		await createCropCycle(input);

		const created = mocks.tx.cropCycle.create.mock.calls[0]?.[0] as {
			data: { growOutDays: number };
		};
		expect(created.data.growOutDays).toBe(120);
	});

	it("returns the friendly one-active conflict when a cycle already exists", async () => {
		mocks.tx.pond.findFirst.mockResolvedValue(pond);
		mocks.tx.cropCycle.findFirst.mockResolvedValue({ id: "existing-cycle" });

		const result = await createCropCycle(validCycleInput());

		expect(result).toEqual({
			success: false,
			error: "This pond already has an active grow-out cycle. Harvest or cancel it first.",
		});
		expect(mocks.tx.cropCycle.create).not.toHaveBeenCalled();
		expect(mocks.tx.pondEvent.createMany).not.toHaveBeenCalled();
		expect(mocks.tx.pond.update).not.toHaveBeenCalled();
	});

	it("maps a Prisma P2002 unique race to the same friendly conflict", async () => {
		mocks.tx.pond.findFirst.mockResolvedValue(pond);
		mocks.tx.cropCycle.findFirst.mockResolvedValue(null);
		mocks.tx.cropCycle.create.mockRejectedValue(
			new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
				code: "P2002",
				clientVersion: "6.6.0",
			}),
		);

		const result = await createCropCycle(validCycleInput());

		expect(result).toEqual({
			success: false,
			error: "This pond already has an active grow-out cycle. Harvest or cancel it first.",
		});
		expect(mocks.tx.pondEvent.createMany).not.toHaveBeenCalled();
		expect(mocks.tx.pond.update).not.toHaveBeenCalled();
	});

	it("returns an ownership error when the pond is not the caller's", async () => {
		mocks.tx.pond.findFirst.mockResolvedValue(null);

		const result = await createCropCycle(validCycleInput());

		expect(result).toEqual({ success: false, error: "Pond not found." });
		expect(mocks.tx.cropCycle.create).not.toHaveBeenCalled();
		expect(mocks.tx.pond.update).not.toHaveBeenCalled();
	});

	it("rejects invalid input before opening a transaction", async () => {
		const result = await createCropCycle(validCycleInput({ stockingCount: 0 }));

		expect(result.success).toBe(false);
		if (!result.success) {
			expect(result.error).toContain("stockingCount");
			expect(result.error).toContain("at least 1");
		}
		expect(mocks.prisma.$transaction).not.toHaveBeenCalled();
	});

	it("denies a caller without manage_crop_cycle", async () => {
		mocks.requirePermission.mockRejectedValue(new Error("Forbidden"));

		const result = await createCropCycle(validCycleInput());

		expect(result).toEqual({
			success: false,
			error: "You do not have permission to manage grow-out cycles.",
		});
		expect(mocks.requirePermission).toHaveBeenCalledWith("manage_crop_cycle");
		expect(mocks.prisma.$transaction).not.toHaveBeenCalled();
	});
});

describe("updateCropCycle", () => {
	it("updates the cycle and both linked events", async () => {
		mocks.tx.cropCycle.findFirst.mockResolvedValue(activeCycle);

		const result = await updateCropCycle("cycle-1", validCycleInput());

		expect(result).toEqual({ success: true, cycleId: "cycle-1" });
		expect(mocks.tx.cropCycle.findFirst).toHaveBeenCalledWith({
			where: { id: "cycle-1", pond: { ownerId: OWNER } },
			include: { pond: { select: { id: true, name: true, farmId: true } } },
		});

		const updated = mocks.tx.cropCycle.update.mock.calls[0]?.[0] as {
			where: { id: string };
			data: Record<string, unknown>;
		};
		expect(updated.where).toEqual({ id: "cycle-1" });
		expect(updated.data).toMatchObject({
			label: "Batch 2026-10",
			stockingDate: STOCKING_UTC,
			stockingCount: 1000,
			stockingAvgWeightG: 50,
			growOutDays: 135,
			targetHarvestDate: TARGET_UTC,
			targetHarvestWeightG: 250,
			expectedSurvivalPct: 85,
			notes: null,
		});

		expect(mocks.tx.pondEvent.updateMany).toHaveBeenNthCalledWith(1, {
			where: { cropCycleId: "cycle-1", type: "STOCKING" },
			data: { title: "Stocking — Batch 2026-10", startsAt: STOCKING_UTC },
		});
		expect(mocks.tx.pondEvent.updateMany).toHaveBeenNthCalledWith(2, {
			where: { cropCycleId: "cycle-1", type: "HARVEST_PLANNED" },
			data: {
				title: "Harvest planned — Batch 2026-10",
				startsAt: TARGET_UTC,
				status: "PLANNED",
			},
		});
	});

	it("rejects a cycle that is no longer active", async () => {
		mocks.tx.cropCycle.findFirst.mockResolvedValue({
			...activeCycle,
			status: "HARVESTED",
		});

		const result = await updateCropCycle("cycle-1", validCycleInput());

		expect(result).toEqual({
			success: false,
			error: "Only an active cycle can be changed.",
		});
		expect(mocks.tx.cropCycle.update).not.toHaveBeenCalled();
		expect(mocks.tx.pondEvent.updateMany).not.toHaveBeenCalled();
	});

	it("rejects a missing cycle and a cycle belonging to another pond", async () => {
		mocks.tx.cropCycle.findFirst.mockResolvedValue(null);
		expect(await updateCropCycle("cycle-1", validCycleInput())).toEqual({
			success: false,
			error: "Grow-out cycle not found.",
		});

		mocks.tx.cropCycle.findFirst.mockResolvedValue({
			...activeCycle,
			pondId: "pond-2",
		});
		expect(await updateCropCycle("cycle-1", validCycleInput())).toEqual({
			success: false,
			error: "Grow-out cycle not found.",
		});
		expect(mocks.tx.cropCycle.update).not.toHaveBeenCalled();
	});

	it("rejects an empty cycle id and invalid input without a transaction", async () => {
		expect(await updateCropCycle("", validCycleInput())).toEqual({
			success: false,
			error: "Grow-out cycle not found.",
		});

		const invalid = await updateCropCycle(
			"cycle-1",
			validCycleInput({ targetHarvestDate: addDays(STOCKING_DATE, 10) }),
		);
		expect(invalid.success).toBe(false);
		expect(mocks.prisma.$transaction).not.toHaveBeenCalled();
	});

	it("denies a caller without permission", async () => {
		mocks.requirePermission.mockRejectedValue(new Error("Forbidden"));

		const result = await updateCropCycle("cycle-1", validCycleInput());

		expect(result).toEqual({
			success: false,
			error: "You do not have permission to manage grow-out cycles.",
		});
		expect(mocks.prisma.$transaction).not.toHaveBeenCalled();
	});
});

describe("markCycleHarvested", () => {
	const cycle = {
		id: "cycle-1",
		pondId: "pond-1",
		status: "ACTIVE",
		label: "Batch A",
		stockingDate: new Date("2026-01-01T00:00:00.000Z"),
		stockingCount: 1000,
		stockingAvgWeightG: 50,
		notes: "Existing notes",
		pond,
	};

	it("records the harvest, computes FCR, pauses the device and notifies", async () => {
		mocks.tx.cropCycle.findFirst.mockResolvedValue(cycle);
		mocks.tx.energyDevice.findMany.mockResolvedValue([{ id: "dev-1" }, { id: "dev-2" }]);
		mocks.tx.feedEvent.aggregate.mockResolvedValue({ _sum: { grams: 100_000 } });

		const result = await markCycleHarvested(
			harvestInput({ actualHarvestDate: "2026-04-01", actualHarvestCount: 950 }),
		);

		expect(result).toEqual({ success: true, cycleId: "cycle-1" });
		expect(mocks.tx.feedEvent.aggregate).toHaveBeenCalledWith({
			where: {
				deviceId: { in: ["dev-1", "dev-2"] },
				eventType: "feed_dispensed",
				receivedAt: {
					gte: new Date("2025-12-31T16:00:00.000Z"),
					lt: new Date("2026-04-01T16:00:00.000Z"),
				},
			},
			_sum: { grams: true },
		});

		const updated = mocks.tx.cropCycle.update.mock.calls[0]?.[0] as {
			where: { id: string };
			data: Record<string, unknown>;
		};
		expect(updated.where).toEqual({ id: "cycle-1" });
		expect(updated.data).toMatchObject({
			status: "HARVESTED",
			actualHarvestDate: new Date("2026-04-01T00:00:00.000Z"),
			actualHarvestWeightKg: 150,
			actualHarvestCount: 950,
			// 100kg feed ÷ (150kg harvested − 50kg stocked) = 1.0
			actualFcr: 1,
			notes: "Existing notes",
		});

		expect(mocks.tx.pondEvent.updateMany).toHaveBeenCalledWith({
			where: { cropCycleId: "cycle-1", type: "HARVEST_PLANNED", status: "PLANNED" },
			data: { status: "DONE", completedAt: expect.any(Date), completedBy: OWNER },
		});

		const harvestEvent = mocks.tx.pondEvent.create.mock.calls[0]?.[0] as {
			data: Record<string, unknown>;
		};
		expect(harvestEvent.data).toMatchObject({
			pondId: "pond-1",
			cropCycleId: "cycle-1",
			farmId: "farm-1",
			type: "HARVEST_ACTUAL",
			status: "DONE",
			title: "Harvest completed — Batch A",
			startsAt: new Date("2026-04-01T00:00:00.000Z"),
			allDay: true,
			notes: null,
			source: "cycle",
			createdBy: OWNER,
			completedBy: OWNER,
			completedAt: expect.any(Date),
		});

		expect(mocks.tx.pond.update).toHaveBeenCalledWith({
			where: { id: "pond-1" },
			data: { isFallow: true },
		});
		expect(mocks.tx.energyDevice.updateMany).toHaveBeenCalledWith({
			where: { pondId: "pond-1" },
			data: { isPaused: true },
		});
		expect(mocks.tx.notification.create).toHaveBeenCalledWith({
			data: {
				pondId: "pond-1",
				tier: "INFO",
				category: "harvest",
				message:
					"Harvest recorded for Pond A: 150.00 kg. The feeder is paused until the next cycle.",
				linkTo: "/dashboard/harvest",
			},
		});

		const deviceEvents = mocks.tx.deviceStateEvent.create.mock.calls.map(
			([arg]) => (arg as { data: Record<string, unknown> }).data,
		);
		expect(deviceEvents).toHaveLength(2);
		expect(deviceEvents[0]).toMatchObject({
			deviceId: "dev-1",
			eventType: "harvest_recorded",
			source: "user",
			actorId: OWNER,
			metadata: {
				cycleId: "cycle-1",
				actualHarvestDate: "2026-04-01",
				actualHarvestWeightKg: 150,
				actualHarvestCount: 950,
				actualFcr: 1,
			},
		});
		expect(deviceEvents[1]).toMatchObject({ deviceId: "dev-2" });
	});

	it("keeps an explicitly supplied FCR and skips feed aggregation without devices", async () => {
		mocks.tx.cropCycle.findFirst.mockResolvedValue(cycle);
		mocks.tx.energyDevice.findMany.mockResolvedValue([]);

		await markCycleHarvested(harvestInput({ actualFcr: 2.2, notes: "Good run" }));

		expect(mocks.tx.feedEvent.aggregate).not.toHaveBeenCalled();
		const updated = mocks.tx.cropCycle.update.mock.calls[0]?.[0] as {
			data: Record<string, unknown>;
		};
		expect(updated.data).toMatchObject({ actualFcr: 2.2, notes: "Good run" });
	});

	it("leaves FCR null when there is no device feed and no manual value", async () => {
		mocks.tx.cropCycle.findFirst.mockResolvedValue(cycle);
		mocks.tx.energyDevice.findMany.mockResolvedValue([]);

		await markCycleHarvested(harvestInput());

		const updated = mocks.tx.cropCycle.update.mock.calls[0]?.[0] as {
			data: Record<string, unknown>;
		};
		expect(updated.data.actualFcr).toBeNull();
	});

	it("rejects a harvest date before the stocking date without writing", async () => {
		mocks.tx.cropCycle.findFirst.mockResolvedValue(cycle);

		const result = await markCycleHarvested(harvestInput({ actualHarvestDate: "2025-12-31" }));

		expect(result.success).toBe(false);
		expect(mocks.tx.cropCycle.update).not.toHaveBeenCalled();
		expect(mocks.tx.energyDevice.findMany).not.toHaveBeenCalled();
		expect(mocks.tx.pond.update).not.toHaveBeenCalled();
		expect(mocks.tx.energyDevice.updateMany).not.toHaveBeenCalled();
		expect(mocks.tx.notification.create).not.toHaveBeenCalled();
	});

	it("surfaces the descriptive pre-stocking harvest error", async () => {
		mocks.tx.cropCycle.findFirst.mockResolvedValue(cycle);

		const result = await markCycleHarvested(harvestInput({ actualHarvestDate: "2025-12-31" }));

		expect(result).toEqual({
			success: false,
			error: "Harvest date cannot be before the stocking date.",
		});
	});

	it("rejects a non-active cycle and a missing cycle", async () => {
		mocks.tx.cropCycle.findFirst.mockResolvedValue({ ...cycle, status: "HARVESTED" });
		expect(await markCycleHarvested(harvestInput())).toEqual({
			success: false,
			error: "Only an active cycle can be changed.",
		});

		mocks.tx.cropCycle.findFirst.mockResolvedValue(null);
		expect(await markCycleHarvested(harvestInput())).toEqual({
			success: false,
			error: "Grow-out cycle not found.",
		});
		expect(mocks.tx.cropCycle.update).not.toHaveBeenCalled();
	});

	it("rejects a future harvest date through the schema", async () => {
		const result = await markCycleHarvested(harvestInput({ actualHarvestDate: addDays(TODAY, 1) }));

		expect(result.success).toBe(false);
		if (!result.success) expect(result.error).toContain("future");
		expect(mocks.prisma.$transaction).not.toHaveBeenCalled();
	});

	it("denies a caller without permission", async () => {
		mocks.requirePermission.mockRejectedValue(new Error("Forbidden"));

		const result = await markCycleHarvested(harvestInput());

		expect(result).toEqual({
			success: false,
			error: "You do not have permission to record a harvest.",
		});
		expect(mocks.prisma.$transaction).not.toHaveBeenCalled();
	});
});

describe("cancelCropCycle", () => {
	it("cancels the cycle, planned events, fallow state and feeding", async () => {
		mocks.tx.cropCycle.findFirst.mockResolvedValue(activeCycle);

		const result = await cancelCropCycle({
			pondId: "pond-1",
			cycleId: "cycle-1",
			notes: "Flood damage",
		});

		expect(result).toEqual({ success: true, cycleId: "cycle-1" });
		expect(mocks.tx.cropCycle.findFirst).toHaveBeenCalledWith({
			where: { id: "cycle-1", pondId: "pond-1", pond: { ownerId: OWNER } },
			include: { pond: { select: { id: true, name: true, farmId: true } } },
		});
		expect(mocks.tx.cropCycle.update).toHaveBeenCalledWith({
			where: { id: "cycle-1" },
			data: { status: "CANCELLED" },
		});
		expect(mocks.tx.pondEvent.updateMany).toHaveBeenCalledWith({
			where: { cropCycleId: "cycle-1", status: "PLANNED" },
			data: { status: "CANCELLED" },
		});

		const cancelEvent = mocks.tx.pondEvent.create.mock.calls[0]?.[0] as {
			data: Record<string, unknown>;
		};
		expect(cancelEvent.data).toMatchObject({
			pondId: "pond-1",
			cropCycleId: "cycle-1",
			farmId: "farm-1",
			type: "OTHER",
			status: "DONE",
			title: "Cycle cancelled",
			startsAt: new Date(`${TODAY}T00:00:00.000Z`),
			allDay: true,
			notes: "Flood damage",
			source: "cycle",
			createdBy: OWNER,
			completedBy: OWNER,
			completedAt: expect.any(Date),
		});

		expect(mocks.tx.pond.update).toHaveBeenCalledWith({
			where: { id: "pond-1" },
			data: { isFallow: true },
		});
		expect(mocks.tx.energyDevice.updateMany).toHaveBeenCalledWith({
			where: { pondId: "pond-1" },
			data: { isPaused: true },
		});
		expect(mocks.tx.notification.create).toHaveBeenCalledWith({
			data: {
				pondId: "pond-1",
				tier: "WARNING",
				category: "harvest",
				message: "Grow-out cycle cancelled for Pond A. The feeder is paused.",
				linkTo: "/dashboard/harvest",
			},
		});
	});

	it("rejects a non-active or missing cycle without writing", async () => {
		mocks.tx.cropCycle.findFirst.mockResolvedValue({ ...activeCycle, status: "CANCELLED" });
		expect(await cancelCropCycle({ pondId: "pond-1", cycleId: "cycle-1", notes: null })).toEqual({
			success: false,
			error: "Only an active cycle can be changed.",
		});

		mocks.tx.cropCycle.findFirst.mockResolvedValue(null);
		expect(await cancelCropCycle({ pondId: "pond-1", cycleId: "cycle-1", notes: null })).toEqual({
			success: false,
			error: "Grow-out cycle not found.",
		});
		expect(mocks.tx.cropCycle.update).not.toHaveBeenCalled();
		expect(mocks.tx.pond.update).not.toHaveBeenCalled();
	});

	it("rejects a malformed payload before a transaction", async () => {
		const result = await cancelCropCycle({ pondId: "", cycleId: "", notes: null });

		expect(result.success).toBe(false);
		expect(mocks.prisma.$transaction).not.toHaveBeenCalled();
	});

	it("denies a caller without permission", async () => {
		mocks.requirePermission.mockRejectedValue(new Error("Forbidden"));

		const result = await cancelCropCycle({
			pondId: "pond-1",
			cycleId: "cycle-1",
			notes: null,
		});

		expect(result).toEqual({
			success: false,
			error: "You do not have permission to cancel a cycle.",
		});
		expect(mocks.prisma.$transaction).not.toHaveBeenCalled();
	});
});

describe("pond event actions", () => {
	it("creates a manual event for an owned pond", async () => {
		mocks.prisma.pond.findFirst.mockResolvedValue({ id: "pond-1", farmId: "farm-1" });

		const result = await createPondEvent(manualEventInput());

		expect(result).toEqual({ success: true, eventId: "event-1" });
		expect(mocks.prisma.pond.findFirst).toHaveBeenCalledWith({
			where: { id: "pond-1", ownerId: OWNER },
			select: { id: true, farmId: true },
		});
		expect(mocks.prisma.pondEvent.create).toHaveBeenCalledWith({
			data: {
				pondId: "pond-1",
				cropCycleId: null,
				farmId: "farm-1",
				kind: "EVENT",
				type: "MAINTENANCE",
				status: "PLANNED",
				title: "Clean the aerator",
				startsAt: new Date(`${TODAY}T00:00:00.000Z`),
				endsAt: null,
				allDay: true,
				notes: null,
				color: null,
				recurrenceFreq: null,
				recurrenceInterval: 1,
				recurrenceUntil: null,
				reminderMinutes: [],
				source: "manual",
				createdBy: OWNER,
			},
		});
		expect(mocks.revalidatePath).toHaveBeenCalledWith(
			"/[locale]/(dashboard)/dashboard/harvest",
			"page",
		);
		expect(mocks.revalidatePath).toHaveBeenCalledWith("/[locale]/(dashboard)/dashboard", "page");
	});

	it("links a manual event to a cycle that belongs to the same pond", async () => {
		mocks.prisma.pond.findFirst.mockResolvedValue({ id: "pond-1", farmId: "farm-1" });
		mocks.prisma.cropCycle.findFirst.mockResolvedValue({ id: "cycle-1" });

		const result = await createPondEvent(manualEventInput({ cropCycleId: "cycle-1" }));

		expect(result.success).toBe(true);
		expect(mocks.prisma.cropCycle.findFirst).toHaveBeenCalledWith({
			where: { id: "cycle-1", pondId: "pond-1" },
			select: { id: true },
		});
		const created = mocks.prisma.pondEvent.create.mock.calls[0]?.[0] as {
			data: Record<string, unknown>;
		};
		expect(created.data.cropCycleId).toBe("cycle-1");
	});

	it("rejects a cycle that belongs to a different pond", async () => {
		mocks.prisma.pond.findFirst.mockResolvedValue({ id: "pond-1", farmId: "farm-1" });
		mocks.prisma.cropCycle.findFirst.mockResolvedValue(null);

		const result = await createPondEvent(manualEventInput({ cropCycleId: "cycle-2" }));

		expect(result).toEqual({
			success: false,
			error: "Grow-out cycle not found for this pond.",
		});
		expect(mocks.prisma.pondEvent.create).not.toHaveBeenCalled();
	});

	it("rejects an unowned or missing pond", async () => {
		mocks.prisma.pond.findFirst.mockResolvedValue(null);

		const result = await createPondEvent(manualEventInput());

		expect(result).toEqual({ success: false, error: "Pond not found." });
		expect(mocks.prisma.cropCycle.findFirst).not.toHaveBeenCalled();
		expect(mocks.prisma.pondEvent.create).not.toHaveBeenCalled();
	});

	it("rejects an invalid manual event before any query", async () => {
		const result = await createPondEvent(manualEventInput({ title: "x".repeat(81) }));

		expect(result.success).toBe(false);
		expect(mocks.prisma.pond.findFirst).not.toHaveBeenCalled();
		expect(mocks.prisma.pondEvent.create).not.toHaveBeenCalled();
	});

	it("updates a manual event", async () => {
		mocks.prisma.pondEvent.findFirst.mockResolvedValue({
			id: "event-1",
			source: "manual",
			type: "MAINTENANCE",
			kind: "EVENT",
			allDay: true,
			startsAt: new Date(`${TODAY}T00:00:00.000Z`),
			endsAt: null,
			recurrenceFreq: null,
		});

		const result = await updatePondEvent({
			id: "event-1",
			title: "Rescheduled maintenance",
			startsAt: addDays(TODAY, 2),
			notes: "Bring tools",
		});

		expect(result).toEqual({ success: true, eventId: "event-1" });
		expect(mocks.prisma.pondEvent.findFirst).toHaveBeenCalledWith({
			where: { id: "event-1", pond: { ownerId: OWNER } },
			select: {
				id: true,
				source: true,
				type: true,
				kind: true,
				allDay: true,
				startsAt: true,
				endsAt: true,
				recurrenceFreq: true,
			},
		});
		expect(mocks.prisma.pondEvent.update).toHaveBeenCalledWith({
			where: { id: "event-1" },
			data: {
				title: "Rescheduled maintenance",
				startsAt: new Date(`${addDays(TODAY, 2)}T00:00:00.000Z`),
				notes: "Bring tools",
			},
		});
	});

	it("refuses to edit or complete or delete a cycle event", async () => {
		mocks.prisma.pondEvent.findFirst.mockResolvedValue({
			id: "event-1",
			source: "cycle",
			type: "HARVEST_PLANNED",
		});

		expect(
			await updatePondEvent({
				id: "event-1",
				title: "Move harvest",
				startsAt: TODAY,
				notes: null,
			}),
		).toEqual({
			success: false,
			error: "Cycle events cannot be edited from the calendar.",
		});
		expect(await completePondEvent({ id: "event-1" })).toEqual({
			success: false,
			error: "Cycle events are completed from the cycle actions.",
		});
		expect(await uncompletePondEvent({ id: "event-1" })).toEqual({
			success: false,
			error: "Cycle events are completed from the cycle actions.",
		});
		expect(await deletePondEvent({ id: "event-1" })).toEqual({
			success: false,
			error: "Cycle events cannot be deleted.",
		});

		expect(mocks.prisma.pondEvent.update).not.toHaveBeenCalled();
		expect(mocks.prisma.pondEvent.delete).not.toHaveBeenCalled();
	});

	it("returns not-found for events outside the caller's ponds", async () => {
		mocks.prisma.pondEvent.findFirst.mockResolvedValue(null);

		expect(
			await updatePondEvent({
				id: "event-1",
				title: "Move",
				startsAt: TODAY,
				notes: null,
			}),
		).toEqual({ success: false, error: "Event not found." });
		expect(await completePondEvent({ id: "event-1" })).toEqual({
			success: false,
			error: "Event not found.",
		});
		expect(await deletePondEvent({ id: "event-1" })).toEqual({
			success: false,
			error: "Event not found.",
		});
		expect(mocks.prisma.pondEvent.update).not.toHaveBeenCalled();
		expect(mocks.prisma.pondEvent.delete).not.toHaveBeenCalled();
	});

	it("keeps a plain farmer inside their own farm", async () => {
		mocks.prisma.pondEvent.findFirst.mockResolvedValue(null);

		// No admin membership: resolveCalendarWriteScope carries no org ponds.
		const result = await updatePondEvent({
			id: "event-other-farm",
			title: "Move",
			startsAt: TODAY,
			notes: null,
		});

		expect(result).toEqual({ success: false, error: "Event not found." });
		expect(mocks.prisma.pondEvent.findFirst).toHaveBeenCalledWith(
			expect.objectContaining({
				where: { id: "event-other-farm", pond: { ownerId: OWNER } },
			}),
		);
	});

	it("lets an org admin create an event on another pond in their organization", async () => {
		mocks.resolveCalendarWriteScope.mockResolvedValue({
			ownerId: OWNER,
			orgPondIds: ["pond-org"],
		});
		mocks.prisma.pond.findFirst.mockResolvedValue({ id: "pond-org", farmId: "farm-org" });

		const result = await createPondEvent(manualEventInput({ pondId: "pond-org" }));

		expect(result).toEqual({ success: true, eventId: "event-1" });
		expect(mocks.prisma.pond.findFirst).toHaveBeenCalledWith({
			where: {
				id: "pond-org",
				OR: [{ ownerId: OWNER }, { id: { in: ["pond-org"] } }],
			},
			select: { id: true, farmId: true },
		});
		const created = mocks.prisma.pondEvent.create.mock.calls[0]?.[0] as {
			data: Record<string, unknown>;
		};
		expect(created.data).toMatchObject({
			pondId: "pond-org",
			farmId: "farm-org",
			createdBy: OWNER,
		});
	});

	it("lets an org admin move an event on an organization pond", async () => {
		mocks.resolveCalendarWriteScope.mockResolvedValue({
			ownerId: OWNER,
			orgPondIds: ["pond-org"],
		});
		mocks.prisma.pondEvent.findFirst.mockResolvedValue({
			id: "event-org",
			source: "manual",
			type: "MAINTENANCE",
			kind: "EVENT",
			allDay: true,
			startsAt: new Date(`${TODAY}T00:00:00.000Z`),
			endsAt: null,
			recurrenceFreq: null,
		});

		const result = await updatePondEvent({
			id: "event-org",
			startsAt: addDays(TODAY, 1),
			notes: null,
		});

		expect(result).toEqual({ success: true, eventId: "event-org" });
		expect(mocks.prisma.pondEvent.findFirst).toHaveBeenCalledWith(
			expect.objectContaining({
				where: {
					id: "event-org",
					OR: [{ pond: { ownerId: OWNER } }, { pondId: { in: ["pond-org"] } }],
				},
			}),
		);
	});

	it("does not let an admin reach an event outside the organizations they administer", async () => {
		mocks.resolveCalendarWriteScope.mockResolvedValue({
			ownerId: OWNER,
			orgPondIds: ["pond-org-a"],
		});
		mocks.prisma.pondEvent.findFirst.mockResolvedValue(null);

		const result = await deletePondEvent({ id: "event-org-b" });

		expect(result).toEqual({ success: false, error: "Event not found." });
		// The predicate names only the caller's farm and org A. A row in org B
		// cannot match, so the null result is the real cross-org denial.
		expect(mocks.prisma.pondEvent.findFirst).toHaveBeenCalledWith(
			expect.objectContaining({
				where: {
					id: "event-org-b",
					OR: [{ pond: { ownerId: OWNER } }, { pondId: { in: ["pond-org-a"] } }],
				},
			}),
		);
		expect(mocks.prisma.pondEvent.delete).not.toHaveBeenCalled();
	});

	it("completes a manual event with the caller as completedBy", async () => {
		mocks.prisma.pondEvent.findFirst.mockResolvedValue({
			id: "event-1",
			source: "manual",
		});

		const result = await completePondEvent({ id: "event-1" });

		expect(result).toEqual({ success: true, eventId: "event-1" });
		expect(mocks.prisma.pondEvent.update).toHaveBeenCalledWith({
			where: { id: "event-1" },
			data: { status: "DONE", completedBy: OWNER, completedAt: expect.any(Date) },
		});
	});

	it("deletes a manual event", async () => {
		mocks.prisma.pondEvent.findFirst.mockResolvedValue({
			id: "event-1",
			source: "manual",
			startsAt: new Date(`${TODAY}T00:00:00.000Z`),
			allDay: true,
			recurrenceFreq: null,
		});

		const result = await deletePondEvent({ id: "event-1" });

		expect(result).toEqual({ success: true, eventId: "event-1" });
		expect(mocks.prisma.pondEvent.delete).toHaveBeenCalledWith({
			where: { id: "event-1" },
		});
	});

	it("creates a timed task with colour, repeat and reminders", async () => {
		mocks.prisma.pond.findFirst.mockResolvedValue({ id: "pond-1", farmId: "farm-1" });
		const until = addDays(TODAY, 30);

		const result = await createPondEvent({
			pondId: "pond-1",
			kind: "TASK",
			type: "SAMPLING",
			title: "Check water quality",
			allDay: false,
			startsAt: `${TODAY}T09:30`,
			endsAt: null,
			color: "#1E7B34",
			recurrence: { freq: "WEEKLY", interval: 2, until },
			reminderMinutes: [1440, 60],
			notes: "Bring the kit",
		});

		expect(result).toEqual({ success: true, eventId: "event-1" });
		const created = mocks.prisma.pondEvent.create.mock.calls[0]?.[0] as {
			data: Record<string, unknown>;
		};
		expect(created.data).toMatchObject({
			kind: "TASK",
			type: "SAMPLING",
			title: "Check water quality",
			allDay: false,
			startsAt: new Date(`${TODAY}T09:30:00+08:00`),
			endsAt: null,
			color: "#1E7B34",
			recurrenceFreq: "WEEKLY",
			recurrenceInterval: 2,
			recurrenceUntil: new Date(`${until}T00:00:00.000Z`),
			reminderMinutes: [60, 1440],
			source: "manual",
		});
	});

	it("rejects a time on an all-day item and a date-only timed item", async () => {
		const allDayWithTime = await createPondEvent(
			manualEventInput({ allDay: true, startsAt: `${TODAY}T09:00` }),
		);
		expect(allDayWithTime.success).toBe(false);
		if (!allDayWithTime.success) expect(allDayWithTime.error).toContain("all-day");

		const timedWithoutTime = await createPondEvent(
			manualEventInput({ allDay: false, startsAt: TODAY }),
		);
		expect(timedWithoutTime.success).toBe(false);
		if (!timedWithoutTime.success) expect(timedWithoutTime.error).toContain("date and time");
		expect(mocks.prisma.pondEvent.create).not.toHaveBeenCalled();
	});

	it("rejects an end before the start", async () => {
		const result = await createPondEvent(
			manualEventInput({
				allDay: false,
				startsAt: `${TODAY}T12:00`,
				endsAt: `${TODAY}T10:00`,
			}),
		);

		expect(result.success).toBe(false);
		if (!result.success) expect(result.error).toContain("end must be after the start");
		expect(mocks.prisma.pondEvent.create).not.toHaveBeenCalled();
	});

	it("completes one occurrence of a recurring task and dedupes it", async () => {
		const anchor = new Date(`${TODAY}T00:00:00.000Z`);
		const occurrence = new Date(`${addDays(TODAY, 7)}T00:00:00.000Z`);
		mocks.prisma.pondEvent.findFirst.mockResolvedValue({
			id: "event-1",
			source: "manual",
			startsAt: anchor,
			allDay: true,
			recurrenceFreq: "WEEKLY",
			recurrenceInterval: 1,
			recurrenceUntil: null,
			completedOccurrences: [],
		});

		const result = await completePondEvent({
			id: "event-1",
			occurrence: occurrence.toISOString(),
		});

		expect(result).toEqual({ success: true, eventId: "event-1" });
		expect(mocks.prisma.pondEvent.update).toHaveBeenCalledWith({
			where: { id: "event-1" },
			data: { completedOccurrences: { set: [occurrence] } },
		});
		expect(mocks.prisma.pondEvent.update).not.toHaveBeenCalledWith(
			expect.objectContaining({ data: expect.objectContaining({ status: "DONE" }) }),
		);
	});

	it("rejects an occurrence that is not part of the series", async () => {
		mocks.prisma.pondEvent.findFirst.mockResolvedValue({
			id: "event-1",
			source: "manual",
			startsAt: new Date(`${TODAY}T00:00:00.000Z`),
			allDay: true,
			recurrenceFreq: "WEEKLY",
			recurrenceInterval: 1,
			recurrenceUntil: null,
			completedOccurrences: [],
		});

		const result = await completePondEvent({
			id: "event-1",
			occurrence: new Date(`${addDays(TODAY, 3)}T00:00:00.000Z`).toISOString(),
		});

		expect(result).toEqual({
			success: false,
			error: "That occurrence is not part of this series.",
		});
		expect(mocks.prisma.pondEvent.update).not.toHaveBeenCalled();
	});

	it("skips a single occurrence and deletes the whole series", async () => {
		const occurrence = new Date(`${addDays(TODAY, 7)}T00:00:00.000Z`);
		mocks.prisma.pondEvent.findFirst.mockResolvedValue({
			id: "event-1",
			source: "manual",
			startsAt: new Date(`${TODAY}T00:00:00.000Z`),
			allDay: true,
			recurrenceFreq: "WEEKLY",
			recurrenceInterval: 1,
			recurrenceUntil: null,
			completedOccurrences: [],
		});

		expect(await deletePondEvent({ id: "event-1", occurrence: occurrence.toISOString() })).toEqual({
			success: true,
			eventId: "event-1",
		});
		expect(mocks.prisma.pondEvent.update).toHaveBeenCalledWith({
			where: { id: "event-1" },
			data: { completedOccurrences: { set: [occurrence] } },
		});
		expect(mocks.prisma.pondEvent.delete).not.toHaveBeenCalled();

		expect(await deletePondEvent({ id: "event-1" })).toEqual({
			success: true,
			eventId: "event-1",
		});
		expect(mocks.prisma.pondEvent.delete).toHaveBeenCalledWith({ where: { id: "event-1" } });
	});

	it("reopens a completed task and removes an occurrence check", async () => {
		const occurrence = new Date(`${addDays(TODAY, 7)}T00:00:00.000Z`);
		mocks.prisma.pondEvent.findFirst.mockResolvedValue({
			id: "event-1",
			source: "manual",
			startsAt: new Date(`${TODAY}T00:00:00.000Z`),
			allDay: true,
			recurrenceFreq: "WEEKLY",
			recurrenceInterval: 1,
			recurrenceUntil: null,
			completedOccurrences: [occurrence],
		});

		expect(
			await uncompletePondEvent({ id: "event-1", occurrence: occurrence.toISOString() }),
		).toEqual({ success: true, eventId: "event-1" });
		expect(mocks.prisma.pondEvent.update).toHaveBeenCalledWith({
			where: { id: "event-1" },
			data: { completedOccurrences: { set: [] } },
		});

		mocks.prisma.pondEvent.findFirst.mockResolvedValue({
			id: "event-2",
			source: "manual",
			startsAt: new Date(`${TODAY}T00:00:00.000Z`),
			allDay: true,
			recurrenceFreq: null,
			recurrenceInterval: 1,
			recurrenceUntil: null,
			completedOccurrences: [],
		});
		expect(await uncompletePondEvent({ id: "event-2" })).toEqual({
			success: true,
			eventId: "event-2",
		});
		expect(mocks.prisma.pondEvent.update).toHaveBeenLastCalledWith({
			where: { id: "event-2" },
			data: { status: "PLANNED", completedBy: null, completedAt: null },
		});
	});

	it("rejects invalid update, complete and delete payloads", async () => {
		expect(
			await updatePondEvent({ id: "", title: "Event", startsAt: TODAY, notes: null }),
		).toMatchObject({ success: false });
		expect(await completePondEvent({ id: "" })).toMatchObject({ success: false });
		expect(await deletePondEvent({ id: "" })).toMatchObject({ success: false });
		expect(mocks.prisma.pondEvent.findFirst).not.toHaveBeenCalled();
	});

	it("denies every pond event action without manage_crop_cycle", async () => {
		mocks.requirePermission.mockRejectedValue(new Error("Forbidden"));

		const denied = {
			success: false,
			error: "You do not have permission to manage pond events.",
		};
		expect(await createPondEvent(manualEventInput())).toEqual(denied);
		expect(
			await updatePondEvent({
				id: "event-1",
				title: "Move",
				startsAt: TODAY,
				notes: null,
			}),
		).toEqual(denied);
		expect(await completePondEvent({ id: "event-1" })).toEqual(denied);
		expect(await uncompletePondEvent({ id: "event-1" })).toEqual(denied);
		expect(await deletePondEvent({ id: "event-1" })).toEqual(denied);

		expect(mocks.requirePermission).toHaveBeenCalledWith("manage_crop_cycle");
		expect(mocks.prisma.pond.findFirst).not.toHaveBeenCalled();
		expect(mocks.prisma.pondEvent.findFirst).not.toHaveBeenCalled();
		expect(mocks.prisma.pondEvent.create).not.toHaveBeenCalled();
		expect(mocks.prisma.pondEvent.update).not.toHaveBeenCalled();
		expect(mocks.prisma.pondEvent.delete).not.toHaveBeenCalled();
	});
});

describe("write access enforcement", () => {
	it("returns errors and writes nothing when requireWriteAccess rejects", async () => {
		mocks.requireWriteAccess.mockRejectedValue(new Error("Write access required"));

		expect(await createCropCycle(validCycleInput())).toMatchObject({ success: false });
		expect(await updateCropCycle("cycle-1", validCycleInput())).toMatchObject({
			success: false,
		});
		expect(await markCycleHarvested(harvestInput())).toMatchObject({ success: false });
		expect(
			await cancelCropCycle({ pondId: "pond-1", cycleId: "cycle-1", notes: null }),
		).toMatchObject({ success: false });
		expect(await createPondEvent(manualEventInput())).toMatchObject({ success: false });
		expect(await completePondEvent({ id: "event-1" })).toMatchObject({ success: false });

		expect(mocks.prisma.$transaction).not.toHaveBeenCalled();
		expect(mocks.prisma.pond.findFirst).not.toHaveBeenCalled();
		expect(mocks.prisma.pondEvent.create).not.toHaveBeenCalled();
	});
});
