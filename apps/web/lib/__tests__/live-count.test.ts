import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Live count behaviour (issue #452) and the pond-settings integrity fix (#430).
 *
 * The database is faked with a tiny in-memory store that *honours the query
 * `where` clause* this module issues, so the stocking-date bound is exercised
 * for real instead of being asserted from the call arguments only.
 */

const db = vi.hoisted(() => {
	const state = {
		ponds: new Map<string, { population: number | null }>(),
		cycle: null as { stockingCount: number; stockingDate: Date } | null,
		logs: [] as { count: number; recordedAt: Date }[],
	};
	return {
		state,
		prisma: {
			pond: {
				findUnique: vi.fn(),
			},
			cropCycle: {
				findFirst: vi.fn(),
			},
			mortalityLog: {
				aggregate: vi.fn(),
			},
		},
	};
});

vi.mock("@/lib/prisma", () => ({ default: db.prisma }));

import { deriveLiveCount, getLiveCountForPond, mortalityRatePct } from "@/lib/growth/live-count";

const POND = "pond-1";
const STOCKED_AT = new Date("2026-10-01T00:00:00.000Z");
const BEFORE = new Date("2026-09-15T00:00:00.000Z");
const AFTER = new Date("2026-10-05T00:00:00.000Z");

beforeEach(() => {
	vi.clearAllMocks();
	db.state.ponds.set(POND, { population: 525 });
	db.state.cycle = null;
	db.state.logs = [];

	db.prisma.pond.findUnique.mockImplementation(async () => db.state.ponds.get(POND) ?? null);
	db.prisma.cropCycle.findFirst.mockImplementation(async () => db.state.cycle);
	db.prisma.mortalityLog.aggregate.mockImplementation(
		async (args: { where: { pondId: string; recordedAt?: { gte: Date } } }) => {
			const from = args.where.recordedAt?.gte;
			const total = db.state.logs
				.filter((log) => from === undefined || log.recordedAt >= from)
				.reduce((sum, log) => sum + log.count, 0);
			return { _sum: { count: total } };
		},
	);
});

/** Pure part of the issue #452 live count: stocked − dead, clamped, never out of range. */
describe("deriveLiveCount", () => {
	it("subtracts mortality from the stock", () => {
		expect(deriveLiveCount(300, 15)).toEqual({
			stocked: 300,
			dead: 15,
			live: 285,
			source: "crop_cycle",
		});
	});

	it("clamps at zero when mortality exceeds the stock (double-counted logs)", () => {
		expect(deriveLiveCount(300, 500).live).toBe(0);
	});

	it("rounds fractional totals down to whole fish", () => {
		expect(deriveLiveCount(300, 12.7).dead).toBe(12);
		expect(deriveLiveCount(300, 12.7).live).toBe(288);
	});

	it("reports none for a pond without any stock source", () => {
		expect(deriveLiveCount(null, 10)).toEqual({
			stocked: null,
			dead: 10,
			live: null,
			source: "none",
		});
	});

	it("keeps the stock source it is told about (#430)", () => {
		expect(deriveLiveCount(525, 0, "legacy_population")).toEqual({
			stocked: 525,
			dead: 0,
			live: 525,
			source: "legacy_population",
		});
		expect(deriveLiveCount(525, 0, "crop_cycle").source).toBe("crop_cycle");
	});
});

describe("mortalityRatePct", () => {
	it("reports the dead share of the stocked count", () => {
		expect(mortalityRatePct(75, 600)).toBeCloseTo(12.5);
		expect(mortalityRatePct(0, 600)).toBe(0);
	});

	it("clamps to 100 and refuses to invent a rate without a stock source", () => {
		expect(mortalityRatePct(700, 600)).toBe(100);
		expect(mortalityRatePct(10, null)).toBeNull();
		expect(mortalityRatePct(10, 0)).toBeNull();
	});
});

describe("getLiveCountForPond", () => {
	it("reports the cycle stocking count after calibration to 525 (#430)", async () => {
		db.state.cycle = { stockingCount: 525, stockingDate: STOCKED_AT };

		const result = await getLiveCountForPond(POND);

		expect(result).toEqual({ stocked: 525, dead: 0, live: 525, source: "crop_cycle" });
	});

	it("reports the legacy population for a pond with no active cycle", async () => {
		const result = await getLiveCountForPond(POND);

		expect(result).toEqual({ stocked: 525, dead: 0, live: 525, source: "legacy_population" });
		expect(db.prisma.mortalityLog.aggregate.mock.calls[0][0].where).toEqual({ pondId: POND });
	});

	it("ignores mortality recorded before the current stocking date (#430)", async () => {
		db.state.cycle = { stockingCount: 525, stockingDate: STOCKED_AT };
		db.state.logs = [
			{ count: 40, recordedAt: BEFORE },
			{ count: 5, recordedAt: AFTER },
		];

		const result = await getLiveCountForPond(POND);

		expect(result).toEqual({ stocked: 525, dead: 5, live: 520, source: "crop_cycle" });
		expect(db.prisma.mortalityLog.aggregate.mock.calls[0][0].where).toEqual({
			pondId: POND,
			recordedAt: { gte: STOCKED_AT },
		});
	});

	it("still subtracts its own logs on a population-only pond", async () => {
		db.state.logs = [{ count: 25, recordedAt: BEFORE }];

		const result = await getLiveCountForPond(POND);

		expect(result).toEqual({ stocked: 525, dead: 25, live: 500, source: "legacy_population" });
	});

	it("accepts a pond row the caller already holds", async () => {
		await getLiveCountForPond(POND, { population: 525 });

		expect(db.prisma.pond.findUnique).not.toHaveBeenCalled();
	});
});
