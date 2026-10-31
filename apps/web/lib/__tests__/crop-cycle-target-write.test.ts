import type { Prisma } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import {
	CYCLE_TARGET_ERROR,
	cycleTargetDrift,
	cycleTargetForCreate,
	resolveCycleTargetWrite,
	writeCycleTargetMirror,
	writePondGrowthTarget,
} from "../crop-cycle/target-write";
import type { PondGrowthTarget } from "../pond-profile";

const SAVED: PondGrowthTarget = {
	targetWeightG: 400,
	population: 900,
	cycleId: "cycle-1",
	setAt: "2026-10-01T00:00:00.000Z",
};

function plan(overrides: Partial<Parameters<typeof resolveCycleTargetWrite>[0]> = {}) {
	return resolveCycleTargetWrite({
		nextWeightG: 300,
		cycleWeightG: 250,
		savedTarget: SAVED,
		population: 1200,
		cycleId: "cycle-1",
		now: new Date("2026-10-31T00:00:00.000Z"),
		...overrides,
	});
}

describe("cycleTargetForCreate", () => {
	it("keeps an empty target empty", () => {
		expect(cycleTargetForCreate(null)).toBeNull();
		expect(cycleTargetForCreate(undefined)).toBeNull();
	});

	it("rounds to tenths of a gram, like the calculator", () => {
		expect(cycleTargetForCreate(250.04)).toBe(250);
		expect(cycleTargetForCreate(250.06)).toBe(250.1);
	});

	it("refuses a value the cycle field cannot store", () => {
		expect(() => cycleTargetForCreate(10_000.1)).toThrow(CYCLE_TARGET_ERROR.outOfRange);
		expect(() => cycleTargetForCreate(0)).toThrow(CYCLE_TARGET_ERROR.outOfRange);
		expect(() => cycleTargetForCreate(-1)).toThrow(CYCLE_TARGET_ERROR.outOfRange);
		expect(() => cycleTargetForCreate(Number.NaN)).toThrow(CYCLE_TARGET_ERROR.outOfRange);
	});
});

describe("resolveCycleTargetWrite", () => {
	it("passes an unedited cycle value through without touching the pond target", () => {
		expect(plan({ cycleWeightG: 300, savedTarget: null })).toEqual({
			cycleTargetWeightG: 300,
			targetToWrite: undefined,
		});
	});

	it("does not ask when the cycle already carries the saved value", () => {
		expect(plan({ nextWeightG: 400 })).toEqual({
			cycleTargetWeightG: 400,
			targetToWrite: undefined,
		});
	});

	it("fails closed when a conflicting edit has no Replace/Keep choice", () => {
		expect(() => plan()).toThrow(CYCLE_TARGET_ERROR.conflict);
	});

	it("replace writes the new value into both stores", () => {
		expect(plan({ resolution: "replace" })).toEqual({
			cycleTargetWeightG: 300,
			targetToWrite: {
				targetWeightG: 300,
				population: 1200,
				cycleId: "cycle-1",
				setAt: "2026-10-31T00:00:00.000Z",
			},
		});
	});

	it("replace with an empty value removes the saved target as explicitly chosen", () => {
		expect(plan({ nextWeightG: null, resolution: "replace" })).toEqual({
			cycleTargetWeightG: null,
			targetToWrite: null,
		});
	});

	it("keep restores the calculator value and leaves the pond target alone", () => {
		expect(plan({ resolution: "keep" })).toEqual({
			cycleTargetWeightG: 400,
			targetToWrite: undefined,
		});
	});

	it("refuses keep when the saved target cannot fit the cycle field", () => {
		expect(() =>
			plan({
				savedTarget: { ...SAVED, targetWeightG: 20_000 },
				resolution: "keep",
			}),
		).toThrow(CYCLE_TARGET_ERROR.savedOutOfRange);
	});

	it("refuses an out-of-range edit even with no saved target", () => {
		expect(() => plan({ savedTarget: null, nextWeightG: 10_001 })).toThrow(
			CYCLE_TARGET_ERROR.outOfRange,
		);
	});
});

