import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The relay-time guard on the schedule path (#430).
 *
 * The dose the feeder runs is derived from the pond settings, the fish count
 * and the latest biomass sample. The schedule save used to check the dose that
 * was *stored* and then write the newly *derived* one, so a dose the feeder
 * could not run in one relay window reached it — and the pond settings then
 * refused every later edit, because the saved plan was already impossible.
 *
 * These cases pin the fix: the dose that is about to be written is the dose
 * that gets checked, and a change that *fixes* an over-limit dose is allowed.
 */

const { db } = vi.hoisted(() => {
	const db = {
		pond: { findFirst: vi.fn() },
		energyDevice: { findFirst: vi.fn() },
		scheduleCommand: { findMany: vi.fn(), create: vi.fn() },
		deviceStateEvent: { create: vi.fn() },
	};
	return { db };
});

vi.mock("@/lib/prisma", () => ({ default: db }));
vi.mock("@/lib/auth/session", () => ({
	requireWriteAccess: vi.fn(async () => undefined),
	getCurrentPondOwnerId: vi.fn(async () => "farm-a"),
}));
vi.mock("@/lib/auth/permissions", () => ({ requirePermission: vi.fn(async () => undefined) }));
vi.mock("@/lib/auth/pond-access", () => ({ resolveActivePond: vi.fn() }));
vi.mock("@/lib/settings/feeding-caps", () => ({
	getFeedingLimits: vi.fn(async () => ({ maxDispenseMs: 300_000, dailyCapFactor: 1 })),
}));
vi.mock("@/lib/feeding/derive", () => ({ resolveDeviceDose: vi.fn() }));
vi.mock("@/lib/feed-grams", () => ({ syncDeviceGramsForPond: vi.fn(async () => 900) }));
vi.mock("@/lib/feed/commands", () => ({ setSchedulePause: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { updateScheduleCommand } from "@/lib/actions/schedule";
import { resolveDeviceDose } from "@/lib/feeding/derive";

const mockResolveDose = vi.mocked(resolveDeviceDose);

/** 4 g/s for 300 s is 1,200 g — the biggest dose the feeder can run. */
const DEVICE = {
	id: "device-1",
	pondId: "pond-1",
	gramsPerFeeding: 2110.06,
	gramsPerSecond: 4,
	dailyCapG: 5000,
	hopperCapacityG: 7000,
	isPaused: false,
	pond: { isFallow: false },
};

const INPUT = {
	scheduleStart: "06:00",
	scheduleEnd: "18:00",
	feedsPerDay: 3,
	feedingRatePct: 5,
};

beforeEach(() => {
	vi.clearAllMocks();
	db.pond.findFirst.mockResolvedValue({ isFallow: false });
	db.energyDevice.findFirst.mockResolvedValue(DEVICE);
	db.scheduleCommand.findMany.mockResolvedValue([]);
	db.scheduleCommand.create.mockResolvedValue({ id: "cmd-1" });
	db.deviceStateEvent.create.mockResolvedValue({});
});

describe("updateScheduleCommand dose guard (#430)", () => {
	it("refuses a dose the feeder cannot run in one relay window", async () => {
		// 525 fish x 140.67 g x 5% / 3 meals = 1,231 g, over the 1,200 g window.
		mockResolveDose.mockResolvedValue({
			status: "ready",
			grams: 1231,
			dailyG: 3693,
			maxDoseG: 1200,
			dailyCapG: 5000,
		});

		const result = await updateScheduleCommand("pond-1", "device-1", INPUT);

		expect(result.success).toBe(false);
		expect(result.error).toContain("relay time");
		expect(db.scheduleCommand.create).not.toHaveBeenCalled();
	});

	it("checks the dose it is about to write, not the one that is stored", async () => {
		// The stored dose is the broken 2,110 g one; the derived dose fits.
		mockResolveDose.mockResolvedValue({
			status: "ready",
			grams: 923,
			dailyG: 3692,
			maxDoseG: 1200,
			dailyCapG: 5000,
		});

		const result = await updateScheduleCommand("pond-1", "device-1", INPUT);

		expect(result.success).toBe(true);
		expect(db.scheduleCommand.create).toHaveBeenCalledTimes(1);
	});

	it("refuses a dose that would break the daily ceiling", async () => {
		// 1,000 g x 6 meals = 6,000 g/day, over the 5,000 g ceiling, while one
		// meal still fits the relay window.
		mockResolveDose.mockResolvedValue({
			status: "ready",
			grams: 1000,
			dailyG: 6000,
			maxDoseG: 1200,
			dailyCapG: 5000,
		});

		const result = await updateScheduleCommand("pond-1", "device-1", {
			...INPUT,
			feedsPerDay: 6,
		});

		expect(result.success).toBe(false);
		expect(result.error).toContain("limit");
		expect(db.scheduleCommand.create).not.toHaveBeenCalled();
	});

	it("falls back to the stored dose when no dose can be derived", async () => {
		mockResolveDose.mockResolvedValue({
			status: "no_biomass",
			grams: null,
			dailyG: null,
			maxDoseG: 1200,
			dailyCapG: 5000,
		});

		const result = await updateScheduleCommand("pond-1", "device-1", INPUT);

		// The stored 2,110 g dose cannot run in one relay window either.
		expect(result.success).toBe(false);
		expect(result.error).toContain("relay time");
		expect(db.scheduleCommand.create).not.toHaveBeenCalled();
	});

	it("derives the dose from the fish count the caller passes (#430)", async () => {
		mockResolveDose.mockResolvedValue({
			status: "ready",
			grams: 923,
			dailyG: 3692,
			maxDoseG: 1200,
			dailyCapG: 5000,
		});

		await updateScheduleCommand("pond-1", "device-1", { ...INPUT, population: 525 });

		expect(mockResolveDose).toHaveBeenCalledWith("pond-1", {
			feedingRatePct: 5,
			feedsPerDay: 3,
			population: 525,
		});
	});

	it("leaves the fish count to the pond row when the caller does not pass one", async () => {
		mockResolveDose.mockResolvedValue({
			status: "ready",
			grams: 923,
			dailyG: 3692,
			maxDoseG: 1200,
			dailyCapG: 5000,
		});

		await updateScheduleCommand("pond-1", "device-1", INPUT);

		expect(mockResolveDose).toHaveBeenCalledWith("pond-1", {
			feedingRatePct: 5,
			feedsPerDay: 3,
		});
	});
});
