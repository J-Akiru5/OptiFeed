import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Applying a predicted feed amount is a write to hardware, so every safety
 * layer is asserted with both an allow and a deny case: write access, pond and
 * device ownership, the 1–1000 g schema range, the device's per-meal ceiling,
 * the ±50% deviation veto, and the compare-and-swap that refuses to overwrite a
 * concurrent schedule change.
 */

const {
	prisma,
	tx,
	getActivePond,
	getCurrentPondOwnerId,
	requireWriteAccess,
	resolveCurrentSchedule,
} = vi.hoisted(() => {
	const tx = {
		energyDevice: { updateMany: vi.fn() },
		deviceStateEvent: { create: vi.fn() },
	};
	const prisma = {
		energyDevice: { findFirst: vi.fn() },
		$transaction: vi.fn(),
	};
	return {
		prisma,
		tx,
		getActivePond: vi.fn(),
		getCurrentPondOwnerId: vi.fn(),
		requireWriteAccess: vi.fn(),
		resolveCurrentSchedule: vi.fn(),
	};
});

vi.mock("@/lib/prisma", () => ({ default: prisma }));
vi.mock("@/lib/auth/session", () => ({ getCurrentPondOwnerId, requireWriteAccess }));
vi.mock("@/lib/pond-selection", () => ({ getActivePond }));
vi.mock("@/lib/schedule/resolve-current", () => ({ resolveCurrentSchedule }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { applyPredictedGrams } from "@/lib/actions/prediction";
import { revalidatePath } from "next/cache";

const DEVICE = {
	id: "dev-1",
	pondId: "pond-1",
	gramsPerFeeding: 140,
	hopperCapacityG: null,
	dailyCapG: null,
};

beforeEach(() => {
	vi.clearAllMocks();
	requireWriteAccess.mockResolvedValue(undefined);
	getCurrentPondOwnerId.mockResolvedValue("farm-a");
	getActivePond.mockResolvedValue({ id: "pond-1" });
	prisma.energyDevice.findFirst.mockResolvedValue(DEVICE);
	resolveCurrentSchedule.mockResolvedValue({ feedsPerDay: 4, feedingRatePct: 3 });
	tx.energyDevice.updateMany.mockResolvedValue({ count: 1 });
	tx.deviceStateEvent.create.mockResolvedValue({});
	prisma.$transaction.mockImplementation(async (fn: (client: typeof tx) => Promise<boolean>) =>
		fn(tx),
	);
});

describe("authorization and scoping", () => {
	it("writes nothing when the caller lacks write access", async () => {
		requireWriteAccess.mockRejectedValue(new Error("Write access required"));

		await expect(applyPredictedGrams("dev-1", 150)).resolves.toEqual({
			success: false,
			error: "Failed to apply prediction. Try again.",
		});
		expect(prisma.energyDevice.findFirst).not.toHaveBeenCalled();
		expect(prisma.$transaction).not.toHaveBeenCalled();
	});

	it("scopes the device lookup to the active pond and its owner", async () => {
		await applyPredictedGrams("dev-1", 150);

		expect(prisma.energyDevice.findFirst).toHaveBeenCalledWith(
			expect.objectContaining({
				where: { id: "dev-1", pondId: "pond-1", pond: { ownerId: "farm-a" } },
			}),
		);
	});

	it("refuses a farm with no active pond", async () => {
		getActivePond.mockResolvedValue(null);

		await expect(applyPredictedGrams("dev-1", 150)).resolves.toEqual({
			success: false,
			error: "No active pond.",
		});
		expect(prisma.energyDevice.findFirst).not.toHaveBeenCalled();
	});

	it("refuses a device that is not on the active pond", async () => {
		prisma.energyDevice.findFirst.mockResolvedValue(null);

		await expect(applyPredictedGrams("dev-9", 150)).resolves.toEqual({
			success: false,
			error: "Device not found for the active pond.",
		});
		expect(prisma.$transaction).not.toHaveBeenCalled();
	});

	it("refuses a device row with no pond binding", async () => {
		prisma.energyDevice.findFirst.mockResolvedValue({ ...DEVICE, pondId: null });

		await expect(applyPredictedGrams("dev-1", 150)).resolves.toEqual({
			success: false,
			error: "Device not found for the active pond.",
		});
	});
});

describe("schema range", () => {
	it("rejects a value below 1 g", async () => {
		const result = await applyPredictedGrams("dev-1", 0.4);

		expect(result.success).toBe(false);
		expect(result.error).toContain("at least 1 g");
		expect(prisma.$transaction).not.toHaveBeenCalled();
	});

	it("rejects a value above the 1000 g request cap", async () => {
		const result = await applyPredictedGrams("dev-1", 1001);

		expect(result.success).toBe(false);
		expect(result.error).toContain("1000 g");
		expect(prisma.$transaction).not.toHaveBeenCalled();
	});

	it("rounds sub-gram precision before validating and storing", async () => {
		const result = await applyPredictedGrams("dev-1", 150.04);

		expect(result).toMatchObject({ success: true, previousGrams: 140, newGrams: 150 });
		expect(tx.energyDevice.updateMany).toHaveBeenCalledWith({
			where: { id: "dev-1", gramsPerFeeding: 140 },
			data: { gramsPerFeeding: 150 },
		});
	});

	it("rounds 150.06 up to 150.1", async () => {
		const result = await applyPredictedGrams("dev-1", 150.06);

		expect(result.newGrams).toBe(150.1);
	});
});

describe("device ceiling", () => {
	it("refuses a value above the daily cap divided by the meal count", async () => {
		// Default 2,000 g daily ceiling over 4 meals → 500 g per meal.
		const result = await applyPredictedGrams("dev-1", 600, { source: "ai" });

		expect(result).toEqual({
			success: false,
			error: "That amount exceeds this device's safe per-meal limit of 500.0 g.",
		});
		expect(tx.energyDevice.updateMany).not.toHaveBeenCalled();
	});

	it("uses the hopper size when it is smaller than the daily ceiling", async () => {
		prisma.energyDevice.findFirst.mockResolvedValue({ ...DEVICE, hopperCapacityG: 400 });

		const result = await applyPredictedGrams("dev-1", 150);

		expect(result).toMatchObject({
			success: false,
			error: expect.stringContaining("100.0 g"),
		});
	});

	it("applies the device ceiling before the deviation band", async () => {
		// 500 g is exactly the 4-meal ceiling, so the ceiling check passes and the
		// ±50% band is what refuses the change from 140 g.
		const result = await applyPredictedGrams("dev-1", 500);

		expect(result.success).toBe(false);
		expect(result.error).toContain("safety threshold");
		expect(result.error).not.toContain("safe per-meal limit");
	});
});

describe("deviation veto", () => {
	it("refuses a change above 50% of the current device value", async () => {
		const result = await applyPredictedGrams("dev-1", 280);

		expect(result).toMatchObject({ success: false, previousGrams: 140 });
		expect(result.error).toContain("Prediction deviates 100%");
		expect(result.error).toContain("above the 50% safety threshold");
		expect(prisma.$transaction).not.toHaveBeenCalled();
	});

	it("accepts a change exactly at the 50% boundary", async () => {
		const result = await applyPredictedGrams("dev-1", 210);

		expect(result).toMatchObject({ success: true, newGrams: 210 });
	});

	it("skips the deviation veto when the device has no positive baseline", async () => {
		prisma.energyDevice.findFirst.mockResolvedValue({ ...DEVICE, gramsPerFeeding: 0 });

		const result = await applyPredictedGrams("dev-1", 150, { source: "deterministic" });

		expect(result.success).toBe(true);
		expect(tx.deviceStateEvent.create.mock.calls[0][0].data.metadata.deviationPct).toBe(0);
	});
});

describe("compare-and-swap", () => {
	it("refuses to overwrite a schedule that changed during review", async () => {
		tx.energyDevice.updateMany.mockResolvedValue({ count: 0 });

		const result = await applyPredictedGrams("dev-1", 150);

		expect(result).toEqual({
			success: false,
			error: "The schedule changed while you were reviewing. Refresh and try again.",
		});
		expect(tx.deviceStateEvent.create).not.toHaveBeenCalled();
		expect(revalidatePath).not.toHaveBeenCalled();
	});

	it("writes no audit event and reports a generic failure when the transaction throws", async () => {
		prisma.$transaction.mockRejectedValue(new Error("deadlock"));

		const result = await applyPredictedGrams("dev-1", 150);

		expect(result).toEqual({
			success: false,
			error: "Failed to apply prediction. Try again.",
		});
	});
});

describe("successful apply", () => {
	it("records the previous value, the new value and the sanitised AI context", async () => {
		const result = await applyPredictedGrams("dev-1", 150, {
			source: "ai",
			confidence: "high",
			baselineGrams: 148.44,
		});

		expect(result).toMatchObject({ success: true, previousGrams: 140, newGrams: 150 });
		expect(result.appliedAt).toEqual(expect.any(String));
		expect(tx.deviceStateEvent.create.mock.calls[0][0]).toEqual({
			data: {
				deviceId: "dev-1",
				eventType: "prediction_applied",
				source: "user",
				actorId: "farm-a",
				metadata: {
					gramsApplied: 150,
					gramsPrevious: 140,
					deviationPct: 10 / 140,
					predictionSource: "ai",
					predictionConfidence: "high",
					predictionBaselineGrams: 148.4,
				},
			},
		});
		expect(revalidatePath).toHaveBeenCalledTimes(2);
	});

	it("drops an unknown source and confidence and caps the recorded baseline", async () => {
		await applyPredictedGrams("dev-1", 150, {
			source: "human" as never,
			confidence: "certain" as never,
			// Above the 1,000 g device ceiling the client must not be trusted.
			baselineGrams: 5_000,
		});

		const metadata = tx.deviceStateEvent.create.mock.calls[0][0].data.metadata;
		expect(metadata).toMatchObject({
			predictionSource: null,
			predictionConfidence: null,
			predictionBaselineGrams: 1000,
		});
	});

	it("records null context fields when the caller sends none", async () => {
		await applyPredictedGrams("dev-1", 150);

		expect(tx.deviceStateEvent.create.mock.calls[0][0].data.metadata).toMatchObject({
			predictionSource: null,
			predictionConfidence: null,
			predictionBaselineGrams: null,
		});
	});
});
