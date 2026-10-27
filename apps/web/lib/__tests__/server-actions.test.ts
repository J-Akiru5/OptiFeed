import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({
	default: {
		energyDevice: {
			findFirst: vi.fn(),
			findMany: vi.fn(),
			update: vi.fn(),
			create: vi.fn(),
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
		scheduleCommand: {
			create: vi.fn(),
			findMany: vi.fn(),
			update: vi.fn(),
		},
		biomassLog: {
			create: vi.fn(),
		},
		fishSample: {
			createMany: vi.fn(),
		},
		pond: {
			findUnique: vi.fn(),
			findFirst: vi.fn(),
			update: vi.fn(),
		},
		farm: {
			findUnique: vi.fn(),
			update: vi.fn(),
		},
		$transaction: vi.fn((fns: (() => Promise<unknown>)[]) =>
			fns.reduce<Promise<unknown>>((prev, fn) => prev.then(() => fn()), Promise.resolve()),
		),
	},
}));

vi.mock("@/lib/auth/session", () => ({
	getCurrentPondOwnerId: vi.fn().mockResolvedValue("test-farm"),
	getCurrentPondOwnerIdSafe: vi.fn().mockResolvedValue("test-farm"),
	getCurrentUser: vi.fn().mockResolvedValue({ farmId: "test-farm", role: "ADMIN" }),
	getCurrentUserRole: vi.fn().mockResolvedValue("ADMIN"),
	requireWriteAccess: vi.fn().mockResolvedValue(undefined),
}));

// Permission resolution is DB-backed; these action tests exercise the action's
// own logic, so the gate is stubbed open. Denial itself is covered by
// permissions.test.ts and the "permission enforcement" block below.
vi.mock("@/lib/auth/permissions", () => ({
	requirePermission: vi.fn().mockResolvedValue(undefined),
	hasPermission: vi.fn().mockResolvedValue(true),
}));

vi.mock("next/cache", () => ({
	revalidatePath: vi.fn(),
}));

vi.mock("next-intl/server", () => ({
	getLocale: vi.fn().mockResolvedValue("en"),
}));

import { requirePermission } from "@/lib/auth/permissions";
import { requireWriteAccess } from "@/lib/auth/session";
import { OFFLINE_THRESHOLD_MS } from "@/lib/limits";
import prisma from "@/lib/prisma";
import { revalidatePath } from "next/cache";

const mockEnergyDevice = vi.mocked(prisma.energyDevice);
const mockFeedRequest = vi.mocked(prisma.feedRequest);
const mockDeviceStateEvent = vi.mocked(prisma.deviceStateEvent);
const mockScheduleCommand = vi.mocked(prisma.scheduleCommand);
const mockPond = vi.mocked(prisma.pond);
const mockFarm = vi.mocked(prisma.farm);
const mockRequireWriteAccess = vi.mocked(requireWriteAccess);
const mockRequirePermission = vi.mocked(requirePermission);

// biome-ignore lint/suspicious/noExplicitAny: test fixture
function onlineDevice(overrides: Record<string, unknown> = {}): any {
	return {
		gramsPerFeeding: 150,
		gramsPerSecond: 4,
		lastSeenAt: new Date(),
		hopperCapacityG: null,
		...overrides,
	};
}

