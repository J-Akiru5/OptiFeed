import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({
	default: {
		energyDevice: {
			findFirst: vi.fn(),
		},
		biomassLog: {
			create: vi.fn(),
		},
		fishSample: {
			createMany: vi.fn(),
		},
		pond: {
			findUnique: vi.fn(),
		},
		deviceStateEvent: {
			create: vi.fn(),
		},
		$transaction: vi.fn(),
	},
}));

vi.mock("@/lib/auth/session", () => ({
	getCurrentPondOwnerId: vi.fn().mockResolvedValue("test-farm"),
	requireWriteAccess: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("next/cache", () => ({
	revalidatePath: vi.fn(),
}));

import { saveBiomassLog } from "@/lib/actions/biomass";
import { biomassLogSchema, fishSampleRowSchema, fishSamplesSchema } from "@/lib/limits";

function buildFormData(overrides: Record<string, string>): FormData {
	const fd = new FormData();
	fd.set("pondId", "pond-1");
	fd.set("sampleWeightKg", "10");
	fd.set("sampleLengthCm", "24");
	fd.set("sampleCount", "5");
	for (const [key, value] of Object.entries(overrides)) {
		fd.set(key, value);
	}
	return fd;
}

describe("biomassLogSchema", () => {
	it("accepts sampleLengthCm of 0 (weight-only individual entries)", () => {
		const result = biomassLogSchema.safeParse({
			sampleCount: 3,
			sampleWeightKg: 1.5,
			sampleLengthCm: 0,
		});
		expect(result.success).toBe(true);
	});

	it("rejects a negative sampleLengthCm", () => {
		const result = biomassLogSchema.safeParse({
			sampleCount: 3,
			sampleWeightKg: 1.5,
			sampleLengthCm: -1,
		});
		expect(result.success).toBe(false);
	});

	it("accepts logs without a batch label (null or omitted)", () => {
		const base = { sampleCount: 3, sampleWeightKg: 1.5, sampleLengthCm: 24 };
		expect(biomassLogSchema.safeParse(base).success).toBe(true);
		expect(biomassLogSchema.safeParse({ ...base, batchLabel: null }).success).toBe(true);
		expect(biomassLogSchema.safeParse({ ...base, batchLabel: "Batch 2026-10 A" }).success).toBe(
			true,
		);
	});

	it("rejects batch labels longer than 64 characters", () => {
		const result = biomassLogSchema.safeParse({
			sampleCount: 3,
			sampleWeightKg: 1.5,
			sampleLengthCm: 24,
			batchLabel: "x".repeat(65),
		});
		expect(result.success).toBe(false);
	});
});

describe("fishSampleRowSchema", () => {
	it("accepts weight-only rows (length optional, defaults to 0)", () => {
		expect(fishSampleRowSchema.safeParse({ weightGrams: 220, lengthCm: 0 }).success).toBe(true);
	});

	it("accepts positive weight and length", () => {
		expect(fishSampleRowSchema.safeParse({ weightGrams: 220, lengthCm: 24.5 }).success).toBe(true);
	});

	it("rejects zero or negative weight", () => {
		expect(fishSampleRowSchema.safeParse({ weightGrams: 0, lengthCm: 20 }).success).toBe(false);
		expect(fishSampleRowSchema.safeParse({ weightGrams: -5, lengthCm: 20 }).success).toBe(false);
	});

	it("rejects negative length", () => {
		expect(fishSampleRowSchema.safeParse({ weightGrams: 100, lengthCm: -1 }).success).toBe(false);
	});

	it("fishSamplesSchema rejects rows with a bad weight anywhere in the array", () => {
		const rows = [
			{ weightGrams: 200, lengthCm: 24 },
			{ weightGrams: 0, lengthCm: 24 },
		];
		const result = fishSamplesSchema.safeParse(rows);
		expect(result.success).toBe(false);
	});
});

describe("saveBiomassLog result shape", () => {
	interface TxMocks {
		pondConfig: { feedingRatePct: number; feedsPerDay: number; population: number | null };
		device:
			| ({
					gramsPerFeeding: number;
					lastSeenAt: Date | null;
			  } & Partial<{
					gramsPerSecond: number;
					dailyCapG: number | null;
					hopperCapacityG: number | null;
			  }>)
			| null;
	}

	async function runTransaction({ pondConfig, device }: TxMocks) {
		const mockTx = {
			pond: {
				findUnique: vi.fn().mockResolvedValue({
					ownerId: "test-farm",
					...pondConfig,
				}),
			},
			biomassLog: { create: vi.fn().mockResolvedValue({ id: "log-1" }) },
			fishSample: { createMany: vi.fn().mockResolvedValue({ count: 0 }) },
			energyDevice: {
				findFirst: vi.fn().mockResolvedValue(device === null ? null : { id: "dev-1", ...device }),
				update: vi.fn().mockResolvedValue({}),
			},
			deviceStateEvent: { create: vi.fn().mockResolvedValue({}) },
			cropCycle: { findFirst: vi.fn().mockResolvedValue(null) },
		};
		const prisma = (await import("@/lib/prisma")).default;
		const transactionMock = prisma.$transaction as unknown as ReturnType<typeof vi.fn>;
		transactionMock.mockImplementation(async (input: unknown) => {
			if (typeof input === "function") {
				return input(mockTx);
			}
			return Promise.all((input as (() => Promise<unknown>)[]).map((fn) => fn()));
		});
		return mockTx;
	}

	const validPond = { feedingRatePct: 4.5, feedsPerDay: 3, population: 100 };
	// sampleWeightKg 0.44 / count 2 → avg 0.22kg → biomass 22,000g →
	// daily 990g → per-meal 330g (feedsPerDay 3).
	const validSample = { sampleWeightKg: "0.44", sampleCount: "2" };

	it("returns a user-facing error instead of throwing for invalid aggregates", async () => {
		const fd = buildFormData({ sampleCount: "0" });
		const result = await saveBiomassLog(fd);
		expect(result.success).toBe(false);
		if (!result.success) {
			expect(result.error).toMatch(/sampleCount/i);
		}
	});

	it("returns a row-indexed error for a weight-only violation", async () => {
		const fd = buildFormData({
			fishSamples: JSON.stringify([
				{ weightGrams: 220, lengthCm: 0 },
				{ weightGrams: 0, lengthCm: 20 },
			]),
		});
		const result = await saveBiomassLog(fd);
		expect(result.success).toBe(false);
		if (!result.success) {
			expect(result.error).toMatch(/Fish #2: Weight must be greater than 0/);
		}
	});

	it("returns an error for unreadable fishSamples JSON instead of dropping rows", async () => {
		const fd = buildFormData({ fishSamples: "{not json" });
		const result = await saveBiomassLog(fd);
		expect(result.success).toBe(false);
		if (!result.success) {
			expect(result.error).toMatch(/could not be read/);
		}
	});

	it("returns an error for a batch label over 64 characters", async () => {
		const fd = buildFormData({ batchLabel: "x".repeat(65) });
		const result = await saveBiomassLog(fd);
		expect(result.success).toBe(false);
		if (!result.success) {
			expect(result.error).toMatch(/64 characters/);
		}
	});

	it("accepts weight-only individual rows end to end and reports skipped_config", async () => {
		const mockTx = await runTransaction({
			pondConfig: { feedingRatePct: 0, feedsPerDay: 0, population: 1000 },
			device: { gramsPerFeeding: 300, lastSeenAt: new Date() },
		});

		const fd = buildFormData({
			sampleLengthCm: "0",
			sampleCount: "2",
			sampleWeightKg: "0.44",
			batchLabel: "Batch 2026-10 A",
			fishSamples: JSON.stringify([
				{ weightGrams: 220, lengthCm: 0 },
				{ weightGrams: 220, lengthCm: 0 },
			]),
		});
		const result = await saveBiomassLog(fd);
		expect(result).toEqual({
			success: true,
			feed: {
				calculatedGrams: null,
				effectiveGrams: 300,
				previousGrams: 300,
				dailyFeedG: null,
				feedsPerDay: 0,
				feedingRatePct: 0,
				population: 1000,
				status: "skipped_config",
				deviceOffline: false,
				batchLabel: "Batch 2026-10 A",
			},
		});
		expect(mockTx.biomassLog.create).toHaveBeenCalledWith({
			data: expect.objectContaining({ batchLabel: "Batch 2026-10 A" }),
		});
		expect(mockTx.fishSample.createMany).toHaveBeenCalledWith({
			data: [
				{ biomassLogId: "log-1", weightGrams: 220, lengthCm: 0 },
				{ biomassLogId: "log-1", weightGrams: 220, lengthCm: 0 },
			],
		});
		expect(mockTx.energyDevice.update).not.toHaveBeenCalled();
	});

	it("updates the device schedule when the recommendation is within 50% deviation", async () => {
		const mockTx = await runTransaction({
			pondConfig: validPond,
			device: { gramsPerFeeding: 300, lastSeenAt: new Date() },
		});

		const result = await saveBiomassLog(buildFormData(validSample));
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.feed).toMatchObject({
				status: "updated",
				calculatedGrams: 330,
				effectiveGrams: 330,
				previousGrams: 300,
				dailyFeedG: 990,
				feedsPerDay: 3,
				feedingRatePct: 4.5,
				population: 100,
				batchLabel: null,
			});
		}
		expect(mockTx.energyDevice.update).toHaveBeenCalledWith({
			where: { id: "dev-1" },
			data: { gramsPerFeeding: 330 },
		});
	});

	it("keeps the previous schedule when the recommendation deviates more than 50%", async () => {
		const mockTx = await runTransaction({
			pondConfig: validPond,
			device: { gramsPerFeeding: 100, lastSeenAt: new Date() },
		});

		const result = await saveBiomassLog(buildFormData(validSample));
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.feed).toMatchObject({
				status: "rejected_deviation",
				calculatedGrams: 330,
				previousGrams: 100,
				effectiveGrams: 100,
			});
		}
		expect(mockTx.energyDevice.update).not.toHaveBeenCalled();
		expect(mockTx.deviceStateEvent.create).toHaveBeenCalledWith(
			expect.objectContaining({
				data: expect.objectContaining({
					metadata: expect.objectContaining({ autoAdjustRejected: true }),
				}),
			}),
		);
	});

	it("reports unchanged when the recommendation equals the current schedule", async () => {
		await runTransaction({
			pondConfig: validPond,
			device: { gramsPerFeeding: 330, lastSeenAt: new Date() },
		});

		const result = await saveBiomassLog(buildFormData(validSample));
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.feed.status).toBe("unchanged");
			expect(result.feed.effectiveGrams).toBe(330);
		}
	});

	it("skips the adjustment when the pond population is not set", async () => {
		const mockTx = await runTransaction({
			pondConfig: { ...validPond, population: null },
			device: { gramsPerFeeding: 300, lastSeenAt: new Date() },
		});

		const result = await saveBiomassLog(buildFormData(validSample));
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.feed).toMatchObject({
				status: "skipped_no_population",
				calculatedGrams: null,
				effectiveGrams: 300,
				population: 0,
			});
		}
		expect(mockTx.energyDevice.update).not.toHaveBeenCalled();
	});

	it("reports skipped_no_device when no device is linked", async () => {
		const mockTx = await runTransaction({
			pondConfig: validPond,
			device: null,
		});

		const result = await saveBiomassLog(buildFormData(validSample));
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.feed).toMatchObject({
				status: "skipped_no_device",
				calculatedGrams: null,
				effectiveGrams: null,
				previousGrams: null,
				deviceOffline: false,
			});
		}
		expect(mockTx.energyDevice.update).not.toHaveBeenCalled();
	});

	it("rejects a recommendation over the daily ceiling but still saves the log", async () => {
		// Default form data: 10kg / 5 fish → avg 2kg → 3,000g per meal at
		// 3 meals is 9,000g/day, over the default 2,000g daily ceiling.
		const mockTx = await runTransaction({
			pondConfig: validPond,
			device: { gramsPerFeeding: 300, lastSeenAt: new Date() },
		});

		const result = await saveBiomassLog(buildFormData({}));
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.feed).toMatchObject({
				status: "rejected_out_of_range",
				calculatedGrams: 3000,
				previousGrams: 300,
				effectiveGrams: 300,
			});
		}
		expect(mockTx.biomassLog.create).toHaveBeenCalled();
		expect(mockTx.energyDevice.update).not.toHaveBeenCalled();
	});

	it("rejects a recommendation the feeder cannot run in one relay window (#430)", async () => {
		// 100 fish x 1 kg x 4.5% = 4,500 g/day, 1,500 g per meal: under the
		// 5,000 g daily ceiling, but over the 1,200 g the feeder can run
		// (4 g/s for 300 s).
		const mockTx = await runTransaction({
			pondConfig: validPond,
			device: {
				gramsPerFeeding: 300,
				lastSeenAt: new Date(),
				gramsPerSecond: 4,
				dailyCapG: 5000,
				hopperCapacityG: null,
			},
		});

		const result = await saveBiomassLog(buildFormData({ sampleWeightKg: "2", sampleCount: "2" }));

		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.feed).toMatchObject({
				status: "rejected_out_of_range",
				calculatedGrams: 1500,
				previousGrams: 300,
				effectiveGrams: 300,
			});
		}
		expect(mockTx.biomassLog.create).toHaveBeenCalled();
		expect(mockTx.energyDevice.update).not.toHaveBeenCalled();
		expect(mockTx.deviceStateEvent.create).toHaveBeenCalledWith(
			expect.objectContaining({
				data: expect.objectContaining({
					metadata: expect.objectContaining({
						reason: expect.stringContaining("relay time"),
					}),
				}),
			}),
		);
	});

	it("flags an offline device in the calculation result", async () => {
		await runTransaction({
			pondConfig: validPond,
			device: { gramsPerFeeding: 330, lastSeenAt: new Date(Date.now() - 60 * 60 * 1000) },
		});

		const result = await saveBiomassLog(buildFormData(validSample));
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.feed.deviceOffline).toBe(true);
		}
	});

	it("uses the offline client event id and treats a duplicate replay as success", async () => {
		const mockTx = await runTransaction({
			pondConfig: validPond,
			device: { gramsPerFeeding: 300, lastSeenAt: new Date() },
		});
		mockTx.biomassLog.create.mockRejectedValueOnce({ code: "P2002" });

		const fd = buildFormData(validSample);
		fd.set("clientEventId", "offline-1234abcd-5678");
		const result = await saveBiomassLog(fd);

		expect(mockTx.biomassLog.create).toHaveBeenCalledWith({
			data: expect.objectContaining({ id: "offline-1234abcd-5678" }),
		});
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.feed.status).toBe("unchanged");
		}
	});
});
