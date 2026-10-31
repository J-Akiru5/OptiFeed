import { beforeEach, describe, expect, it, vi } from "vitest";

const { prisma, resolveActivePond, resolveCurrentSchedule } = vi.hoisted(() => ({
	prisma: {
		energyDevice: { findFirst: vi.fn() },
		scheduleCommand: { create: vi.fn(), findMany: vi.fn(), update: vi.fn() },
		deviceStateEvent: { create: vi.fn() },
	},
	resolveActivePond: vi.fn(),
	resolveCurrentSchedule: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({ default: prisma }));
vi.mock("@/lib/auth/pond-access", () => ({ resolveActivePond }));
vi.mock("@/lib/schedule/resolve-current", () => ({ resolveCurrentSchedule }));
vi.mock("@/lib/auth/session", () => ({
	getCurrentPondOwnerId: vi.fn().mockResolvedValue("farm-1"),
	requireWriteAccess: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/auth/permissions", () => ({
	requirePermission: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/feed-grams", () => ({ syncDeviceGramsForPond: vi.fn() }));
vi.mock("@/lib/feeding/derive", () => ({
	// The dose guard is covered in pond-dose-guards.test.ts; here the import
	// only has to get past it. The dose matches the device's stored one.
	resolveDeviceDose: vi.fn(async () => ({
		status: "ready",
		grams: 150,
		dailyG: 450,
		maxDoseG: 300,
		dailyCapG: 2000,
	})),
}));
vi.mock("@/lib/settings/feeding-caps", () => ({
	getFeedingLimits: vi.fn(async () => ({ dailyCapFactor: 1, maxDispenseMs: 30_000 })),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { importFeedingSchedule } from "@/lib/actions/schedule";

const EVEN = "time,grams,enabled\n06:00,150,true\n12:00,150,true\n18:00,150,true";
const UNEVEN = "time,grams,enabled\n06:00,150,true\n07:00,150,true\n18:00,150,true";

const device = {
	id: "dev-1",
	buttonFeedGrams: 120,
	gramsPerFeeding: 150,
	gramsPerSecond: 10,
	dailyCapG: 2000,
	hopperCapacityG: null,
	pond: { isFallow: false },
};

beforeEach(() => {
	vi.clearAllMocks();
	resolveActivePond.mockResolvedValue({ id: "pond-1", feedingRatePct: 2.5 });
	resolveCurrentSchedule.mockResolvedValue({ feedingRatePct: 3.5 });
	prisma.energyDevice.findFirst.mockResolvedValue(device);
	prisma.scheduleCommand.findMany.mockResolvedValue([]);
	prisma.scheduleCommand.create.mockResolvedValue({ id: "cmd-1" });
	prisma.deviceStateEvent.create.mockResolvedValue({});
});

describe("importFeedingSchedule", () => {
	it("refuses an empty file", async () => {
		const result = await importFeedingSchedule("");

		expect(result.success).toBe(false);
		expect(prisma.scheduleCommand.create).not.toHaveBeenCalled();
	});

	it("re-validates the sheet and writes nothing for uneven times", async () => {
		const result = await importFeedingSchedule(UNEVEN);

		expect(result).toEqual({ success: false, error: expect.stringContaining("not valid") });
		expect(prisma.scheduleCommand.create).not.toHaveBeenCalled();
	});

	it("reports a farm with no pond", async () => {
		resolveActivePond.mockResolvedValue(null);

		expect(await importFeedingSchedule(EVEN)).toEqual({ success: false, error: "No pond found." });
	});

	it("reports a pond with no paired feeder", async () => {
		prisma.energyDevice.findFirst.mockResolvedValueOnce(null);

		expect(await importFeedingSchedule(EVEN)).toEqual({
			success: false,
			error: "No feeder is paired to this pond.",
		});
	});

	it("queues the window and meal count, keeping the feeding rate and button feed", async () => {
		prisma.energyDevice.findFirst.mockResolvedValue(device);

		const result = await importFeedingSchedule(EVEN);

		expect(result).toEqual({ success: true, commandId: "cmd-1" });
		const data = prisma.scheduleCommand.create.mock.calls[0][0].data;
		expect(data).toMatchObject({
			deviceId: "dev-1",
			pondId: "pond-1",
			feedsPerDay: 3,
			feedingRatePct: 3.5,
			buttonFeedGrams: 120,
			status: "pending",
		});
		expect(data.scheduleStart.getUTCHours()).toBe(6);
		expect(data.scheduleEnd.getUTCHours()).toBe(18);
	});

	it("falls back to the pond's feeding rate when no schedule resolves", async () => {
		resolveCurrentSchedule.mockResolvedValue(null);

		await importFeedingSchedule(EVEN);

		expect(prisma.scheduleCommand.create.mock.calls[0][0].data.feedingRatePct).toBe(2.5);
	});

	it("still goes through the daily cap of the shared schedule action", async () => {
		// 3 meals of 150 g is 450 g/day; a 300 g hopper caps the day below that.
		prisma.energyDevice.findFirst.mockResolvedValue({ ...device, hopperCapacityG: 300 });

		const result = await importFeedingSchedule(EVEN);

		expect(result).toEqual({ success: false, error: expect.stringContaining("g/day limit") });
		expect(prisma.scheduleCommand.create).not.toHaveBeenCalled();
	});
});