describe("requestFeed", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockFeedRequest.aggregate.mockResolvedValue({ _sum: { grams: 0 } } as never);
	});

	it("returns error when device not found", async () => {
		mockEnergyDevice.findFirst.mockResolvedValue(null);
		const { requestFeed } = await import("@/lib/actions/energy");
		const result = await requestFeed("device-1");
		expect(result).toEqual({ success: false, error: "Device not found" });
	});

	it("creates a feed request with default grams", async () => {
		mockEnergyDevice.findFirst.mockResolvedValue(onlineDevice());
		// biome-ignore lint/suspicious/noExplicitAny: test mock
		mockFeedRequest.updateMany.mockResolvedValue({ count: 0 } as any);
		mockFeedRequest.findFirst.mockResolvedValue(null);
		// biome-ignore lint/suspicious/noExplicitAny: test mock
		mockFeedRequest.create.mockResolvedValue({ id: "req-1" } as any);
		// biome-ignore lint/suspicious/noExplicitAny: test mock
		mockDeviceStateEvent.create.mockResolvedValue({} as any);

		const { requestFeed } = await import("@/lib/actions/energy");
		const result = await requestFeed("device-1");

		expect(result).toEqual({ success: true });
		expect(mockFeedRequest.create).toHaveBeenCalledWith({
			data: {
				deviceId: "device-1",
				grams: 150,
				status: "pending",
			},
		});
	});

	it("returns message when feed already pending", async () => {
		mockEnergyDevice.findFirst.mockResolvedValue(onlineDevice());
		// biome-ignore lint/suspicious/noExplicitAny: test mock
		mockFeedRequest.updateMany.mockResolvedValue({ count: 0 } as any);
		// biome-ignore lint/suspicious/noExplicitAny: test mock
		mockFeedRequest.findFirst.mockResolvedValue({ id: "existing-req" } as any);

		const { requestFeed } = await import("@/lib/actions/energy");
		const result = await requestFeed("device-1");

		expect(result).toEqual({ success: true, message: "Feed already pending" });
		expect(mockFeedRequest.create).not.toHaveBeenCalled();
	});

	it("uses custom grams when provided", async () => {
		mockEnergyDevice.findFirst.mockResolvedValue(onlineDevice());
		// biome-ignore lint/suspicious/noExplicitAny: test mock
		mockFeedRequest.updateMany.mockResolvedValue({ count: 0 } as any);
		mockFeedRequest.findFirst.mockResolvedValue(null);
		// biome-ignore lint/suspicious/noExplicitAny: test mock
		mockFeedRequest.create.mockResolvedValue({ id: "req-1" } as any);
		// biome-ignore lint/suspicious/noExplicitAny: test mock
		mockDeviceStateEvent.create.mockResolvedValue({} as any);

		const { requestFeed } = await import("@/lib/actions/energy");
		const result = await requestFeed("device-1", 200);

		expect(result).toEqual({ success: true });
		expect(mockFeedRequest.create).toHaveBeenCalledWith({
			data: {
				deviceId: "device-1",
				grams: 200,
				status: "pending",
			},
		});
	});

	it("rejects when lastSeenAt is older than OFFLINE_THRESHOLD_MS (N10)", async () => {
		mockEnergyDevice.findFirst.mockResolvedValue(
			onlineDevice({ lastSeenAt: new Date(Date.now() - OFFLINE_THRESHOLD_MS - 1000) }),
		);
		// biome-ignore lint/suspicious/noExplicitAny: test mock
		mockFeedRequest.updateMany.mockResolvedValue({ count: 0 } as any);

		const { requestFeed } = await import("@/lib/actions/energy");
		const result = await requestFeed("device-1");

		expect(result).toEqual({
			success: false,
			error: expect.stringContaining("offline"),
		});
		expect(mockFeedRequest.create).not.toHaveBeenCalled();
	});

	it("rejects when the device has never checked in", async () => {
		mockEnergyDevice.findFirst.mockResolvedValue(onlineDevice({ lastSeenAt: null }));
		// biome-ignore lint/suspicious/noExplicitAny: test mock
		mockFeedRequest.updateMany.mockResolvedValue({ count: 0 } as any);

		const { requestFeed } = await import("@/lib/actions/energy");
		const result = await requestFeed("device-1");

		expect(result).toEqual({
			success: false,
			error: expect.stringContaining("offline"),
		});
		expect(mockFeedRequest.create).not.toHaveBeenCalled();
	});

	it("rejects grams above the per-request cap", async () => {
		mockEnergyDevice.findFirst.mockResolvedValue(onlineDevice());
		// biome-ignore lint/suspicious/noExplicitAny: test mock
		mockFeedRequest.updateMany.mockResolvedValue({ count: 0 } as any);

		const { requestFeed } = await import("@/lib/actions/energy");
		const result = await requestFeed("device-1", 1001);

		expect(result).toEqual({
			success: false,
			error: expect.stringContaining("1000"),
		});
		expect(mockFeedRequest.create).not.toHaveBeenCalled();
	});

	it("rejects a dose whose run time exceeds MAX_DISPENSE_MS", async () => {
		mockEnergyDevice.findFirst.mockResolvedValue(onlineDevice({ gramsPerSecond: 0.5 }));
		// biome-ignore lint/suspicious/noExplicitAny: test mock
		mockFeedRequest.updateMany.mockResolvedValue({ count: 0 } as any);

		const { requestFeed } = await import("@/lib/actions/energy");
		const result = await requestFeed("device-1", 1000);

		expect(result).toEqual({
			success: false,
			error: expect.stringContaining("relay time"),
		});
		expect(mockFeedRequest.create).not.toHaveBeenCalled();
	});

	it("rejects when a feed is already dispatched (N2)", async () => {
		mockEnergyDevice.findFirst.mockResolvedValue(onlineDevice());
		// biome-ignore lint/suspicious/noExplicitAny: test mock
		mockFeedRequest.updateMany.mockResolvedValue({ count: 0 } as any);
		mockFeedRequest.findFirst
			.mockResolvedValueOnce(null)
			// biome-ignore lint/suspicious/noExplicitAny: test mock
			.mockResolvedValueOnce({ id: "dispatched-req" } as any);

		const { requestFeed } = await import("@/lib/actions/energy");
		const result = await requestFeed("device-1");

		expect(result).toEqual({
			success: false,
			error: expect.stringContaining("already in progress"),
		});
		expect(mockFeedRequest.create).not.toHaveBeenCalled();
	});

	it("rejects when the daily gram cap would be exceeded", async () => {
		mockEnergyDevice.findFirst.mockResolvedValue(onlineDevice());
		// biome-ignore lint/suspicious/noExplicitAny: test mock
		mockFeedRequest.updateMany.mockResolvedValue({ count: 0 } as any);
		mockFeedRequest.findFirst.mockResolvedValue(null);
		mockFeedRequest.aggregate.mockResolvedValue({ _sum: { grams: 4950 } } as never);

		const { requestFeed } = await import("@/lib/actions/energy");
		const result = await requestFeed("device-1", 150);

		expect(result).toEqual({
			success: false,
			error: expect.stringContaining("Daily feed limit"),
		});
		expect(mockFeedRequest.create).not.toHaveBeenCalled();
	});
});

