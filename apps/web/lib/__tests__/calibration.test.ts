import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({
	default: {
		energyDevice: {
			findFirst: vi.fn(),
			update: vi.fn(),
		},
		feedRequest: {
			create: vi.fn(),
			findFirst: vi.fn(),
			updateMany: vi.fn(),
			aggregate: vi.fn(),
		},
		deviceStateEvent: {
			create: vi.fn(),
		},
	},
}));

vi.mock("@/lib/auth/session", () => ({
	getCurrentPondOwnerId: vi.fn().mockResolvedValue("test-farm"),
	requireWriteAccess: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/auth/permissions", () => ({
	requirePermission: vi.fn().mockResolvedValue(undefined),
	hasPermission: vi.fn().mockResolvedValue(true),
}));

vi.mock("next/cache", () => ({
	revalidatePath: vi.fn(),
}));

import {
	getCalibrationTestStatus,
	runCalibrationTest,
	saveCalibrationFromTest,
} from "@/lib/actions/calibration";
import { saveDurationCalibration } from "@/lib/actions/energy";
import { requirePermission } from "@/lib/auth/permissions";
import { requireWriteAccess } from "@/lib/auth/session";
import { CALIBRATION_TEST_GRAMS_MAX, OFFLINE_THRESHOLD_MS } from "@/lib/limits";
import prisma from "@/lib/prisma";
import { revalidatePath } from "next/cache";

const mockEnergyDevice = vi.mocked(prisma.energyDevice);
const mockFeedRequest = vi.mocked(prisma.feedRequest);
const mockDeviceStateEvent = vi.mocked(prisma.deviceStateEvent);
const mockRequireWriteAccess = vi.mocked(requireWriteAccess);
const mockRequirePermission = vi.mocked(requirePermission);
const mockRevalidatePath = vi.mocked(revalidatePath);

function onlineDevice(overrides: Record<string, unknown> = {}) {
	return {
		gramsPerFeeding: 150,
		gramsPerSecond: 4,
		lastSeenAt: new Date(),
		hopperCapacityG: null,
		pond: { isFallow: false },
		...overrides,
	};
}

beforeEach(() => {
	vi.clearAllMocks();
	mockRequireWriteAccess.mockResolvedValue(undefined);
	mockRequirePermission.mockResolvedValue(undefined);
	mockEnergyDevice.findFirst.mockResolvedValue(onlineDevice() as never);
	mockEnergyDevice.update.mockResolvedValue({} as never);
	mockFeedRequest.updateMany.mockResolvedValue({ count: 0 } as never);
	mockFeedRequest.findFirst.mockResolvedValue(null);
	mockFeedRequest.aggregate.mockResolvedValue({ _sum: { grams: 0 } } as never);
	mockFeedRequest.create.mockResolvedValue({ id: "req-1" } as never);
	mockDeviceStateEvent.create.mockResolvedValue({} as never);
});

