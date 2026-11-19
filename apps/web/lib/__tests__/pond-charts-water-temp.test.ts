import { beforeEach, describe, expect, it, vi } from "vitest";

const { db } = vi.hoisted(() => ({
	db: { $queryRaw: vi.fn() },
}));

vi.mock("@/lib/prisma", () => ({ default: db }));

import { getWaterTempSeries } from "@/lib/pond-charts";

/**
 * #951: the water-temperature chart must keep a continuous axis and start at
 * the release date when it falls inside the selected window.
 */

const NOW = new Date("2026-10-27T04:30:00.000Z"); // 12:30 in Manila

beforeEach(() => {
	vi.resetAllMocks();
});

describe("getWaterTempSeries", () => {
	it("returns every hourly bucket and leaves missing hours null", async () => {
		db.$queryRaw.mockResolvedValue([{ bucket: "2026-10-27 12:00", value: 31.9 }]);

		const points = await getWaterTempSeries(["device-1"], "24h", NOW);

		expect(points).toHaveLength(24);
		expect(points.find((point) => point.label === "2026-10-27 12:00")?.value).toBe(31.9);
		expect(points.filter((point) => point.value === null)).toHaveLength(23);
	});

	it("starts the 24-hour axis at the release date when it is inside the window", async () => {
		db.$queryRaw.mockResolvedValue([]);

		const points = await getWaterTempSeries(
			["device-1"],
			"24h",
			NOW,
			new Date("2026-10-27T00:00:00.000Z"),
		);

		expect(points).toHaveLength(13);
		expect(points[0].label).toBe("2026-10-27 00:00");
		expect(points.at(-1)?.label).toBe("2026-10-27 12:00");
	});

	it("returns one row per local day for the week view", async () => {
		db.$queryRaw.mockResolvedValue([{ bucket: "2026-10-26", value: 30.2 }]);

		const points = await getWaterTempSeries(["device-1"], "7d", NOW);

		expect(points).toHaveLength(7);
		expect(points[0].label).toBe("2026-10-21");
		expect(points.find((point) => point.label === "2026-10-26")?.value).toBe(30.2);
	});
});