describe("updateScheduleCommand", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("returns error when device not found", async () => {
		mockEnergyDevice.findFirst.mockResolvedValue(null);
		const { updateScheduleCommand } = await import("@/lib/actions/schedule");
		const result = await updateScheduleCommand("pond-1", "device-1", {
			scheduleStart: "06:00",
			scheduleEnd: "18:00",
			feedsPerDay: 3,
			feedingRatePct: 3.0,
		});
		expect(result).toEqual({ success: false, error: "Device not found or access denied" });
	});

	it("creates a schedule command successfully", async () => {
		mockEnergyDevice.findFirst.mockResolvedValue(
			onlineDevice({ id: "device-1", hopperCapacityG: null }),
		);
		mockScheduleCommand.findMany.mockResolvedValue([]);
		// biome-ignore lint/suspicious/noExplicitAny: test mock
		mockScheduleCommand.create.mockResolvedValue({ id: "cmd-1" } as any);
		// biome-ignore lint/suspicious/noExplicitAny: test mock
		mockDeviceStateEvent.create.mockResolvedValue({} as any);

		const { updateScheduleCommand } = await import("@/lib/actions/schedule");
		const result = await updateScheduleCommand("pond-1", "device-1", {
			scheduleStart: "06:00",
			scheduleEnd: "18:00",
			feedsPerDay: 3,
			feedingRatePct: 3.0,
		});

		expect(result.success).toBe(true);
		expect(result.commandId).toBe("cmd-1");
		expect(mockScheduleCommand.create).toHaveBeenCalled();
	});

	it("expires stale sent commands before creating new one", async () => {
		mockEnergyDevice.findFirst.mockResolvedValue(
			onlineDevice({ id: "device-1", hopperCapacityG: null }),
		);
		mockScheduleCommand.findMany.mockResolvedValue([
			{ id: "stale-cmd-1", scheduleStart: new Date(), scheduleEnd: new Date() },
		] as never[]);
		// biome-ignore lint/suspicious/noExplicitAny: test mock
		mockScheduleCommand.update.mockResolvedValue({} as any);
		// biome-ignore lint/suspicious/noExplicitAny: test mock
		mockScheduleCommand.create.mockResolvedValue({ id: "cmd-2" } as any);
		// biome-ignore lint/suspicious/noExplicitAny: test mock
		mockDeviceStateEvent.create.mockResolvedValue({} as any);

		const { updateScheduleCommand } = await import("@/lib/actions/schedule");
		const result = await updateScheduleCommand("pond-1", "device-1", {
			scheduleStart: "07:00",
			scheduleEnd: "19:00",
			feedsPerDay: 2,
			feedingRatePct: 4.0,
		});

		expect(result.success).toBe(true);
		expect(mockScheduleCommand.update).toHaveBeenCalledWith({
			where: { id: "stale-cmd-1" },
			data: { status: "failed" },
		});
	});

	it("rejects feedsPerDay outside 1-24 without writing", async () => {
		const { updateScheduleCommand } = await import("@/lib/actions/schedule");
		const result = await updateScheduleCommand("pond-1", "device-1", {
			scheduleStart: "06:00",
			scheduleEnd: "18:00",
			feedsPerDay: 25,
			feedingRatePct: 3.0,
		});

		expect(result).toEqual({
			success: false,
			error: expect.stringContaining("Feeds per day"),
		});
		expect(mockScheduleCommand.create).not.toHaveBeenCalled();
	});

	it("rejects a schedule over the daily gram cap without writing", async () => {
		mockEnergyDevice.findFirst.mockResolvedValue(
			onlineDevice({ id: "device-1", gramsPerFeeding: 300 }),
		);
		mockScheduleCommand.findMany.mockResolvedValue([]);

		const { updateScheduleCommand } = await import("@/lib/actions/schedule");
		const result = await updateScheduleCommand("pond-1", "device-1", {
			scheduleStart: "06:00",
			scheduleEnd: "18:00",
			feedsPerDay: 24,
			feedingRatePct: 5.0,
		});

		expect(result).toEqual({
			success: false,
			error: expect.stringContaining("g/day limit"),
		});
		expect(mockScheduleCommand.create).not.toHaveBeenCalled();
		expect(mockDeviceStateEvent.create).not.toHaveBeenCalled();
	});
});