describe("runCalibrationTest", () => {
	it("queues a pending test dose and records the queued event", async () => {
		const result = await runCalibrationTest("device-1", 10);

		expect(result).toEqual({
			success: true,
			requestId: "req-1",
			testGrams: 40,
			expectedSeconds: 10,
		});
		expect(mockFeedRequest.create).toHaveBeenCalledWith({
			data: { deviceId: "device-1", grams: 40, status: "pending" },
		});
		expect(mockDeviceStateEvent.create).toHaveBeenCalledWith({
			data: {
				deviceId: "device-1",
				eventType: "calibration_test_queued",
				source: "user",
				actorId: "test-farm",
				metadata: {
					requestId: "req-1",
					testSeconds: 10,
					testGrams: 40,
					gramsPerSecond: 4,
					method: "test_dose",
				},
			},
		});
		expect(mockRequirePermission).toHaveBeenCalledWith("manage_schedule");
		expect(mockRequirePermission).toHaveBeenCalledWith("control_feeder");
		expect(mockRevalidatePath).toHaveBeenCalledTimes(3);
	});

	it.each([2, 31, 5.5])("rejects an invalid test duration (%s s)", async (seconds) => {
		const result = await runCalibrationTest("device-1", seconds);

		expect(result).toEqual({
			success: false,
			error: expect.stringContaining("between 3 and 30"),
		});
		expect(mockEnergyDevice.findFirst).not.toHaveBeenCalled();
		expect(mockFeedRequest.create).not.toHaveBeenCalled();
	});

	it("returns an error when the device is not found", async () => {
		mockEnergyDevice.findFirst.mockResolvedValue(null);

		const result = await runCalibrationTest("device-1", 10);

		expect(result).toEqual({ success: false, error: "Device not found" });
		expect(mockFeedRequest.create).not.toHaveBeenCalled();
	});

	it("rejects a fallow pond", async () => {
		mockEnergyDevice.findFirst.mockResolvedValue(
			onlineDevice({ pond: { isFallow: true } }) as never,
		);

		const result = await runCalibrationTest("device-1", 10);

		expect(result).toEqual({
			success: false,
			error: expect.stringContaining("fallow"),
		});
		expect(mockFeedRequest.create).not.toHaveBeenCalled();
	});

	it("rejects an offline device", async () => {
		mockEnergyDevice.findFirst.mockResolvedValue(
			onlineDevice({ lastSeenAt: new Date(Date.now() - OFFLINE_THRESHOLD_MS - 1000) }) as never,
		);

		const result = await runCalibrationTest("device-1", 10);

		expect(result).toEqual({
			success: false,
			error: expect.stringContaining("offline"),
		});
		expect(mockFeedRequest.create).not.toHaveBeenCalled();
	});

	it("rejects while another feed request is pending", async () => {
		mockFeedRequest.findFirst.mockResolvedValue({ status: "pending" } as never);

		const result = await runCalibrationTest("device-1", 10);

		expect(result).toEqual({
			success: false,
			error: expect.stringContaining("already in progress"),
		});
		expect(mockFeedRequest.create).not.toHaveBeenCalled();
		expect(mockDeviceStateEvent.create).not.toHaveBeenCalled();
	});

	it("rejects a test dose over the 1000 g ceiling without writing", async () => {
		mockEnergyDevice.findFirst.mockResolvedValue(
			onlineDevice({ gramsPerSecond: 50, hopperCapacityG: 5000 }) as never,
		);

		const result = await runCalibrationTest("device-1", 30);

		expect(result).toEqual({
			success: false,
			error: expect.stringContaining(String(CALIBRATION_TEST_GRAMS_MAX)),
		});
		expect(mockFeedRequest.aggregate).not.toHaveBeenCalled();
		expect(mockFeedRequest.create).not.toHaveBeenCalled();
	});

	it("rejects a test dose under 1 g and names the range", async () => {
		mockEnergyDevice.findFirst.mockResolvedValue(onlineDevice({ gramsPerSecond: 0.2 }) as never);

		const result = await runCalibrationTest("device-1", 3);

		expect(result).toEqual({
			success: false,
			error: expect.stringContaining(`1–${CALIBRATION_TEST_GRAMS_MAX}`),
		});
		expect(mockFeedRequest.create).not.toHaveBeenCalled();
	});

	it("enforces the daily feed cap the same way requestFeed does", async () => {
		mockEnergyDevice.findFirst.mockResolvedValue(onlineDevice({ hopperCapacityG: 2000 }) as never);
		mockFeedRequest.aggregate.mockResolvedValue({ _sum: { grams: 1990 } } as never);

		const result = await runCalibrationTest("device-1", 10);

		expect(result).toEqual({
			success: false,
			error: expect.stringContaining("Daily feed limit"),
		});
		expect(mockFeedRequest.aggregate).toHaveBeenCalledWith({
			where: expect.objectContaining({
				deviceId: "device-1",
				status: { in: ["pending", "dispatched", "completed"] },
			}),
			_sum: { grams: true },
		});
		expect(mockFeedRequest.create).not.toHaveBeenCalled();
	});

	it("throws without writing when write access is denied", async () => {
		mockRequireWriteAccess.mockRejectedValue(
			new Error("Write access required (ADMIN or OPERATOR)"),
		);

		await expect(runCalibrationTest("device-1", 10)).rejects.toThrow(/Write access required/);

		expect(mockEnergyDevice.findFirst).not.toHaveBeenCalled();
		expect(mockFeedRequest.create).not.toHaveBeenCalled();
	});
});

