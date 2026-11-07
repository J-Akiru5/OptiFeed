import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({
	default: {
		energyDevice: { findUnique: vi.fn() },
		deviceStateEvent: { findMany: vi.fn(), findFirst: vi.fn() },
		platformSetting: { findUnique: vi.fn() },
	},
}));

import { type DeviceHealthReport, healthEventMetadata } from "@/lib/device-health-model";
import {
	calibrationBlockError,
	getCalibrationGate,
	getDeviceRecovery,
	getDeviceRecoverySafe,
} from "@/lib/device-recovery";
import prisma from "@/lib/prisma";

/**
 * The database half of M2: it only gathers evidence that already exists. A
 * failed advisory read must degrade to "no evidence" instead of taking down a
 * page or a calibration action.
 */

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

function healthRow(createdAt: Date, over: Partial<DeviceHealthReport> = {}) {
	return { metadata: healthEventMetadata(report(over)), createdAt };
}

const DEVICE = {
	id: "device-1",
	lastSeenAt: minutesAgo(0.5),
	rtcOk: true,
	wifiRssiDbm: -60,
	wifiRssiUpdatedAt: NOW,
	diag: { uptime_s: 10_800, fw: "1.9.0" },
};

const CLEARED_ROWS = [
	healthRow(minutesAgo(120), {
		abnormalResets: 3,
		resetReasons: "panic",
		resetReason: "panic",
	}),
	healthRow(minutesAgo(150), { safeMode: true, abnormalResets: 3, resetReasons: "panic" }),
];

const mockEnergyDevice = vi.mocked(prisma.energyDevice);
const mockDeviceStateEvent = vi.mocked(prisma.deviceStateEvent);

beforeEach(() => {
	vi.clearAllMocks();
	mockEnergyDevice.findUnique.mockResolvedValue(DEVICE as never);
	mockDeviceStateEvent.findMany.mockResolvedValue(CLEARED_ROWS as never);
	mockDeviceStateEvent.findFirst.mockResolvedValue({
		eventType: "firmware_reported",
		metadata: { version: "1.9.0" },
		createdAt: minutesAgo(300),
	} as never);
	vi.mocked(prisma.platformSetting.findUnique).mockResolvedValue(null as never);
});

describe("getDeviceRecovery", () => {
	it("builds the plan from the device row and the health history", async () => {
		const plan = await getDeviceRecovery({ deviceId: "device-1", now: NOW });

		expect(plan.state).toBe("HEALTHY");
		expect(plan.diagnosis).toMatchObject({
			abnormalResets: 3,
			bootResetReason: "panic",
			primaryCause: "controller",
			powerRelated: false,
		});
		expect(plan.quiet.satisfied).toBe(true);
		expect(plan.verified).toBe(true);
		expect(plan.calibration).toEqual({ allowed: true, code: null });
	});

	it("reads only the newest bounded health rows", async () => {
		await getDeviceRecovery({ deviceId: "device-1", now: NOW });

		expect(mockDeviceStateEvent.findMany).toHaveBeenCalledWith(
			expect.objectContaining({ take: 6, orderBy: { createdAt: "desc" } }),
		);
	});

	it("throws only when the device row itself is missing", async () => {
		mockEnergyDevice.findUnique.mockResolvedValue(null as never);

		await expect(getDeviceRecovery({ deviceId: "missing" })).rejects.toThrow("Device not found");
	});

	it("degrades a failed health history read to no evidence", async () => {
		mockDeviceStateEvent.findMany.mockRejectedValue(new Error("db down"));

		const plan = await getDeviceRecovery({ deviceId: "device-1", now: NOW });

		expect(plan.state).toBeNull();
		expect(plan.readState).toBe("unsupported");
		expect(plan.calibration.allowed).toBe(true);
	});

	it("falls back to diag.fw when the version event read fails", async () => {
		mockDeviceStateEvent.findFirst.mockRejectedValue(new Error("db down"));

		const plan = await getDeviceRecovery({ deviceId: "device-1", now: NOW });

		expect(plan.checks.find((check) => check.id === "firmware")?.status).toBe("pass");
	});
});

describe("getDeviceRecoverySafe", () => {
	it("returns a cannot-verify plan instead of throwing", async () => {
		mockEnergyDevice.findUnique.mockRejectedValue(new Error("db down"));

		const plan = await getDeviceRecoverySafe({ deviceId: "device-1", now: NOW });

		expect(plan.state).toBeNull();
		expect(plan.readState).toBe("unavailable");
		expect(plan.safeToRecover).toBe(false);
		// M1 precedent: a failed read does not invent a dangerous state.
		expect(plan.calibration.allowed).toBe(true);
	});
});

describe("getCalibrationGate", () => {
	it("blocks the dose while safe mode is on", async () => {
		mockDeviceStateEvent.findMany.mockResolvedValue([
			healthRow(minutesAgo(5), {
				safeMode: true,
				faultsPresent: 16,
				faultsLatched: 16,
				abnormalResets: 3,
				resetReasons: "panic",
			}),
		] as never);

		await expect(getCalibrationGate("device-1", NOW)).resolves.toEqual({
			allowed: false,
			code: "safe_mode",
		});
	});

	it("blocks the dose while the unit is recovering", async () => {
		mockDeviceStateEvent.findMany.mockResolvedValue([
			healthRow(minutesAgo(5), { abnormalResets: 1, resetReasons: "panic" }),
			healthRow(minutesAgo(6), { safeMode: true, abnormalResets: 1, resetReasons: "panic" }),
		] as never);

		await expect(getCalibrationGate("device-1", NOW)).resolves.toEqual({
			allowed: false,
			code: "recovering",
		});
	});
});

describe("calibrationBlockError", () => {
	it("keeps M1's safe-mode wording", () => {
		expect(calibrationBlockError("safe_mode")).toContain("Safe mode is on");
	});

	it("explains the recovery lock without claiming a hardware fault", () => {
		expect(calibrationBlockError("recovering")).toContain("cleared safe mode");
		expect(calibrationBlockError("recovering")).not.toContain("hardware fault");
	});

	it("has a message for every block code", () => {
		for (const code of [
			"safe_mode",
			"recovering",
			"fault",
			"maintenance",
			"offline",
			null,
		] as const) {
			expect(calibrationBlockError(code).length).toBeGreaterThan(20);
		}
	});
});