describe("updatePondSettings validation", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("rejects a feeding rate below the minimum without writing", async () => {
		const { updatePondSettings } = await import("@/lib/actions/settings");
		const result = await updatePondSettings("pond-1", 0, 2);

		expect(result).toEqual({
			success: false,
			error: expect.stringContaining("Feeding rate"),
		});
		expect(mockPond.update).not.toHaveBeenCalled();
	});

	it("rejects population of 0 without writing", async () => {
		const { updatePondSettings } = await import("@/lib/actions/settings");
		const result = await updatePondSettings("pond-1", 4, 2, 14, 0);

		expect(result).toEqual({
			success: false,
			error: expect.stringContaining("Population"),
		});
		expect(mockPond.update).not.toHaveBeenCalled();
	});
});

describe("updateNotificationPrefs validation", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("rejects a non-boolean preference without writing", async () => {
		const { updateNotificationPrefs } = await import("@/lib/actions/settings");
		const result = await updateNotificationPrefs("pond-1", {
			missedFeeding: "yes",
			deviceOffline: true,
			hopperLow: false,
		} as never);

		expect(result).toEqual({
			success: false,
			error: expect.stringContaining("missedFeeding"),
		});
		expect(mockPond.update).not.toHaveBeenCalled();
	});
});

describe("write access enforcement — VIEWER denied, nothing written (1.5)", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockRequireWriteAccess.mockResolvedValue(undefined);
	});

	function denyWrite() {
		mockRequireWriteAccess.mockRejectedValue(
			new Error("Write access required (ADMIN or OPERATOR)"),
		);
	}

	it("requestFeed throws and writes nothing", async () => {
		denyWrite();
		const { requestFeed } = await import("@/lib/actions/energy");
		await expect(requestFeed("device-1")).rejects.toThrow(/Write access required/);
		expect(mockEnergyDevice.findFirst).not.toHaveBeenCalled();
		expect(mockFeedRequest.create).not.toHaveBeenCalled();
	});

	it("toggleDevicePause throws and writes nothing", async () => {
		denyWrite();
		const { toggleDevicePause } = await import("@/lib/actions/schedule");
		await expect(toggleDevicePause("device-1", true)).rejects.toThrow(/Write access required/);
		expect(mockEnergyDevice.update).not.toHaveBeenCalled();
		expect(mockDeviceStateEvent.create).not.toHaveBeenCalled();
	});

	it("updateScheduleCommand throws and writes nothing", async () => {
		denyWrite();
		const { updateScheduleCommand } = await import("@/lib/actions/schedule");
		await expect(
			updateScheduleCommand("pond-1", "device-1", {
				scheduleStart: "08:00",
				scheduleEnd: "18:00",
				feedsPerDay: 2,
				feedingRatePct: 3,
			}),
		).rejects.toThrow(/Write access required/);
		expect(mockScheduleCommand.create).not.toHaveBeenCalled();
		expect(mockScheduleCommand.update).not.toHaveBeenCalled();
	});

	it("updatePondSettings returns an error and writes nothing", async () => {
		denyWrite();
		const { updatePondSettings } = await import("@/lib/actions/settings");
		const result = await updatePondSettings("pond-1", 3, 2);
		expect(result.success).toBe(false);
		expect(mockPond.update).not.toHaveBeenCalled();
	});

	it("updateNotificationPrefs returns an error and writes nothing", async () => {
		denyWrite();
		const { updateNotificationPrefs } = await import("@/lib/actions/settings");
		const result = await updateNotificationPrefs("pond-1", {
			missedFeeding: true,
			deviceOffline: true,
			hopperLow: true,
		});
		expect(result.success).toBe(false);
		expect(mockPond.update).not.toHaveBeenCalled();
	});

	it("saveBiomassLog throws and writes nothing", async () => {
		denyWrite();
		const { saveBiomassLog } = await import("@/lib/actions/biomass");
		await expect(saveBiomassLog(new FormData())).rejects.toThrow(/Write access required/);
		const mockBiomassLog = vi.mocked(prisma.biomassLog);
		expect(mockBiomassLog.create).not.toHaveBeenCalled();
	});

	it("saveHopperCalibration returns an error and writes nothing", async () => {
		denyWrite();
		const { saveHopperCalibration } = await import("@/lib/actions/energy");
		const result = await saveHopperCalibration("device-1", {
			hopperFullCm: 5,
			hopperEmptyCm: 30,
			hopperCapacityG: 7000,
		});
		expect(result.success).toBe(false);
		expect(mockEnergyDevice.update).not.toHaveBeenCalled();
		expect(mockDeviceStateEvent.create).not.toHaveBeenCalled();
	});

	it("saveHopperCalibration rejects invalid calibration values", async () => {
		// Write access and the device lookup succeed; only the values are bad.
		mockRequireWriteAccess.mockResolvedValue(undefined);
		mockEnergyDevice.findFirst.mockResolvedValue(onlineDevice());

		const { saveHopperCalibration } = await import("@/lib/actions/energy");

		const zeroCapacity = await saveHopperCalibration("device-1", {
			hopperFullCm: 5,
			hopperEmptyCm: 30,
			hopperCapacityG: 0,
		});
		expect(zeroCapacity.success).toBe(false);
		expect(zeroCapacity.error).toMatch(/capacity/i);

		const inverted = await saveHopperCalibration("device-1", {
			hopperFullCm: 30,
			hopperEmptyCm: 5,
			hopperCapacityG: 7000,
		});
		expect(inverted.success).toBe(false);
		expect(inverted.error).toBe(
			"hopperEmptyCm: The empty distance must be greater than the full distance",
		);

		expect(mockEnergyDevice.update).not.toHaveBeenCalled();
		expect(mockDeviceStateEvent.create).not.toHaveBeenCalled();
	});

	it("saveHopperCalibration revalidates the page that shows the result", async () => {
		// The form lives on Hardware settings. Revalidating another page left the
		// saved capacity invisible until a manual reload.
		mockRequireWriteAccess.mockResolvedValue(undefined);
		mockEnergyDevice.findFirst.mockResolvedValue(onlineDevice());
		const { saveHopperCalibration } = await import("@/lib/actions/energy");

		const result = await saveHopperCalibration("device-1", {
			hopperFullCm: 5,
			hopperEmptyCm: 30,
			hopperCapacityG: 7000,
		});

		expect(result.success).toBe(true);
		expect(vi.mocked(revalidatePath)).toHaveBeenCalledWith(
			"/[locale]/(dashboard)/dashboard/settings/hardware",
			"page",
		);
	});

	it("saveDurationCalibration returns an error and writes nothing", async () => {
		denyWrite();
		const { saveDurationCalibration } = await import("@/lib/actions/energy");
		const result = await saveDurationCalibration("device-1", 4);
		expect(result.success).toBe(false);
		expect(mockEnergyDevice.update).not.toHaveBeenCalled();
	});

	it("saveTemperatureCalibration returns an error and writes nothing", async () => {
		denyWrite();
		const { saveTemperatureCalibration } = await import("@/lib/actions/energy");
		const result = await saveTemperatureCalibration("device-1", 1.5);
		expect(result.success).toBe(false);
		expect(mockEnergyDevice.update).not.toHaveBeenCalled();
	});

	it("setDeviceTime returns an error and writes nothing", async () => {
		denyWrite();
		const { setDeviceTime } = await import("@/lib/actions/time");
		const result = await setDeviceTime("device-1", "2026-10-13T08:00");
		expect(result.success).toBe(false);
		expect(mockDeviceStateEvent.create).not.toHaveBeenCalled();
	});

	it("renameFarm returns an error and writes nothing", async () => {
		denyWrite();
		const { renameFarm } = await import("@/lib/actions/farm");
		const result = await renameFarm("New Farm Name");
		expect(result).toEqual({ error: expect.stringContaining("Write access required") });
		expect(mockFarm.update).not.toHaveBeenCalled();
	});
});