describe("getCalibrationTestStatus", () => {
	it("reports the request status scoped to the caller's pond", async () => {
		mockFeedRequest.findFirst.mockResolvedValue({ status: "completed" } as never);

		const result = await getCalibrationTestStatus("device-1", "req-1");

		expect(result).toEqual({ success: true, status: "completed" });
		expect(mockFeedRequest.findFirst).toHaveBeenCalledWith({
			where: {
				id: "req-1",
				deviceId: "device-1",
				device: { pond: { ownerId: "test-farm" } },
			},
			select: { status: true },
		});
	});

	it("reports a pending request as pending", async () => {
		mockFeedRequest.findFirst.mockResolvedValue({ status: "pending" } as never);

		const result = await getCalibrationTestStatus("device-1", "req-1");

		expect(result).toEqual({ success: true, status: "pending" });
	});

	it("maps fulfilled_by_other_trigger to expired", async () => {
		mockFeedRequest.findFirst.mockResolvedValue({ status: "fulfilled_by_other_trigger" } as never);

		const result = await getCalibrationTestStatus("device-1", "req-1");

		expect(result).toEqual({ success: true, status: "expired" });
	});

	it("returns missing when the request does not belong to the caller's farm", async () => {
		mockFeedRequest.findFirst.mockResolvedValue(null);

		const result = await getCalibrationTestStatus("device-1", "req-other-farm");

		expect(result).toEqual({ success: true, status: "missing" });
	});

	it("returns an error result when the lookup fails", async () => {
		mockFeedRequest.findFirst.mockRejectedValue(new Error("db down"));

		const result = await getCalibrationTestStatus("device-1", "req-1");

		expect(result).toEqual({
			success: false,
			error: "Failed to check calibration test status",
		});
	});
});

describe("saveCalibrationFromTest", () => {
	beforeEach(() => {
		mockFeedRequest.findFirst.mockResolvedValue({ status: "completed" } as never);
	});

	it("saves the measured rate and reports before/after feed duration", async () => {
		mockEnergyDevice.findFirst.mockResolvedValue(
			onlineDevice({ gramsPerFeeding: 150, gramsPerSecond: 4 }) as never,
		);

		const result = await saveCalibrationFromTest("device-1", "req-1", 10, 50);

		expect(result).toEqual({
			success: true,
			previousGramsPerSecond: 4,
			newGramsPerSecond: 5,
			gramsPerFeeding: 150,
			previousDurationSeconds: 37.5,
			newDurationSeconds: 30,
		});
		expect(mockEnergyDevice.update).toHaveBeenCalledWith({
			where: { id: "device-1" },
			data: { gramsPerSecond: 5 },
		});
		expect(mockDeviceStateEvent.create).toHaveBeenCalledWith({
			data: {
				deviceId: "device-1",
				eventType: "duration_calibrated",
				source: "user",
				actorId: "test-farm",
				metadata: {
					oldGps: 4,
					newGps: 5,
					testSeconds: 10,
					actualGrams: 50,
					method: "test_dose",
					requestId: "req-1",
				},
			},
		});
		expect(mockRevalidatePath).toHaveBeenCalledTimes(3);
	});

	it("rounds the measured rate to two decimals", async () => {
		mockEnergyDevice.findFirst.mockResolvedValue(
			onlineDevice({ gramsPerFeeding: 100, gramsPerSecond: 4.1 }) as never,
		);

		const result = await saveCalibrationFromTest("device-1", "req-1", 10, 46.5);

		expect(result.success).toBe(true);
		expect(result.newGramsPerSecond).toBe(4.65);
		expect(result.previousGramsPerSecond).toBe(4.1);
		expect(result.previousDurationSeconds).toBe(24.4);
		expect(result.newDurationSeconds).toBe(21.5);
	});

	it("refuses to save before the test dose is confirmed", async () => {
		mockFeedRequest.findFirst.mockResolvedValue({ status: "pending" } as never);

		const result = await saveCalibrationFromTest("device-1", "req-1", 10, 50);

		expect(result).toEqual({
			success: false,
			error: expect.stringContaining("not confirmed yet"),
		});
		expect(mockEnergyDevice.update).not.toHaveBeenCalled();
		expect(mockDeviceStateEvent.create).not.toHaveBeenCalled();
		expect(mockRevalidatePath).not.toHaveBeenCalled();
	});

	it("refuses a request for another farm", async () => {
		mockFeedRequest.findFirst.mockResolvedValue(null);

		const result = await saveCalibrationFromTest("device-1", "req-other-farm", 10, 50);

		expect(result).toEqual({ success: false, error: "Test dose not found" });
		expect(mockEnergyDevice.update).not.toHaveBeenCalled();
	});

	it("rejects a measured rate below the supported range and reports it", async () => {
		const result = await saveCalibrationFromTest("device-1", "req-1", 10, 2);

		expect(result).toEqual({
			success: false,
			error: expect.stringContaining("Measured rate 0.2 g/s"),
		});
		expect(result.error).toContain("0.5–50");
		expect(mockEnergyDevice.update).not.toHaveBeenCalled();
	});

	it("rejects a measured rate above the supported range and reports it", async () => {
		const result = await saveCalibrationFromTest("device-1", "req-1", 10, 600);

		expect(result).toEqual({
			success: false,
			error: expect.stringContaining("Measured rate 60 g/s"),
		});
		expect(mockEnergyDevice.update).not.toHaveBeenCalled();
	});

	it("rejects a non-positive or non-finite weighed output", async () => {
		for (const grams of [0, Number.NaN, Number.POSITIVE_INFINITY, -5]) {
			const result = await saveCalibrationFromTest("device-1", "req-1", 10, grams);
			expect(result.success).toBe(false);
			expect(result.error).toContain("2000");
		}
		expect(mockEnergyDevice.update).not.toHaveBeenCalled();
	});

	it("rejects a weighed output above the 2000 g ceiling", async () => {
		const result = await saveCalibrationFromTest("device-1", "req-1", 10, 2001);

		expect(result).toEqual({
			success: false,
			error: expect.stringContaining("2000"),
		});
		expect(mockEnergyDevice.update).not.toHaveBeenCalled();
	});

	it("rejects an invalid test duration", async () => {
		const result = await saveCalibrationFromTest("device-1", "req-1", 31, 50);

		expect(result).toEqual({
			success: false,
			error: expect.stringContaining("between 3 and 30"),
		});
		expect(mockFeedRequest.findFirst).not.toHaveBeenCalled();
		expect(mockEnergyDevice.update).not.toHaveBeenCalled();
	});

	it("throws without writing when the manage_schedule permission is denied", async () => {
		mockRequirePermission.mockRejectedValue(new Error("Forbidden"));

		await expect(saveCalibrationFromTest("device-1", "req-1", 10, 50)).rejects.toThrow("Forbidden");

		expect(mockRequirePermission).toHaveBeenCalledWith("manage_schedule");
		expect(mockEnergyDevice.update).not.toHaveBeenCalled();
	});
});

