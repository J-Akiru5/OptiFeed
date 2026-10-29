import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
	const tx = {
		pond: { findUnique: vi.fn() },
		biomassLog: { create: vi.fn(), update: vi.fn(), delete: vi.fn() },
		fishSample: { createMany: vi.fn() },
		energyDevice: { findFirst: vi.fn(), update: vi.fn() },
		deviceStateEvent: { create: vi.fn() },
		cropCycle: { findFirst: vi.fn() },
	};
	return {
		tx,
		prisma: {
			biomassLog: { findFirst: vi.fn() },
			$transaction: vi.fn(),
		},
		requireWriteAccess: vi.fn(),
		getCurrentPondOwnerId: vi.fn(),
		applyGrowthPlanForPond: vi.fn(),
		revalidatePath: vi.fn(),
	};
});

vi.mock("@/lib/prisma", () => ({ default: mocks.prisma }));
vi.mock("@/lib/auth/session", () => ({
	requireWriteAccess: mocks.requireWriteAccess,
	getCurrentPondOwnerId: mocks.getCurrentPondOwnerId,
}));
vi.mock("@/lib/growth-plan-apply", () => ({
	applyGrowthPlanForPond: mocks.applyGrowthPlanForPond,
}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));

import { deleteBiomassLog, saveBiomassLog, updateBiomassLog } from "@/lib/actions/biomass";

const OWNER = "owner-1";
const POND = "pond-1";
const DEVICE = "dev-1";

function buildFormData(overrides: Record<string, string> = {}): FormData {
	const formData = new FormData();
	formData.set("pondId", POND);
	// 0.44 kg over 2 fish is 0.22 kg average. At 4.5% and 3 feeds for 100
	// fish that is 22,000 g of biomass -> 990 g/day -> 330 g/meal.
	formData.set("sampleWeightKg", "0.44");
	formData.set("sampleLengthCm", "24");
	formData.set("sampleCount", "2");
	for (const [key, value] of Object.entries(overrides)) {
		formData.set(key, value);
	}
	return formData;
}

function createdLogData(): Record<string, unknown> {
	const call = mocks.tx.biomassLog.create.mock.calls[0]?.[0] as
		| { data: Record<string, unknown> }
		| undefined;
	if (!call) throw new Error("biomassLog.create was not called");
	return call.data;
}

function createdEventMetadata(): Record<string, unknown> {
	const call = mocks.tx.deviceStateEvent.create.mock.calls[0]?.[0] as
		| { data: { metadata: Record<string, unknown> } }
		| undefined;
	if (!call) throw new Error("deviceStateEvent.create was not called");
	return call.data.metadata;
}

beforeEach(() => {
	vi.clearAllMocks();
	mocks.requireWriteAccess.mockResolvedValue(undefined);
	mocks.getCurrentPondOwnerId.mockResolvedValue(OWNER);
	mocks.prisma.$transaction.mockImplementation(async (callback: (tx: unknown) => unknown) =>
		callback(mocks.tx),
	);
	mocks.tx.pond.findUnique.mockResolvedValue({
		ownerId: OWNER,
		feedingRatePct: 4.5,
		feedsPerDay: 3,
		population: 100,
	});
	mocks.tx.biomassLog.create.mockResolvedValue({ id: "log-1" });
	mocks.tx.biomassLog.update.mockResolvedValue({});
	mocks.tx.biomassLog.delete.mockResolvedValue({});
	mocks.tx.fishSample.createMany.mockResolvedValue({ count: 0 });
	mocks.tx.energyDevice.findFirst.mockResolvedValue({
		id: DEVICE,
		gramsPerFeeding: 300,
		lastSeenAt: new Date(),
	});
	mocks.tx.energyDevice.update.mockResolvedValue({});
	mocks.tx.deviceStateEvent.create.mockResolvedValue({});
	mocks.tx.cropCycle.findFirst.mockResolvedValue(null);
	mocks.prisma.biomassLog.findFirst.mockResolvedValue(null);
});