describe("cycleTargetDrift", () => {
	it("reports an in-sync pair", () => {
		expect(cycleTargetDrift({ cycleWeightG: 400, savedTarget: SAVED })).toEqual({
			inSync: true,
			savedWeightG: 400,
			cycleWeightG: 400,
			driftG: 0,
		});
	});

	it("reports a scripted import that wrote only the cycle value", () => {
		// A bulk import or a hand-written script that bypasses the guarded
		// writers would leave exactly this state behind.
		const afterScriptedWrite = { cycleWeightG: 350, savedTarget: SAVED };
		expect(cycleTargetDrift(afterScriptedWrite)).toMatchObject({
			inSync: false,
			savedWeightG: 400,
			cycleWeightG: 350,
			driftG: -50,
		});
	});

	it("reports a saved target with no mirror (legacy #319 rows)", () => {
		expect(cycleTargetDrift({ cycleWeightG: null, savedTarget: SAVED })).toMatchObject({
			inSync: false,
			cycleWeightG: null,
			driftG: -400,
		});
	});

	it("is in sync when there is no saved target", () => {
		expect(cycleTargetDrift({ cycleWeightG: 350, savedTarget: null })).toEqual({
			inSync: true,
			savedWeightG: null,
			cycleWeightG: 350,
			driftG: null,
		});
	});
});

describe("guarded writes", () => {
	it("writes the pond profile with an owner-scoped count guard", async () => {
		const updateMany = vi.fn().mockResolvedValue({ count: 1 });
		const tx = { pond: { updateMany } } as unknown as Prisma.TransactionClient;

		await writePondGrowthTarget(tx, {
			pondId: "pond-1",
			ownerId: "farm-1",
			currentPrefs: { profile: { areaM2: 100 } },
			target: SAVED,
		});

		expect(updateMany).toHaveBeenCalledWith({
			where: { id: "pond-1", ownerId: "farm-1" },
			data: {
				notificationPrefs: {
					profile: {
						areaM2: 100,
						growthTarget: {
							targetWeightG: 400,
							population: 900,
							cycleId: "cycle-1",
							setAt: SAVED.setAt,
						},
					},
				},
			},
		});
	});

	it("refuses a foreign or missing pond", async () => {
		const tx = {
			pond: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
		} as unknown as Prisma.TransactionClient;

		await expect(
			writePondGrowthTarget(tx, {
				pondId: "pond-1",
				ownerId: "farm-2",
				currentPrefs: null,
				target: null,
			}),
		).rejects.toThrow(CYCLE_TARGET_ERROR.pondNotFound);
	});

	it("refuses a mirror write when no active cycle matches", async () => {
		const tx = {
			cropCycle: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
		} as unknown as Prisma.TransactionClient;

		await expect(
			writeCycleTargetMirror(tx, { cycleId: "cycle-1", pondId: "pond-1", weightG: 300 }),
		).rejects.toThrow(CYCLE_TARGET_ERROR.noCycle);
	});

	it("writes the active cycle mirror when exactly one row matches", async () => {
		const updateMany = vi.fn().mockResolvedValue({ count: 1 });
		const tx = { cropCycle: { updateMany } } as unknown as Prisma.TransactionClient;

		await writeCycleTargetMirror(tx, {
			cycleId: "cycle-1",
			pondId: "pond-1",
			weightG: 300,
		});

		expect(updateMany).toHaveBeenCalledWith({
			where: { id: "cycle-1", pondId: "pond-1", status: "ACTIVE" },
			data: { targetHarvestWeightG: 300 },
		});
	});

	it("ignores a missing cycle only when the caller asks (the clear path)", async () => {
		const tx = {
			cropCycle: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
		} as unknown as Prisma.TransactionClient;

		await expect(
			writeCycleTargetMirror(tx, {
				cycleId: "cycle-1",
				pondId: "pond-1",
				weightG: null,
				onMissing: "ignore",
			}),
		).resolves.toBeUndefined();
	});
});
