import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({
	default: {
		pond: { findUnique: vi.fn() },
		biomassLog: { findFirst: vi.fn() },
		energyDevice: { findFirst: vi.fn(), updateMany: vi.fn() },
		deviceStateEvent: { create: vi.fn() },
	},
}));

import { syncDeviceGramsForPond } from "@/lib/feed-grams";
import { deriveDeviceDose } from "@/lib/feeding/derive";
import prisma from "@/lib/prisma";

const mockPond = vi.mocked(prisma.pond);
const mockBiomassLog = vi.mocked(prisma.biomassLog);
const mockEnergyDevice = vi.mocked(prisma.energyDevice);
const mockDeviceStateEvent = vi.mocked(prisma.deviceStateEvent);

describe("syncDeviceGramsForPond", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("skips the auto-adjust and records why when population is null (N3)", async () => {
		mockPond.findUnique.mockResolvedValue({
			feedingRatePct: 4,
			feedsPerDay: 2,
			population: null,
		} as never);
		mockBiomassLog.findFirst.mockResolvedValue({ avgWeightKg: 0.01378 } as never);
		mockEnergyDevice.findFirst.mockResolvedValue({ id: "device-1" } as never);

		const result = await syncDeviceGramsForPond("pond-1");

		expect(result).toBeNull();
		expect(mockEnergyDevice.updateMany).not.toHaveBeenCalled();
		expect(mockDeviceStateEvent.create).toHaveBeenCalledTimes(1);
		expect(mockDeviceStateEvent.create).toHaveBeenCalledWith({
			data: expect.objectContaining({
				deviceId: "device-1",
				eventType: "auto_adjust_skipped",
				metadata: expect.objectContaining({
					reason: expect.stringContaining("population"),
				}),
			}),
		});
	});

	it("computes and writes grams when population is set", async () => {
		mockPond.findUnique.mockResolvedValue({
			feedingRatePct: 5,
			feedsPerDay: 2,
			population: 86,
		} as never);
		mockBiomassLog.findFirst.mockResolvedValue({ avgWeightKg: 0.01378 } as never);

		const result = await syncDeviceGramsForPond("pond-1");

		expect(result).toBe(29.63);
		expect(mockEnergyDevice.updateMany).toHaveBeenCalledWith({
			where: { pondId: "pond-1" },
			data: { gramsPerFeeding: 29.63 },
		});
		expect(mockDeviceStateEvent.create).not.toHaveBeenCalled();
	});

	it("uses an explicit config override over the pond row", async () => {
		mockPond.findUnique.mockResolvedValue({
			feedingRatePct: 3,
			feedsPerDay: 3,
			population: 86,
		} as never);
		mockBiomassLog.findFirst.mockResolvedValue({ avgWeightKg: 0.01378 } as never);

		const result = await syncDeviceGramsForPond("pond-1", {
			feedingRatePct: 5,
			feedsPerDay: 3,
		});

		expect(result).toBe(19.75);
		expect(mockEnergyDevice.updateMany).toHaveBeenCalledWith({
			where: { pondId: "pond-1" },
			data: { gramsPerFeeding: 19.75 },
		});
	});

	it("never writes a dose the feeder cannot run in one relay window (#430)", async () => {
		// 600 fish x 140.67 g x 5% / 2 meals = 2,110 g per meal, and the feeder
		// can only run 4 g/s for 300 s = 1,200 g.
		mockPond.findUnique.mockResolvedValue({
			feedingRatePct: 5,
			feedsPerDay: 2,
			population: 600,
		} as never);
		mockBiomassLog.findFirst.mockResolvedValue({ avgWeightKg: 0.1406705882352941 } as never);
		mockEnergyDevice.findFirst.mockResolvedValue({
			id: "device-1",
			gramsPerSecond: 4,
			dailyCapG: 5000,
			hopperCapacityG: 7000,
		} as never);

		const result = await syncDeviceGramsForPond("pond-1");

		expect(result).toBeNull();
		expect(mockEnergyDevice.updateMany).not.toHaveBeenCalled();
	});

	it("says which limit blocked the dose (#430)", async () => {
		mockPond.findUnique.mockResolvedValue({
			feedingRatePct: 5,
			feedsPerDay: 2,
			population: 600,
		} as never);
		mockBiomassLog.findFirst.mockResolvedValue({ avgWeightKg: 0.1406705882352941 } as never);
		mockEnergyDevice.findFirst.mockResolvedValue({
			id: "device-1",
			gramsPerSecond: 4,
			dailyCapG: 5000,
			hopperCapacityG: 7000,
		} as never);

		const result = await deriveDeviceDose("pond-1");

		expect(result.status).toBe("exceeds_relay_time");
		expect(result.grams).toBeCloseTo(2110.06, 1);
		expect(result.maxDoseG).toBe(1200);
		expect(mockEnergyDevice.updateMany).not.toHaveBeenCalled();
	});
});