describe("saveBiomassLog with a target-weight cycle", () => {
	beforeEach(() => {
		mocks.tx.cropCycle.findFirst.mockResolvedValue({ id: "cycle-1" });
	});

	it("hands the sample to the target plan instead of the generic formula", async () => {
		mocks.applyGrowthPlanForPond.mockResolvedValue({
			success: true,
			previousGrams: 300,
			newGrams: 330,
		});

		const result = await saveBiomassLog(buildFormData());

		expect(result).toEqual({
			success: true,
			feed: {
				calculatedGrams: 330,
				effectiveGrams: 330,
				previousGrams: 300,
				dailyFeedG: 990,
				feedsPerDay: 3,
				feedingRatePct: 4.5,
				population: 100,
				status: "updated",
				deviceOffline: false,
				batchLabel: null,
			},
		});
		expect(mocks.tx.cropCycle.findFirst).toHaveBeenCalledWith({
			where: { pondId: POND, status: "ACTIVE", targetHarvestWeightG: { not: null } },
			select: { id: true },
		});
		expect(mocks.applyGrowthPlanForPond).toHaveBeenCalledWith({
			pondId: POND,
			ownerId: OWNER,
			actorId: OWNER,
			note: "Applied automatically after a biomass sample.",
			initializeIfFirst: true,
		});
		// The target cycle owns the adjustment; the generic formula must not
		// also move the device in the same sample.
		expect(mocks.tx.energyDevice.update).not.toHaveBeenCalled();
		expect(mocks.tx.deviceStateEvent.create).not.toHaveBeenCalled();
		expect(mocks.revalidatePath).toHaveBeenCalledWith("/[locale]/dashboard", "layout");
	});

	it("keeps the sample and reports a target-plan refusal without inventing a dose", async () => {
		mocks.applyGrowthPlanForPond.mockResolvedValue({
			success: false,
			error: "The previous adjustment is still inside the 15-day window.",
		});

		const result = await saveBiomassLog(buildFormData());

		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.feed).toMatchObject({
				status: "skipped_target_plan",
				calculatedGrams: null,
				effectiveGrams: 300,
				previousGrams: 300,
			});
		}
		expect(mocks.tx.biomassLog.create).toHaveBeenCalledTimes(1);
	});

	it("does not report a daily total when the pond has no feeds configured", async () => {
		mocks.tx.pond.findUnique.mockResolvedValue({
			ownerId: OWNER,
			feedingRatePct: 0,
			feedsPerDay: 0,
			population: 100,
		});
		mocks.applyGrowthPlanForPond.mockResolvedValue({
			success: true,
			previousGrams: 300,
			newGrams: 330,
		});

		const result = await saveBiomassLog(buildFormData());

		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.feed).toMatchObject({
				status: "updated",
				calculatedGrams: 330,
				effectiveGrams: 330,
				dailyFeedG: null,
				feedsPerDay: 0,
			});
		}
	});
});

