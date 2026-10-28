import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({
	default: { pond: { findUnique: vi.fn() } },
}));
vi.mock("@/lib/schedule/resolve-current", () => ({
	resolveCurrentSchedule: vi.fn(),
}));
vi.mock("@/lib/settings/feeding-caps", () => ({
	getFeedingLimits: vi.fn(),
}));

import { resolvePondFeeding } from "@/lib/feeding/source";
import prisma from "@/lib/prisma";
import { resolveCurrentSchedule } from "@/lib/schedule/resolve-current";
import { getFeedingLimits } from "@/lib/settings/feeding-caps";

const mockPond = vi.mocked(prisma.pond);
const mockSchedule = vi.mocked(resolveCurrentSchedule);
const mockLimits = vi.mocked(getFeedingLimits);

const scheduleDefaults = {
	feedsPerDay: 2,
	feedingRatePct: 5,
	scheduleStart: new Date("1970-01-01T06:00:00.000Z"),
	scheduleEnd: new Date("1970-01-01T16:00:00.000Z"),
};

function pondRow(id: string, population: number | null) {
	return {
		id,
		name: `Pond ${id}`,
		population,
		feedingRatePct: 4,
		feedsPerDay: 3,
		scheduleStart: new Date("1970-01-01T07:00:00.000Z"),
		scheduleEnd: new Date("1970-01-01T17:00:00.000Z"),
		energyDevices: [
			{
				id: `device-${id}`,
				gramsPerFeeding: 100,
				hopperCapacityG: 7000,
				dailyCapG: 3000,
			},
		],
	};
}

describe("resolvePondFeeding", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockLimits.mockResolvedValue({
			maxDispenseMs: 300_000,
			dailyCapFactor: 1,
		});
		mockSchedule.mockResolvedValue(null);
	});

	it("reads exactly the requested pond, never another one", async () => {
		mockPond.findUnique.mockImplementation((async ({ where }: { where: { id: string } }) =>
			where.id === "pond-a" ? pondRow("pond-a", 86) : pondRow("pond-b", 5000)) as never);

		const a = await resolvePondFeeding("pond-a");
		const b = await resolvePondFeeding("pond-b");

		expect(a?.pondId).toBe("pond-a");
		expect(a?.deviceId).toBe("device-pond-a");
		expect(a?.population).toBe(86);
		expect(b?.pondId).toBe("pond-b");
		expect(b?.population).toBe(5000);
	});

	it("returns null for an unknown pond instead of falling back", async () => {
		mockPond.findUnique.mockResolvedValue(null as never);
		expect(await resolvePondFeeding("missing")).toBeNull();
	});

	it("lets a pending schedule command override the stored row", async () => {
		mockPond.findUnique.mockResolvedValue(pondRow("pond-a", 86) as never);
		mockSchedule.mockResolvedValue({ ...scheduleDefaults, feedsPerDay: 4, feedingRatePct: 6 });

		const source = await resolvePondFeeding("pond-a");

		expect(source?.feedsPerDay).toBe(4);
		expect(source?.feedingRatePct).toBe(6);
	});

	it("exposes a null population so callers cannot assume 5,000 fish", async () => {
		mockPond.findUnique.mockResolvedValue(pondRow("pond-a", null) as never);
		const source = await resolvePondFeeding("pond-a");
		expect(source?.population).toBeNull();
	});

	it("resolves the daily ceiling through the one cap function", async () => {
		mockPond.findUnique.mockResolvedValue(pondRow("pond-a", 86) as never);
		mockLimits.mockResolvedValue({ maxDispenseMs: 300_000, dailyCapFactor: 0.5 });

		const source = await resolvePondFeeding("pond-a");

		// configured 3,000 g, platform factor 0.5 -> 1,500 g
		expect(source?.dailyCapG).toBe(1500);
	});

	it("falls back to the 2,000 g default when the device has no ceiling", async () => {
		const row = pondRow("pond-a", 86);
		row.energyDevices[0].dailyCapG = null as never;
		mockPond.findUnique.mockResolvedValue(row as never);

		const source = await resolvePondFeeding("pond-a");

		expect(source?.dailyCapG).toBe(2000);
	});
});
