import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `updatePondSettings` (#371): a failure is structured and writes nothing.
 *
 * These tests sit on the boundary the issue is about: the pond settings win,
 * but a plan the feeder cannot safely execute is refused *before* any write,
 * with the field and the device setting it conflicts with.
 */

vi.mock("@/lib/prisma", () => ({
	default: {
		pond: { findFirst: vi.fn(), update: vi.fn() },
		cropCycle: { updateMany: vi.fn(async () => ({ count: 0 })), create: vi.fn() },
		energyDevice: { findFirst: vi.fn() },
		biomassLog: { findFirst: vi.fn() },
		deviceStateEvent: { create: vi.fn() },
	},
}));

vi.mock("@/lib/auth/session", () => ({
	requireWriteAccess: vi.fn(),
	getCurrentPondOwnerId: vi.fn(async () => "farm-1"),
}));

vi.mock("@/lib/feed-grams", () => ({
	syncDeviceGramsForPond: vi.fn(async () => 1000),
}));

vi.mock("@/lib/actions/schedule", () => ({
	updateScheduleCommand: vi.fn(async () => ({ success: true, commandId: "cmd-1" })),
}));

vi.mock("@/lib/settings/feeding-caps", () => ({
	getFeedingLimits: vi.fn(async () => ({ maxDispenseMs: 300_000, dailyCapFactor: 1 })),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { updateScheduleCommand } from "@/lib/actions/schedule";
import { requireWriteAccess } from "@/lib/auth/session";
import { syncDeviceGramsForPond } from "@/lib/feed-grams";
import prisma from "@/lib/prisma";

const mockRequireWriteAccess = vi.mocked(requireWriteAccess);
const mockSync = vi.mocked(syncDeviceGramsForPond);
const mockSchedule = vi.mocked(updateScheduleCommand);
const mockPond = vi.mocked(prisma.pond);
const mockDevice = vi.mocked(prisma.energyDevice);
const mockBiomass = vi.mocked(prisma.biomassLog);
const mockEvent = vi.mocked(prisma.deviceStateEvent);

const POND = {
	id: "pond-1",
	population: 100,
	feedingRatePct: 2,
	feedsPerDay: 2,
	scheduleStart: new Date("2026-01-01T06:00:00.000Z"),
	scheduleEnd: new Date("2026-01-01T18:00:00.000Z"),
	notificationPrefs: null,
};

beforeEach(() => {
	vi.clearAllMocks();
	mockRequireWriteAccess.mockResolvedValue(undefined);
	mockPond.findFirst.mockResolvedValue(POND as never);
	mockDevice.findFirst.mockResolvedValue({
		id: "device-1",
		dailyCapG: 2000,
		hopperCapacityG: null,
		gramsPerSecond: 4,
	} as never);
	mockBiomass.findFirst.mockResolvedValue({ avgWeightKg: 1 } as never);
	mockSchedule.mockResolvedValue({ success: true, commandId: "cmd-1" });
	mockPond.update.mockResolvedValue({} as never);
	mockEvent.create.mockResolvedValue({} as never);
});

describe("updatePondSettings field validation", () => {
	it("returns the field error for a rate below the minimum", async () => {
		const { updatePondSettings } = await import("@/lib/actions/settings");
		const result = await updatePondSettings("pond-1", 0, 2);

		expect(result.success).toBe(false);
		if (!result.success) {
			expect(result.fieldErrors).toEqual([
				expect.objectContaining({ field: "feedingRatePct", code: "rate_min" }),
			]);
			expect(result.conflicts).toEqual([]);
		}
		expect(mockPond.update).not.toHaveBeenCalled();
	});

	it("returns the field error for an invalid pond area", async () => {
		const { updatePondSettings } = await import("@/lib/actions/settings");
		const result = await updatePondSettings("pond-1", 2, 2, 15, 100, {
			areaM2: 0,
			averageDepthM: null,
			feedPricePerKg: null,
		});

		expect(result.success).toBe(false);
		if (!result.success) {
			expect(result.fieldErrors[0]).toMatchObject({ field: "areaM2", code: "area_invalid" });
		}
		expect(mockPond.update).not.toHaveBeenCalled();
	});
});

describe("updatePondSettings conflicts with the device", () => {
	it("refuses a daily plan over the device ceiling and offers the pond value", async () => {
		const { updatePondSettings } = await import("@/lib/actions/settings");
		// 100 fish x 1 kg x 2.5% = 2,500 g/day, over the 2,000 g ceiling.
		const result = await updatePondSettings("pond-1", 2.5, 2, 15, 100);

		expect(result.success).toBe(false);
		if (!result.success) {
			const daily = result.conflicts.find((conflict) => conflict.code === "daily-ceiling");
			expect(daily).toMatchObject({
				field: "feedingRatePct",
				pondValueG: 2500,
				deviceValueG: 2000,
				canUsePondValue: true,
				pondValueToApplyG: 2500,
				href: "/dashboard/settings/hardware#daily-ceiling",
			});
			expect(result.error).toContain("2500");
		}
		expect(mockSync).not.toHaveBeenCalled();
		expect(mockSchedule).not.toHaveBeenCalled();
		expect(mockPond.update).not.toHaveBeenCalled();
	});

	it("refuses a meal the relay window cannot run and links to the calibration", async () => {
		const { updatePondSettings } = await import("@/lib/actions/settings");
		// 5% at two meals = 2,500 g per meal; 4 g/s x 300 s = 1,200 g.
		const result = await updatePondSettings("pond-1", 5, 2, 15, 100);

		expect(result.success).toBe(false);
		if (!result.success) {
			const relay = result.conflicts.find((conflict) => conflict.code === "relay-time");
			expect(relay).toMatchObject({
				field: "feedsPerDay",
				pondValueG: 2500,
				deviceValueG: 1200,
				canUsePondValue: false,
				href: "/dashboard/settings/hardware#calibration",
				suggestedFeedsPerDay: 5,
			});
		}
		expect(mockPond.update).not.toHaveBeenCalled();
	});
});

describe("updatePondSettings success path", () => {
	it("saves a plan that fits, syncing the dose before the schedule is queued", async () => {
		const { updatePondSettings } = await import("@/lib/actions/settings");
		const result = await updatePondSettings("pond-1", 2, 2, 15, 100, {
			areaM2: 500,
			averageDepthM: 1.5,
			feedPricePerKg: 30,
		});

		expect(result).toEqual({ success: true });
		expect(mockSync).toHaveBeenCalledWith("pond-1", {
			feedingRatePct: 2,
			feedsPerDay: 2,
			population: 100,
		});
		expect(mockSchedule).toHaveBeenCalled();
		expect(mockPond.update).toHaveBeenCalled();
		expect(mockEvent.create).toHaveBeenCalled();
	});

	it("does not mark success when the schedule command fails", async () => {
		mockSchedule.mockResolvedValue({ success: false, error: "Device not found" });
		const { updatePondSettings } = await import("@/lib/actions/settings");
		const result = await updatePondSettings("pond-1", 2, 2, 15, 100);

		expect(result.success).toBe(false);
		expect(mockPond.update).not.toHaveBeenCalled();
	});
});

describe("updatePondSettings guard", () => {
	it("returns a structured failure when the caller cannot write", async () => {
		mockRequireWriteAccess.mockRejectedValue(new Error("Write access required"));
		const { updatePondSettings } = await import("@/lib/actions/settings");
		const result = await updatePondSettings("pond-1", 2, 2);

		expect(result.success).toBe(false);
		if (!result.success) {
			expect(result.fieldErrors).toEqual([]);
			expect(result.conflicts).toEqual([]);
		}
		expect(mockPond.findFirst).not.toHaveBeenCalled();
		expect(mockPond.update).not.toHaveBeenCalled();
	});
});