describe("saveBiomassLog validation and tenant scope", () => {
	it("refuses a fishSamples payload that is not an array", async () => {
		const result = await saveBiomassLog(buildFormData({ fishSamples: '{"weightGrams":220}' }));
		expect(result).toEqual({
			success: false,
			error: "Individual measurements could not be read.",
		});
		expect(mocks.prisma.$transaction).not.toHaveBeenCalled();
	});

	it("refuses a submission with no pond", async () => {
		const result = await saveBiomassLog(buildFormData({ pondId: "" }));
		expect(result).toEqual({ success: false, error: "Missing pond" });
	});

	it("trims a batch label before storing it", async () => {
		await saveBiomassLog(buildFormData({ batchLabel: "  Batch 2026-10 A  " }));
		expect(createdLogData().batchLabel).toBe("Batch 2026-10 A");
	});

	it("stores a blank batch label as null", async () => {
		await saveBiomassLog(buildFormData({ batchLabel: "   " }));
		expect(createdLogData().batchLabel).toBeNull();
	});

	it("ignores a client event id that does not match the offline replay format", async () => {
		await saveBiomassLog(buildFormData({ clientEventId: "offline-short" }));
		expect(createdLogData()).not.toHaveProperty("id");
	});

	it("uses a provided sample timestamp and ignores one from the future", async () => {
		await saveBiomassLog(buildFormData({ recordedAt: "2026-10-01T08:00:00.000Z" }));
		expect(createdLogData().recordedAt).toEqual(new Date("2026-10-01T08:00:00.000Z"));

		mocks.tx.biomassLog.create.mockClear();
		const future = new Date(Date.now() + 10 * 60_000).toISOString();
		await saveBiomassLog(buildFormData({ recordedAt: future }));
		expect(createdLogData()).not.toHaveProperty("recordedAt");
	});

	it("denies a pond owned by a different tenant and writes nothing", async () => {
		mocks.tx.pond.findUnique.mockResolvedValue({
			ownerId: "other-owner",
			feedingRatePct: 4.5,
			feedsPerDay: 3,
			population: 100,
		});

		await expect(saveBiomassLog(buildFormData())).rejects.toThrow("Pond not found");
		expect(mocks.tx.biomassLog.create).not.toHaveBeenCalled();
		expect(mocks.tx.energyDevice.update).not.toHaveBeenCalled();
	});

	it("rethrows a duplicate-key error that is not an offline replay", async () => {
		mocks.tx.biomassLog.create.mockRejectedValueOnce({ code: "P2002" });
		await expect(saveBiomassLog(buildFormData())).rejects.toMatchObject({ code: "P2002" });
	});

	it("treats a device that has never checked in as offline", async () => {
		mocks.tx.energyDevice.findFirst.mockResolvedValue({
			id: DEVICE,
			gramsPerFeeding: 330,
			lastSeenAt: null,
		});

		const result = await saveBiomassLog(buildFormData());

		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.feed).toMatchObject({ deviceOffline: true, status: "unchanged" });
		}
	});
});

describe("updateBiomassLog", () => {
	const input = {
		id: "log-1",
		sampleCount: 4,
		sampleWeightKg: 2,
		sampleLengthCm: 24,
		batchLabel: null as string | null,
	};

	it("rejects invalid aggregate values before reading the sample", async () => {
		const result = await updateBiomassLog({ ...input, sampleCount: 0 });
		expect(result.success).toBe(false);
		if (!result.success) expect(result.error).toMatch(/sampleCount/);
		expect(mocks.requireWriteAccess).toHaveBeenCalled();
		expect(mocks.prisma.biomassLog.findFirst).not.toHaveBeenCalled();
	});

	it("rejects a malformed sample date", async () => {
		const result = await updateBiomassLog({ ...input, recordedAt: "2026/10/01" });
		expect(result).toEqual({
			success: false,
			error: "Use a valid sample date (YYYY-MM-DD).",
		});
		expect(mocks.prisma.biomassLog.findFirst).not.toHaveBeenCalled();
	});

	it("scopes the lookup to the caller's tenant", async () => {
		mocks.prisma.biomassLog.findFirst.mockResolvedValue(null);
		const result = await updateBiomassLog(input);

		expect(result).toEqual({ success: false, error: "Sample not found." });
		expect(mocks.prisma.biomassLog.findFirst).toHaveBeenCalledWith({
			where: { id: "log-1", pond: { ownerId: OWNER } },
			select: { id: true, pondId: true },
		});
		expect(mocks.prisma.$transaction).not.toHaveBeenCalled();
	});

	it("recomputes the aggregates, the sample date and the audit event", async () => {
		mocks.prisma.biomassLog.findFirst.mockResolvedValue({ id: "log-1", pondId: POND });

		const result = await updateBiomassLog({
			...input,
			batchLabel: "Batch B",
			recordedAt: "2026-10-01",
		});

		expect(result).toEqual({ success: true });
		expect(mocks.tx.biomassLog.update).toHaveBeenCalledWith({
			where: { id: "log-1" },
			data: {
				sampleCount: 4,
				sampleWeightKg: 2,
				sampleLengthCm: 24,
				avgWeightKg: 0.5,
				batchLabel: "Batch B",
				recordedAt: new Date("2026-10-01T00:00:00.000Z"),
			},
		});
		expect(createdEventMetadata()).toEqual({
			biomassLogId: "log-1",
			sampleCount: 4,
			sampleWeightKg: 2,
			avgWeightKg: 0.5,
		});
		expect(mocks.revalidatePath).toHaveBeenCalledWith("/[locale]/dashboard", "layout");
	});

	it("leaves the stored date alone and skips the audit event without a device", async () => {
		mocks.prisma.biomassLog.findFirst.mockResolvedValue({ id: "log-1", pondId: POND });
		mocks.tx.energyDevice.findFirst.mockResolvedValue(null);

		await updateBiomassLog(input);

		const update = mocks.tx.biomassLog.update.mock.calls[0]?.[0] as { data: object };
		expect(update.data).not.toHaveProperty("recordedAt");
		expect(mocks.tx.deviceStateEvent.create).not.toHaveBeenCalled();
	});

	it("returns a user-facing error when the update throws", async () => {
		const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
		mocks.prisma.biomassLog.findFirst.mockResolvedValue({ id: "log-1", pondId: POND });
		mocks.tx.biomassLog.update.mockRejectedValueOnce(new Error("write conflict"));

		const result = await updateBiomassLog(input);

		expect(result).toEqual({ success: false, error: "Could not update the sample." });
		expect(consoleError).toHaveBeenCalledWith(
			"[biomass] update failed:",
			expect.objectContaining({ message: "write conflict" }),
		);
		consoleError.mockRestore();
	});
});

