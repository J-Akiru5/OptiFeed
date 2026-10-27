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
		calibrationRun: {
			count: vi.fn(),
			create: vi.fn(),
		},
	},
}));

vi.mock("@/lib/auth/session", () => ({
	getCurrentPondOwnerId: vi.fn().mockResolvedValue("test-farm"),
	getCurrentUser: vi.fn().mockResolvedValue({ id: "user-1" }),
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
	runTargetCheck,
	saveCalibrationFromTest,
	saveRecalibrationInterval,
	submitTargetCheck,
} from "@/lib/actions/calibration";
import { saveDurationCalibration } from "@/lib/actions/energy";
import { requirePermission } from "@/lib/auth/permissions";
import { requireWriteAccess } from "@/lib/auth/session";
import { isValidCalibrationSessionId } from "@/lib/calibration/session";
import { CALIBRATION_TEST_GRAMS_MAX, OFFLINE_THRESHOLD_MS } from "@/lib/limits";
import prisma from "@/lib/prisma";
import { revalidatePath } from "next/cache";

const mockEnergyDevice = vi.mocked(prisma.energyDevice);
const mockFeedRequest = vi.mocked(prisma.feedRequest);
const mockDeviceStateEvent = vi.mocked(prisma.deviceStateEvent);
const mockCalibrationRun = vi.mocked(prisma.calibrationRun);
const mockRequireWriteAccess = vi.mocked(requireWriteAccess);
const mockRequirePermission = vi.mocked(requirePermission);
const mockRevalidatePath = vi.mocked(revalidatePath);

const SESSION_ID = "11111111-1111-4111-8111-111111111111";

function onlineDevice(overrides: Record<string, unknown> = {}) {
	return {
		gramsPerFeeding: 150,
		gramsPerSecond: 4,
		lastSeenAt: new Date(),
		hopperCapacityG: null,
		recalibrationIntervalDays: 30,
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
	mockCalibrationRun.count.mockResolvedValue(0 as never);
	mockCalibrationRun.create.mockResolvedValue({} as never);
});

describe("runCalibrationTest", () => {
	it("queues a pending test dose and records the queued event", async () => {
		const result = await runCalibrationTest("device-1", 10, SESSION_ID);

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
		const result = await runCalibrationTest("device-1", seconds, SESSION_ID);

		expect(result).toEqual({
			success: false,
			error: expect.stringContaining("between 3 and 30"),
		});
		expect(mockEnergyDevice.findFirst).not.toHaveBeenCalled();
		expect(mockFeedRequest.create).not.toHaveBeenCalled();
	});

	it("returns an error when the device is not found", async () => {
		mockEnergyDevice.findFirst.mockResolvedValue(null);

		const result = await runCalibrationTest("device-1", 10, SESSION_ID);

		expect(result).toEqual({ success: false, error: "Device not found" });
		expect(mockFeedRequest.create).not.toHaveBeenCalled();
	});

	it("rejects a fallow pond", async () => {
		mockEnergyDevice.findFirst.mockResolvedValue(
			onlineDevice({ pond: { isFallow: true } }) as never,
		);

		const result = await runCalibrationTest("device-1", 10, SESSION_ID);

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

		const result = await runCalibrationTest("device-1", 10, SESSION_ID);

		expect(result).toEqual({
			success: false,
			error: expect.stringContaining("offline"),
		});
		expect(mockFeedRequest.create).not.toHaveBeenCalled();
	});

	it("rejects while another feed request is pending", async () => {
		mockFeedRequest.findFirst.mockResolvedValue({ status: "pending" } as never);

		const result = await runCalibrationTest("device-1", 10, SESSION_ID);

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

		const result = await runCalibrationTest("device-1", 30, SESSION_ID);

		expect(result).toEqual({
			success: false,
			error: expect.stringContaining(String(CALIBRATION_TEST_GRAMS_MAX)),
		});
		expect(mockFeedRequest.aggregate).not.toHaveBeenCalled();
		expect(mockFeedRequest.create).not.toHaveBeenCalled();
	});

	it("rejects a test dose under 1 g and names the range", async () => {
		mockEnergyDevice.findFirst.mockResolvedValue(onlineDevice({ gramsPerSecond: 0.2 }) as never);

		const result = await runCalibrationTest("device-1", 3, SESSION_ID);

		expect(result).toEqual({
			success: false,
			error: expect.stringContaining(`1–${CALIBRATION_TEST_GRAMS_MAX}`),
		});
		expect(mockFeedRequest.create).not.toHaveBeenCalled();
	});

	it("enforces the daily feed cap the same way requestFeed does", async () => {
		mockEnergyDevice.findFirst.mockResolvedValue(onlineDevice({ hopperCapacityG: 2000 }) as never);
		mockFeedRequest.aggregate.mockResolvedValue({ _sum: { grams: 1990 } } as never);

		const result = await runCalibrationTest("device-1", 10, SESSION_ID);

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

		await expect(runCalibrationTest("device-1", 10, SESSION_ID)).rejects.toThrow(
			/Write access required/,
		);

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

		const result = await saveCalibrationFromTest("device-1", "req-1", 10, 50, SESSION_ID);

		expect(result).toEqual({
			success: true,
			previousGramsPerSecond: 4,
			newGramsPerSecond: 5,
			gramsPerFeeding: 150,
			previousDurationSeconds: 37.5,
			newDurationSeconds: 30,
			attempt: 1,
			reTests: 0,
		});
		expect(mockEnergyDevice.update).toHaveBeenCalledWith({
			where: { id: "device-1" },
			data: { gramsPerSecond: 5, lastCalibratedAt: expect.any(Date) },
		});
		expect(mockCalibrationRun.create).toHaveBeenCalledWith({
			data: {
				deviceId: "device-1",
				sessionId: SESSION_ID,
				attempt: 1,
				kind: "RATE_TEST",
				durationMs: 10_000,
				measuredGrams: 50,
				gramsPerSecondBefore: 4,
				gramsPerSecondAfter: 5,
				errorPct: 25,
				accepted: true,
				createdById: "user-1",
			},
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

		const result = await saveCalibrationFromTest("device-1", "req-1", 10, 46.5, SESSION_ID);

		expect(result.success).toBe(true);
		expect(result.newGramsPerSecond).toBe(4.65);
		expect(result.previousGramsPerSecond).toBe(4.1);
		expect(result.previousDurationSeconds).toBe(24.4);
		expect(result.newDurationSeconds).toBe(21.5);
	});

	it("refuses to save before the test dose is confirmed", async () => {
		mockFeedRequest.findFirst.mockResolvedValue({ status: "pending" } as never);

		const result = await saveCalibrationFromTest("device-1", "req-1", 10, 50, SESSION_ID);

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

		const result = await saveCalibrationFromTest("device-1", "req-other-farm", 10, 50, SESSION_ID);

		expect(result).toEqual({ success: false, error: "Test dose not found" });
		expect(mockEnergyDevice.update).not.toHaveBeenCalled();
	});

	it("rejects a measured rate below the supported range and reports it", async () => {
		const result = await saveCalibrationFromTest("device-1", "req-1", 10, 2, SESSION_ID);

		expect(result).toEqual({
			success: false,
			error: expect.stringContaining("Measured rate 0.2 g/s"),
		});
		expect(result.error).toContain("0.5–50");
		expect(mockEnergyDevice.update).not.toHaveBeenCalled();
	});

	it("rejects a measured rate above the supported range and reports it", async () => {
		const result = await saveCalibrationFromTest("device-1", "req-1", 10, 600, SESSION_ID);

		expect(result).toEqual({
			success: false,
			error: expect.stringContaining("Measured rate 60 g/s"),
		});
		expect(mockEnergyDevice.update).not.toHaveBeenCalled();
	});

	it("rejects a non-positive or non-finite weighed output", async () => {
		for (const grams of [0, Number.NaN, Number.POSITIVE_INFINITY, -5]) {
			const result = await saveCalibrationFromTest("device-1", "req-1", 10, grams, SESSION_ID);
			expect(result.success).toBe(false);
			expect(result.error).toContain("2000");
		}
		expect(mockEnergyDevice.update).not.toHaveBeenCalled();
	});

	it("rejects a weighed output above the 2000 g ceiling", async () => {
		const result = await saveCalibrationFromTest("device-1", "req-1", 10, 2001, SESSION_ID);

		expect(result).toEqual({
			success: false,
			error: expect.stringContaining("2000"),
		});
		expect(mockEnergyDevice.update).not.toHaveBeenCalled();
	});

	it("rejects an invalid test duration", async () => {
		const result = await saveCalibrationFromTest("device-1", "req-1", 31, 50, SESSION_ID);

		expect(result).toEqual({
			success: false,
			error: expect.stringContaining("between 3 and 30"),
		});
		expect(mockFeedRequest.findFirst).not.toHaveBeenCalled();
		expect(mockEnergyDevice.update).not.toHaveBeenCalled();
	});

	it("throws without writing when the manage_schedule permission is denied", async () => {
		mockRequirePermission.mockRejectedValue(new Error("Forbidden"));

		await expect(saveCalibrationFromTest("device-1", "req-1", 10, 50, SESSION_ID)).rejects.toThrow(
			"Forbidden",
		);

		expect(mockRequirePermission).toHaveBeenCalledWith("manage_schedule");
		expect(mockEnergyDevice.update).not.toHaveBeenCalled();
	});

	it("continues the attempt count and re-test count within the session", async () => {
		mockCalibrationRun.count.mockResolvedValue(2 as never);

		const result = await saveCalibrationFromTest("device-1", "req-1", 10, 50, SESSION_ID);

		expect(result.attempt).toBe(3);
		expect(result.reTests).toBe(2);
		expect(mockCalibrationRun.count).toHaveBeenCalledWith({
			where: { deviceId: "device-1", sessionId: SESSION_ID, kind: "RATE_TEST" },
		});
	});

	it("rejects an invalid session id before touching the device", async () => {
		const result = await saveCalibrationFromTest("device-1", "req-1", 10, 50, "bad id");

		expect(result.success).toBe(false);
		expect(result.error).toContain("session id");
		expect(mockEnergyDevice.findFirst).not.toHaveBeenCalled();
		expect(mockCalibrationRun.create).not.toHaveBeenCalled();
	});
});

describe("isValidCalibrationSessionId", () => {
	it("accepts UUID and cuid-shaped ids", () => {
		expect(isValidCalibrationSessionId(SESSION_ID)).toBe(true);
		expect(isValidCalibrationSessionId("clx0abcde0000abcdefghijkl")).toBe(true);
	});

	it("rejects empty, short, spaced and injected values", () => {
		for (const value of [
			"",
			"short",
			"abcdefghijklmnop",
			"has spaces in it here",
			"x'.drop;table",
			42,
			null,
		]) {
			expect(isValidCalibrationSessionId(value)).toBe(false);
		}
	});
});

describe("runTargetCheck", () => {
	it("queues the target dose through the normal FeedRequest path", async () => {
		const result = await runTargetCheck("device-1", 100, SESSION_ID);

		expect(result).toEqual({
			success: true,
			requestId: "req-1",
			targetGrams: 100,
			expectedSeconds: 25,
			durationMs: 25_000,
		});
		expect(mockFeedRequest.create).toHaveBeenCalledWith({
			data: { deviceId: "device-1", grams: 100, status: "pending" },
		});
		expect(mockDeviceStateEvent.create).toHaveBeenCalledWith({
			data: {
				deviceId: "device-1",
				eventType: "calibration_target_check_queued",
				source: "user",
				actorId: "test-farm",
				metadata: {
					requestId: "req-1",
					targetGrams: 100,
					gramsPerSecond: 4,
					durationMs: 25_000,
					method: "target_check",
				},
			},
		});
	});

	it.each([4, 501, Number.NaN])("rejects an out-of-range target (%s g)", async (grams) => {
		const result = await runTargetCheck("device-1", grams, SESSION_ID);

		expect(result.success).toBe(false);
		expect(result.error).toContain("between 5 and 500");
		expect(mockFeedRequest.create).not.toHaveBeenCalled();
	});

	it("rejects a target whose relay time exceeds MAX_DISPENSE_MS", async () => {
		mockEnergyDevice.findFirst.mockResolvedValue(onlineDevice({ gramsPerSecond: 1 }) as never);

		const result = await runTargetCheck("device-1", 500, SESSION_ID);

		expect(result).toEqual({
			success: false,
			error: expect.stringContaining("more than 300 s"),
		});
		expect(mockFeedRequest.create).not.toHaveBeenCalled();
	});

	it("enforces the daily cap like the test dose", async () => {
		mockEnergyDevice.findFirst.mockResolvedValue(onlineDevice({ hopperCapacityG: 2000 }) as never);
		mockFeedRequest.aggregate.mockResolvedValue({ _sum: { grams: 1950 } } as never);

		const result = await runTargetCheck("device-1", 100, SESSION_ID);

		expect(result).toEqual({
			success: false,
			error: expect.stringContaining("Daily feed limit"),
		});
		expect(mockFeedRequest.create).not.toHaveBeenCalled();
	});

	it("rejects an offline device and a fallow pond", async () => {
		mockEnergyDevice.findFirst.mockResolvedValueOnce(
			onlineDevice({ lastSeenAt: new Date(Date.now() - OFFLINE_THRESHOLD_MS - 1000) }) as never,
		);
		const offline = await runTargetCheck("device-1", 100, SESSION_ID);
		expect(offline.error).toContain("offline");

		mockEnergyDevice.findFirst.mockResolvedValueOnce(
			onlineDevice({ pond: { isFallow: true } }) as never,
		);
		const fallow = await runTargetCheck("device-1", 100, SESSION_ID);
		expect(fallow.error).toContain("fallow");
		expect(mockFeedRequest.create).not.toHaveBeenCalled();
	});

	it("allows the call when the actor holds control_feeder", async () => {
		const result = await runTargetCheck("device-1", 100, SESSION_ID);

		expect(result.success).toBe(true);
		expect(mockRequirePermission).toHaveBeenCalledWith("control_feeder");
	});

	it("denies the call when control_feeder is revoked", async () => {
		mockRequirePermission.mockImplementation(async (permission) => {
			if (permission === "control_feeder") throw new Error("Forbidden");
		});

		await expect(runTargetCheck("device-1", 100, SESSION_ID)).rejects.toThrow("Forbidden");

		expect(mockRequirePermission).toHaveBeenCalledWith("control_feeder");
		expect(mockFeedRequest.create).not.toHaveBeenCalled();
	});

	it("denies the call when write access is denied", async () => {
		mockRequireWriteAccess.mockRejectedValue(new Error("Write access required"));

		await expect(runTargetCheck("device-1", 100, SESSION_ID)).rejects.toThrow(
			/Write access required/,
		);
		expect(mockFeedRequest.create).not.toHaveBeenCalled();
	});
});

describe("submitTargetCheck", () => {
	beforeEach(() => {
		mockFeedRequest.findFirst.mockResolvedValue({ status: "completed" } as never);
		mockEnergyDevice.findFirst.mockResolvedValue(
			onlineDevice({ gramsPerFeeding: 150, gramsPerSecond: 4 }) as never,
		);
	});

	it("accepts a result within ±5% and saves the corrected rate", async () => {
		// 102 g against a 100 g target = +2%.
		const result = await submitTargetCheck("device-1", "req-1", 100, 102, SESSION_ID, "save");

		expect(result.success).toBe(true);
		expect(result.accepted).toBe(true);
		expect(result.saved).toBe(true);
		expect(result.errorPct).toBe(2);
		expect(result.correctedGramsPerSecond).toBe(4.08);
		expect(result.attempt).toBe(1);
		expect(result.reTests).toBe(0);
		expect(mockEnergyDevice.update).toHaveBeenCalledWith({
			where: { id: "device-1" },
			data: { gramsPerSecond: 4.08, lastCalibratedAt: expect.any(Date) },
		});
		expect(mockCalibrationRun.create).toHaveBeenCalledWith({
			data: {
				deviceId: "device-1",
				sessionId: SESSION_ID,
				attempt: 1,
				kind: "TARGET_CHECK",
				durationMs: 25_000,
				targetGrams: 100,
				measuredGrams: 102,
				gramsPerSecondBefore: 4,
				gramsPerSecondAfter: 4.08,
				errorPct: 2,
				accepted: true,
				createdById: "user-1",
			},
		});
	});

	it("marks a >5% result as failed and applies the correction without saving", async () => {
		// 110 g against 100 g = +10%; corrected rate = 4.4 g/s.
		const result = await submitTargetCheck("device-1", "req-1", 100, 110, SESSION_ID, "retest");

		expect(result.success).toBe(true);
		expect(result.accepted).toBe(false);
		expect(result.saved).toBe(false);
		expect(result.errorPct).toBe(10);
		expect(mockEnergyDevice.update).toHaveBeenCalledWith({
			where: { id: "device-1" },
			data: { gramsPerSecond: 4.4 },
		});
		expect(mockCalibrationRun.create).toHaveBeenCalledWith({
			data: expect.objectContaining({ accepted: false, errorPct: 10 }),
		});
	});

	it("saves anyway when the operator chooses that path", async () => {
		const result = await submitTargetCheck(
			"device-1",
			"req-1",
			100,
			110,
			SESSION_ID,
			"save_anyway",
		);

		expect(result.saved).toBe(true);
		expect(result.accepted).toBe(false);
		expect(mockEnergyDevice.update).toHaveBeenCalledWith({
			where: { id: "device-1" },
			data: { gramsPerSecond: 4.4, lastCalibratedAt: expect.any(Date) },
		});
	});

	it("computes the attempt count on the server from prior session runs", async () => {
		mockCalibrationRun.count.mockResolvedValue(3 as never);

		const result = await submitTargetCheck("device-1", "req-1", 100, 100, SESSION_ID, "save");

		expect(result.attempt).toBe(4);
		expect(result.reTests).toBe(3);
		expect(mockCalibrationRun.count).toHaveBeenCalledWith({
			where: { deviceId: "device-1", sessionId: SESSION_ID, kind: "TARGET_CHECK" },
		});
	});

	it("refuses an unconfirmed target check", async () => {
		mockFeedRequest.findFirst.mockResolvedValue({ status: "pending" } as never);

		const result = await submitTargetCheck("device-1", "req-1", 100, 100, SESSION_ID, "save");

		expect(result.success).toBe(false);
		expect(result.error).toContain("not confirmed yet");
		expect(mockEnergyDevice.update).not.toHaveBeenCalled();
		expect(mockCalibrationRun.create).not.toHaveBeenCalled();
	});

	it("refuses a request from another farm", async () => {
		mockFeedRequest.findFirst.mockResolvedValue(null as never);

		const result = await submitTargetCheck(
			"device-1",
			"req-other-farm",
			100,
			100,
			SESSION_ID,
			"save",
		);

		expect(result).toEqual({ success: false, error: "Target check not found" });
		expect(mockEnergyDevice.update).not.toHaveBeenCalled();
	});

	it("rejects an unknown decision", async () => {
		const result = await submitTargetCheck(
			"device-1",
			"req-1",
			100,
			100,
			SESSION_ID,
			"ship_it" as never,
		);

		expect(result.success).toBe(false);
		expect(result.error).toContain("decision");
	});

	it("rejects a corrected rate outside the supported range", async () => {
		const result = await submitTargetCheck("device-1", "req-1", 100, 2000, SESSION_ID, "save");

		expect(result.success).toBe(false);
		expect(result.error).toContain("outside the supported");
		expect(mockEnergyDevice.update).not.toHaveBeenCalled();
	});

	it("denies the call when control_feeder is revoked", async () => {
		mockRequirePermission.mockImplementation(async (permission) => {
			if (permission === "control_feeder") throw new Error("Forbidden");
		});

		await expect(
			submitTargetCheck("device-1", "req-1", 100, 100, SESSION_ID, "save"),
		).rejects.toThrow("Forbidden");

		expect(mockRequirePermission).toHaveBeenCalledWith("control_feeder");
		expect(mockEnergyDevice.update).not.toHaveBeenCalled();
	});
});

describe("saveRecalibrationInterval", () => {
	it("saves a valid interval and records the change", async () => {
		mockEnergyDevice.findFirst.mockResolvedValue(
			onlineDevice({ recalibrationIntervalDays: 30 }) as never,
		);

		const result = await saveRecalibrationInterval("device-1", 14);

		expect(result).toEqual({ success: true });
		expect(mockEnergyDevice.update).toHaveBeenCalledWith({
			where: { id: "device-1" },
			data: { recalibrationIntervalDays: 14 },
		});
		expect(mockDeviceStateEvent.create).toHaveBeenCalledWith({
			data: {
				deviceId: "device-1",
				eventType: "recalibration_interval_changed",
				source: "user",
				actorId: "test-farm",
				metadata: { previousIntervalDays: 30, recalibrationIntervalDays: 14 },
			},
		});
	});

	it.each([6, 181, 10.5, Number.NaN])("rejects an invalid interval (%s)", async (days) => {
		const result = await saveRecalibrationInterval("device-1", days);

		expect(result.success).toBe(false);
		expect(result.error).toContain("between 7 and 180");
		expect(mockEnergyDevice.update).not.toHaveBeenCalled();
	});

	it("rejects a device from another farm", async () => {
		mockEnergyDevice.findFirst.mockResolvedValue(null as never);

		const result = await saveRecalibrationInterval("device-1", 14);

		expect(result).toEqual({ success: false, error: "Device not found" });
	});

	it("throws without writing when manage_schedule is denied", async () => {
		mockRequirePermission.mockRejectedValue(new Error("Forbidden"));

		await expect(saveRecalibrationInterval("device-1", 14)).rejects.toThrow("Forbidden");

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
