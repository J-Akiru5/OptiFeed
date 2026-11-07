import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({
	default: {
		energyDevice: {
			findFirst: vi.fn(),
			findUnique: vi.fn(),
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
			findFirst: vi.fn(),
			findMany: vi.fn(),
		},
		calibrationRun: {
			count: vi.fn(),
			create: vi.fn(),
		},
		platformSetting: {
			findUnique: vi.fn(),
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

import { runCalibrationTest, runTargetCheck } from "@/lib/actions/calibration";
import { type DeviceHealthReport, healthEventMetadata } from "@/lib/device-health-model";
import prisma from "@/lib/prisma";

/**
 * M2 dangerous-action gate: a unit that cleared safe mode is still RECOVERING
 * until its health is verified, and dose testing must stay unavailable.
 *
 * These are the tests that fail on the M1 code: it refused only
 * `health.safeMode`, so a unit with safe mode off and an unverified recovery
 * queued a calibration dose instead.
 */

const SESSION_ID = "11111111-1111-4111-8111-111111111111";
// The action uses the real clock, so the fixtures are relative to it.
const NOW = new Date();
const minutesAgo = (minutes: number) => new Date(NOW.getTime() - minutes * 60_000);

function report(over: Partial<DeviceHealthReport> = {}): DeviceHealthReport {
	return {
		safeMode: false,
		faultsPresent: 0,
		faultsLatched: 0,
		lastFault: null,
		abnormalResets: 0,
		resetReasons: null,
		resetReason: null,
		uptimeS: null,
		...over,
	};
}

const mockEnergyDevice = vi.mocked(prisma.energyDevice);
const mockFeedRequest = vi.mocked(prisma.feedRequest);
const mockDeviceStateEvent = vi.mocked(prisma.deviceStateEvent);

function onlineDevice() {
	return {
		gramsPerFeeding: 150,
		gramsPerSecond: 4,
		lastSeenAt: NOW,
		hopperCapacityG: null,
		dailyCapG: null,
		pond: { isFallow: false },
	};
}

function deviceSnapshot(diag: unknown) {
	return {
		id: "device-1",
		lastSeenAt: NOW,
		rtcOk: true,
		wifiRssiDbm: -60,
		wifiRssiUpdatedAt: NOW,
		diag,
	};
}

/** A trip two hours ago, cleared, with a matching reset history. */
function clearedRows(over: Partial<DeviceHealthReport> = {}) {
	return [
		{
			metadata: healthEventMetadata(
				report({ abnormalResets: 3, resetReasons: "panic", resetReason: "panic", ...over }),
			),
			createdAt: minutesAgo(120),
		},
		{
			metadata: healthEventMetadata(
				report({ safeMode: true, abnormalResets: 3, resetReasons: "panic" }),
			),
			createdAt: minutesAgo(150),
		},
	];
}

beforeEach(() => {
	vi.clearAllMocks();
	mockEnergyDevice.findFirst.mockResolvedValue(onlineDevice() as never);
	mockEnergyDevice.findUnique.mockResolvedValue(
		deviceSnapshot({ uptime_s: 10_800, fw: "1.9.0" }) as never,
	);
	mockFeedRequest.updateMany.mockResolvedValue({ count: 0 } as never);
	mockFeedRequest.findFirst.mockResolvedValue(null);
	mockFeedRequest.aggregate.mockResolvedValue({ _sum: { grams: 0 } } as never);
	mockFeedRequest.create.mockResolvedValue({ id: "req-1" } as never);
	mockDeviceStateEvent.create.mockResolvedValue({} as never);
	mockDeviceStateEvent.findMany.mockResolvedValue(clearedRows() as never);
	mockDeviceStateEvent.findFirst.mockResolvedValue({
		eventType: "firmware_reported",
		metadata: { version: "1.9.0" },
		createdAt: minutesAgo(200),
	} as never);
	vi.mocked(prisma.platformSetting.findUnique).mockResolvedValue(null as never);
});

describe("runCalibrationTest and hardware recovery", () => {
	it("refuses a dose when safe mode is on", async () => {
		mockDeviceStateEvent.findMany.mockResolvedValue([
			{
				metadata: healthEventMetadata(
					report({ safeMode: true, faultsPresent: 16, faultsLatched: 16 }),
				),
				createdAt: minutesAgo(5),
			},
		] as never);

		const result = await runCalibrationTest("device-1", 10, SESSION_ID);

		expect(result.success).toBe(false);
		expect(result.error).toContain("Safe mode is on");
		expect(mockFeedRequest.create).not.toHaveBeenCalled();
	});

	it("refuses a dose when safe mode cleared but health is unverified", async () => {
		// Safe mode is off; the unit never reported a firmware version, so the
		// recovery cannot be verified. M1 would have queued the dose.
		mockEnergyDevice.findUnique.mockResolvedValue(deviceSnapshot({ uptime_s: 10_800 }) as never);
		mockDeviceStateEvent.findFirst.mockResolvedValue(null);

		const result = await runCalibrationTest("device-1", 10, SESSION_ID);

		expect(result.success).toBe(false);
		expect(result.error).toContain("cleared safe mode");
		expect(mockFeedRequest.create).not.toHaveBeenCalled();
	});

	it("refuses a dose after another abnormal reset since the trip", async () => {
		mockDeviceStateEvent.findMany.mockResolvedValue([
			{
				metadata: healthEventMetadata(
					report({ abnormalResets: 4, resetReasons: "panic", resetReason: "panic" }),
				),
				createdAt: minutesAgo(30),
			},
			{
				metadata: healthEventMetadata(
					report({ safeMode: true, abnormalResets: 3, resetReasons: "panic" }),
				),
				createdAt: minutesAgo(150),
			},
		] as never);

		const result = await runCalibrationTest("device-1", 10, SESSION_ID);

		expect(result.success).toBe(false);
		expect(result.error).toContain("cleared safe mode");
		expect(mockFeedRequest.create).not.toHaveBeenCalled();
	});

	it("queues the dose once the unit is verified healthy", async () => {
		const result = await runCalibrationTest("device-1", 10, SESSION_ID);

		expect(result).toMatchObject({ success: true, testGrams: 40 });
		expect(mockFeedRequest.create).toHaveBeenCalledTimes(1);
	});

	it("fails open when the recovery read itself fails (M1 precedent)", async () => {
		mockEnergyDevice.findUnique.mockRejectedValue(new Error("db down"));

		const result = await runCalibrationTest("device-1", 10, SESSION_ID);

		expect(result).toMatchObject({ success: true, testGrams: 40 });
		expect(mockFeedRequest.create).toHaveBeenCalledTimes(1);
	});
});

describe("runTargetCheck and hardware recovery", () => {
	it("refuses a target check when safe mode cleared but health is unverified", async () => {
		mockEnergyDevice.findUnique.mockResolvedValue(deviceSnapshot({ uptime_s: 10_800 }) as never);
		mockDeviceStateEvent.findFirst.mockResolvedValue(null);

		const result = await runTargetCheck("device-1", 150, SESSION_ID);

		expect(result.success).toBe(false);
		expect(result.error).toContain("cleared safe mode");
		expect(mockFeedRequest.create).not.toHaveBeenCalled();
	});
});