describe("saveDurationCalibration manual limits", () => {
	beforeEach(() => {
		// Only the existence/ownership lookup matters for the manual save path.
		mockEnergyDevice.findFirst.mockResolvedValue({ id: "device-1" } as never);
	});

	it("accepts the inclusive 0.5–50 g/s bounds and keeps the audit event", async () => {
		const low = await saveDurationCalibration("device-1", 0.5);
		const high = await saveDurationCalibration("device-1", 50);

		expect(low.success).toBe(true);
		expect(high.success).toBe(true);
		expect(mockEnergyDevice.update).toHaveBeenCalledWith({
			where: { id: "device-1" },
			data: { gramsPerSecond: 0.5 },
		});
		expect(mockEnergyDevice.update).toHaveBeenCalledWith({
			where: { id: "device-1" },
			data: { gramsPerSecond: 50 },
		});
		expect(mockDeviceStateEvent.create).toHaveBeenCalledWith({
			data: {
				deviceId: "device-1",
				eventType: "duration_calibrated",
				source: "user",
				actorId: "test-farm",
				metadata: { gramsPerSecond: 0.5 },
			},
		});
	});

	it("regression: rejects 51 g/s with the shared range message and writes nothing", async () => {
		const result = await saveDurationCalibration("device-1", 51);

		expect(result).toEqual({
			success: false,
			error: "Grams per second must be between 0.5 and 50",
		});
		expect(mockEnergyDevice.update).not.toHaveBeenCalled();
		expect(mockDeviceStateEvent.create).not.toHaveBeenCalled();
	});

	it("rejects a rate below 0.5 g/s", async () => {
		const result = await saveDurationCalibration("device-1", 0.4);

		expect(result).toEqual({
			success: false,
			error: expect.stringContaining("0.5 and 50"),
		});
		expect(mockEnergyDevice.update).not.toHaveBeenCalled();
	});
});
