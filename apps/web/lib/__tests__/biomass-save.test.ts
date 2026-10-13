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

	it("accepts weight-only individual rows end to end (validation reaches the transaction)", async () => {
		const prisma = (await import("@/lib/prisma")).default;
		const mockTx = {
			pond: {
				findUnique: vi.fn().mockResolvedValue({
					ownerId: "test-farm",
					feedingRatePct: 0,
					feedsPerDay: 0,
					population: 1000,
				}),
			},
			biomassLog: { create: vi.fn().mockResolvedValue({ id: "log-1" }) },
			fishSample: { createMany: vi.fn().mockResolvedValue({ count: 2 }) },
		};
		const transactionMock = prisma.$transaction as unknown as ReturnType<typeof vi.fn>;
		transactionMock.mockImplementation(async (input: unknown) => {
			if (typeof input === "function") {
				return input(mockTx);
			}
			return Promise.all((input as (() => Promise<unknown>)[]).map((fn) => fn()));
		});

		const fd = buildFormData({
			sampleLengthCm: "0",
			sampleCount: "2",
			sampleWeightKg: "0.44",
			fishSamples: JSON.stringify([
				{ weightGrams: 220, lengthCm: 0 },
				{ weightGrams: 220, lengthCm: 0 },
			]),
		});
		const result = await saveBiomassLog(fd);
		expect(result).toEqual({ success: true });
		expect(mockTx.fishSample.createMany).toHaveBeenCalledWith({
			data: [
				{ biomassLogId: "log-1", weightGrams: 220, lengthCm: 0 },
				{ biomassLogId: "log-1", weightGrams: 220, lengthCm: 0 },
			],
		});
	});
});
