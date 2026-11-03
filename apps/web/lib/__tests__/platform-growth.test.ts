import { beforeEach, describe, expect, it, vi } from "vitest";

const { db, gateMock } = vi.hoisted(() => ({
	db: { $queryRaw: vi.fn() },
	gateMock: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({ default: db }));
vi.mock("@/lib/auth/require-platform-admin", () => ({ requirePlatformAdmin: gateMock }));

import { getGrowthSeries } from "@/lib/platform/growth";

const NOW = new Date("2026-11-02T04:00:00.000Z"); // 12:00 Asia/Manila

describe("getGrowthSeries", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("fills the four registration series from one bounded query", async () => {
		db.$queryRaw.mockResolvedValue([
			{ series: "users", day: "2026-10-27", total: 1 },
			{ series: "users", day: "2026-11-01", total: 3 },
			{ series: "organizations", day: "2026-10-30", total: 1 },
			{ series: "ponds", day: "2026-11-02", total: 2 },
			{ series: "devices", day: "2026-11-02", total: 1 },
			// A series the contract does not know is ignored, not rendered.
			{ series: "unknown", day: "2026-11-02", total: 99 },
		]);

		const result = await getGrowthSeries(7, NOW);

		expect(gateMock).toHaveBeenCalledTimes(1);
		expect(result.dayKeys).toHaveLength(7);
		expect(result.dayKeys[0]).toBe("2026-10-27");
		expect(result.dayKeys[6]).toBe("2026-11-02");
		expect(result.series.users).toHaveLength(7);
		expect(result.series.users.find((point) => point.label === "2026-11-01")?.value).toBe(3);
		expect(result.series.organizations.find((point) => point.label === "2026-10-30")?.value).toBe(
			1,
		);
		expect(result.series.ponds.find((point) => point.label === "2026-11-02")?.value).toBe(2);
		expect(result.series.devices.find((point) => point.label === "2026-11-02")?.value).toBe(1);
		expect(result.totals).toEqual({ users: 4, organizations: 1, ponds: 2, devices: 1 });
	});

	it("returns zero-filled series when nothing was registered in the window", async () => {
		db.$queryRaw.mockResolvedValue([]);

		const result = await getGrowthSeries(7, NOW);

		expect(result.dayKeys).toHaveLength(7);
		expect(result.totals).toEqual({ users: 0, organizations: 0, ponds: 0, devices: 0 });
		expect(result.series.users.every((point) => point.value === 0)).toBe(true);
		expect(result.series.devices.every((point) => point.value === 0)).toBe(true);
	});

	it("uses one query for all four series", async () => {
		db.$queryRaw.mockResolvedValue([]);

		await getGrowthSeries(30, NOW);

		expect(db.$queryRaw).toHaveBeenCalledTimes(1);
	});
});
