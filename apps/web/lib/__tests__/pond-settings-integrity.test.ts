import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Pond settings integrity (#430): calibrating the fish count is one number.
 *
 * `updatePondSettings` used to write only `Pond.population`, while every
 * live-count surface reads the ACTIVE crop cycle's `stockingCount` when one
 * exists — so a pond calibrated to 525 kept reporting 600 everywhere except the
 * dashboard. These tests drive the real action against a small in-memory store
 * and then read the count back through the real helper, so the assertion is
 * "what a farmer sees", not "which function was called".
 */

const db = vi.hoisted(() => {
	const state = {
		pond: { id: "pond-1", population: 600 as number | null },
		cycle: null as { id: string; stockingCount: number; stockingDate: Date } | null,
		logs: [] as { count: number; recordedAt: Date }[],
	};

	const prisma = {
		pond: {
			findFirst: vi.fn(),
			findUnique: vi.fn(),
			update: vi.fn(),
		},
		cropCycle: {
			findFirst: vi.fn(),
			updateMany: vi.fn(),
			create: vi.fn(),
		},
		mortalityLog: {
			aggregate: vi.fn(),
		},
		energyDevice: {
			findFirst: vi.fn(),
		},
		biomassLog: {
			findFirst: vi.fn(),
		},
	};

	return { state, prisma };
});

vi.mock("@/lib/prisma", () => ({ default: db.prisma }));
vi.mock("@/lib/auth/session", () => ({
	requireWriteAccess: vi.fn(async () => undefined),
	getCurrentPondOwnerId: vi.fn(async () => "owner-1"),
}));
vi.mock("@/lib/feed-grams", () => ({ syncDeviceGramsForPond: vi.fn(async () => undefined) }));
vi.mock("@/lib/actions/schedule", () => ({
	updateScheduleCommand: vi.fn(async () => ({ success: true })),
}));
vi.mock("@/lib/settings/feeding-caps", () => ({
	getFeedingLimits: vi.fn(async () => ({ maxDispenseMs: 300_000, dailyCapFactor: 1 })),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { updatePondSettings } from "@/lib/actions/settings";
import { getLiveCountForPond } from "@/lib/growth/live-count";

const POND = "pond-1";
const STOCKED_AT = new Date("2026-10-01T00:00:00.000Z");
const BEFORE = new Date("2026-09-15T00:00:00.000Z");
const AFTER = new Date("2026-10-05T00:00:00.000Z");

beforeEach(() => {
	vi.clearAllMocks();
	db.state.pond = { id: POND, population: 600 };
	db.state.cycle = null;
	db.state.logs = [];

	db.prisma.pond.findFirst.mockImplementation(async () => ({
		...db.state.pond,
		ownerId: "owner-1",
		farmId: "farm-1",
		notificationPrefs: {},
		scheduleStart: new Date("2026-01-01T06:00:00.000Z"),
		scheduleEnd: new Date("2026-01-01T18:00:00.000Z"),
	}));
	db.prisma.pond.update.mockImplementation(
		async (args: { data: { population?: number | null } }) => {
			if (args.data.population !== undefined) db.state.pond.population = args.data.population;
			return db.state.pond;
		},
	);
	db.prisma.pond.findUnique.mockImplementation(async () => db.state.pond);
	db.prisma.cropCycle.findFirst.mockImplementation(async () => db.state.cycle);
	db.prisma.cropCycle.updateMany.mockImplementation(
		async (args: { where: { status: string }; data: { stockingCount: number } }) => {
			if (db.state.cycle && args.where.status === "ACTIVE") {
				db.state.cycle.stockingCount = args.data.stockingCount;
				return { count: 1 };
			}
			return { count: 0 };
		},
	);
	db.prisma.mortalityLog.aggregate.mockImplementation(
		async (args: { where: { recordedAt?: { gte: Date } } }) => {
			const from = args.where.recordedAt?.gte;
			const total = db.state.logs
				.filter((log) => from === undefined || log.recordedAt >= from)
				.reduce((sum, log) => sum + log.count, 0);
			return { _sum: { count: total } };
		},
	);
	// No device on these ponds: the plain save path, which is the one that used to
	// leave the crop cycle behind.
	db.prisma.energyDevice.findFirst.mockResolvedValue(null);
	db.prisma.biomassLog.findFirst.mockResolvedValue(null);
});

describe("pond settings integrity (#430)", () => {
	it("calibrates a cycle-backed pond to 525 and reports 525 everywhere", async () => {
		db.state.cycle = { id: "cycle-1", stockingCount: 600, stockingDate: STOCKED_AT };

		const saved = await updatePondSettings(POND, 3, 2, undefined, 525);

		expect(saved.success).toBe(true);
		expect(db.state.pond.population).toBe(525);
		expect(db.state.cycle.stockingCount).toBe(525);
		expect(db.prisma.cropCycle.updateMany).toHaveBeenCalledWith({
			where: { pondId: POND, status: "ACTIVE" },
			data: { stockingCount: 525 },
		});

		const live = await getLiveCountForPond(POND);
		expect(live).toEqual({
			stocked: 525,
			dead: 0,
			live: 525,
			source: "crop_cycle",
		});
		expect(live.live).toBe(db.state.pond.population);
	});

	it("calibrates a population-only pond without inventing a cycle", async () => {
		const saved = await updatePondSettings(POND, 3, 2, undefined, 525);

		expect(saved.success).toBe(true);
		expect(db.prisma.cropCycle.updateMany).toHaveBeenCalled();
		expect(db.prisma.cropCycle.create).not.toHaveBeenCalled();

		const live = await getLiveCountForPond(POND);
		expect(live).toEqual({
			stocked: 525,
			dead: 0,
			live: 525,
			source: "legacy_population",
		});
	});

	it("leaves the cycle alone when the save does not touch the fish count", async () => {
		db.state.cycle = { id: "cycle-1", stockingCount: 600, stockingDate: STOCKED_AT };

		const saved = await updatePondSettings(POND, 3, 2);

		expect(saved.success).toBe(true);
		expect(db.prisma.cropCycle.updateMany).not.toHaveBeenCalled();
		expect(db.state.cycle.stockingCount).toBe(600);
	});

	it("does not push a cleared count into the cycle", async () => {
		db.state.cycle = { id: "cycle-1", stockingCount: 600, stockingDate: STOCKED_AT };

		const saved = await updatePondSettings(POND, 3, 2, undefined, null);

		expect(saved.success).toBe(true);
		expect(db.state.pond.population).toBeNull();
		expect(db.prisma.cropCycle.updateMany).not.toHaveBeenCalled();
	});

	it("ignores pre-stocking mortality when reading the calibrated count", async () => {
		db.state.cycle = { id: "cycle-1", stockingCount: 600, stockingDate: STOCKED_AT };
		db.state.logs = [
			{ count: 40, recordedAt: BEFORE },
			{ count: 5, recordedAt: AFTER },
		];

		await updatePondSettings(POND, 3, 2, undefined, 525);

		const live = await getLiveCountForPond(POND);
		expect(live).toEqual({ stocked: 525, dead: 5, live: 520, source: "crop_cycle" });
	});
});