describe("deleteBiomassLog", () => {
	it("scopes the lookup to the caller's tenant", async () => {
		mocks.prisma.biomassLog.findFirst.mockResolvedValue(null);
		const result = await deleteBiomassLog("log-1");

		expect(result).toEqual({ success: false, error: "Sample not found." });
		expect(mocks.prisma.biomassLog.findFirst).toHaveBeenCalledWith({
			where: { id: "log-1", pond: { ownerId: OWNER } },
			select: { id: true, pondId: true },
		});
		expect(mocks.tx.biomassLog.delete).not.toHaveBeenCalled();
	});

	it("deletes the sample and records the audit event on the pond's device", async () => {
		mocks.prisma.biomassLog.findFirst.mockResolvedValue({ id: "log-1", pondId: POND });

		const result = await deleteBiomassLog("log-1");

		expect(result).toEqual({ success: true });
		expect(mocks.tx.biomassLog.delete).toHaveBeenCalledWith({ where: { id: "log-1" } });
		expect(mocks.tx.deviceStateEvent.create).toHaveBeenCalledWith({
			data: {
				deviceId: DEVICE,
				eventType: "biomass_log_deleted",
				source: "user",
				actorId: OWNER,
				metadata: { biomassLogId: "log-1" },
			},
		});
		expect(mocks.revalidatePath).toHaveBeenCalledWith("/[locale]/dashboard", "layout");
	});

	it("deletes the sample without an audit event when no device is linked", async () => {
		mocks.prisma.biomassLog.findFirst.mockResolvedValue({ id: "log-1", pondId: POND });
		mocks.tx.energyDevice.findFirst.mockResolvedValue(null);

		await deleteBiomassLog("log-1");

		expect(mocks.tx.biomassLog.delete).toHaveBeenCalledTimes(1);
		expect(mocks.tx.deviceStateEvent.create).not.toHaveBeenCalled();
	});

	it("returns a user-facing error when the delete throws", async () => {
		const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
		mocks.prisma.biomassLog.findFirst.mockResolvedValue({ id: "log-1", pondId: POND });
		mocks.tx.biomassLog.delete.mockRejectedValueOnce(new Error("foreign key"));

		const result = await deleteBiomassLog("log-1");

		expect(result).toEqual({ success: false, error: "Could not delete the sample." });
		expect(consoleError).toHaveBeenCalledWith(
			"[biomass] delete failed:",
			expect.objectContaining({ message: "foreign key" }),
		);
		consoleError.mockRestore();
	});
});
