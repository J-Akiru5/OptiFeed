import { beforeEach, describe, expect, it, vi } from "vitest";

const { prisma, resolveActivePond, resolveCurrentSchedule } = vi.hoisted(() => ({
	prisma: { energyDevice: { findFirst: vi.fn() } },
	resolveActivePond: vi.fn(),
	resolveCurrentSchedule: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({ default: prisma }));
vi.mock("@/lib/auth/pond-access", () => ({ resolveActivePond }));
vi.mock("@/lib/schedule/resolve-current", () => ({ resolveCurrentSchedule }));
vi.mock("@/lib/settings/feeding-caps", () => ({
	getFeedingLimits: vi.fn(async () => ({ dailyCapFactor: 1 })),
}));

import { buildScheduleRows, checkScheduleAgainstCap } from "@/lib/schedule/sheet";

const at = (hours: number, minutes = 0) => new Date(Date.UTC(2024, 0, 1, hours, minutes));

beforeEach(() => {
	vi.clearAllMocks();
	prisma.energyDevice.findFirst.mockResolvedValue({
		id: "dev-1",
		isPaused: false,
		gramsPerFeeding: 150,
	});
	resolveCurrentSchedule.mockResolvedValue({
		scheduleStart: at(6),
		scheduleEnd: at(18),
		feedsPerDay: 3,
		feedingRatePct: 3,
	});
});

describe("buildScheduleRows", () => {
	it("lists one row per meal, evenly spaced, with the device dose", async () => {
		const rows = await buildScheduleRows("pond-1");

		expect(rows).toEqual([
			{ time: "06:00", grams: 150, enabled: true },
			{ time: "12:00", grams: 150, enabled: true },
			{ time: "18:00", grams: 150, enabled: true },
		]);
		expect(resolveCurrentSchedule).toHaveBeenCalledWith("pond-1", "dev-1");
	});

	it("marks every row disabled while the schedule is paused", async () => {
		prisma.energyDevice.findFirst.mockResolvedValue({
			id: "dev-1",
			isPaused: true,
			gramsPerFeeding: 150,
		});

		const rows = await buildScheduleRows("pond-1");

		expect(rows.every((row) => row.enabled === false)).toBe(true);
	});

	it("leaves grams empty and enabled when the pond has no device", async () => {
		prisma.energyDevice.findFirst.mockResolvedValue(null);

		const rows = await buildScheduleRows("pond-1");

		expect(rows).toHaveLength(3);
		expect(rows[0]).toEqual({ time: "06:00", grams: null, enabled: true });
		expect(resolveCurrentSchedule).toHaveBeenCalledWith("pond-1", null);
	});

	it("returns no rows when the pond has no schedule", async () => {
		resolveCurrentSchedule.mockResolvedValue(null);

		expect(await buildScheduleRows("pond-1")).toEqual([]);
	});

	it("runs past midnight for an overnight window", async () => {
		resolveCurrentSchedule.mockResolvedValue({
			scheduleStart: at(22),
			scheduleEnd: at(2),
			feedsPerDay: 3,
			feedingRatePct: 3,
		});

		const rows = await buildScheduleRows("pond-1");

		expect(rows.map((row) => row.time)).toEqual(["22:00", "00:00", "02:00"]);
	});
});

describe("checkScheduleAgainstCap", () => {
	beforeEach(() => {
		resolveActivePond.mockResolvedValue({ id: "pond-1" });
		prisma.energyDevice.findFirst.mockResolvedValue({
			dailyCapG: 1000,
			hopperCapacityG: null,
			gramsPerFeeding: 150,
		});
	});

	it("is null for a farm without a pond", async () => {
		resolveActivePond.mockResolvedValue(null);

		expect(await checkScheduleAgainstCap("farm-1", 3)).toBeNull();
	});

	it("is null for a pond without a feeder", async () => {
		prisma.energyDevice.findFirst.mockResolvedValue(null);

		expect(await checkScheduleAgainstCap("farm-1", 3)).toBeNull();
	});

	it("stays within the cap at the limit and goes over one meal later", async () => {
		expect(await checkScheduleAgainstCap("farm-1", 6)).toEqual({
			feedsPerDay: 6,
			dailyG: 900,
			capG: 1000,
			overCap: false,
		});
		expect(await checkScheduleAgainstCap("farm-1", 7)).toMatchObject({
			dailyG: 1050,
			overCap: true,
		});
	});
});