describe("permission enforcement — revoked control_feeder blocks the action", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockRequireWriteAccess.mockResolvedValue(undefined);
		mockRequirePermission.mockResolvedValue(undefined);
	});

	function denyPermission() {
		mockRequirePermission.mockRejectedValue(new Error("Forbidden"));
	}

	it("requestFeed asks for control_feeder and writes nothing when denied", async () => {
		denyPermission();
		const { requestFeed } = await import("@/lib/actions/energy");

		await expect(requestFeed("device-1")).rejects.toThrow("Forbidden");

		expect(mockRequirePermission).toHaveBeenCalledWith("control_feeder");
		expect(mockEnergyDevice.findFirst).not.toHaveBeenCalled();
		expect(mockFeedRequest.create).not.toHaveBeenCalled();
		expect(mockDeviceStateEvent.create).not.toHaveBeenCalled();
	});

	it("toggleDevicePause asks for control_feeder and writes nothing when denied", async () => {
		denyPermission();
		const { toggleDevicePause } = await import("@/lib/actions/schedule");

		await expect(toggleDevicePause("device-1", true)).rejects.toThrow("Forbidden");

		expect(mockRequirePermission).toHaveBeenCalledWith("control_feeder");
		expect(mockEnergyDevice.update).not.toHaveBeenCalled();
		expect(mockDeviceStateEvent.create).not.toHaveBeenCalled();
	});

	it("updateScheduleCommand asks for manage_schedule and writes nothing when denied", async () => {
		denyPermission();
		const { updateScheduleCommand } = await import("@/lib/actions/schedule");

		await expect(
			updateScheduleCommand("pond-1", "device-1", {
				scheduleStart: "08:00",
				scheduleEnd: "18:00",
				feedsPerDay: 2,
				feedingRatePct: 3,
			}),
		).rejects.toThrow("Forbidden");

		expect(mockRequirePermission).toHaveBeenCalledWith("manage_schedule");
		expect(mockScheduleCommand.create).not.toHaveBeenCalled();
	});
});
