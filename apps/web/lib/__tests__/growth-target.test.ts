import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
	ponds: new Map<string, { id: string; ownerId: string; notificationPrefs: unknown }>(),
	cycles: [] as { id: string; pondId: string; status: string }[],
	writes: 0,
}));

vi.mock("@/lib/prisma", () => ({
	default: {
		pond: {
			findFirst: vi.fn(async ({ where }: { where: { id: string; ownerId: string } }) => {
				const pond = state.ponds.get(where.id);
				if (!pond || pond.ownerId !== where.ownerId) return null;
				return { id: pond.id, notificationPrefs: pond.notificationPrefs };
			}),
			updateMany: vi.fn(
				async ({
					where,
					data,
				}: {
					where: { id: string; ownerId?: string };
					data: { notificationPrefs: unknown };
				}) => {
					const pond = state.ponds.get(where.id);
					if (!pond) return { count: 0 };
					if (where.ownerId !== undefined && pond.ownerId !== where.ownerId) {
						return { count: 0 };
					}
					pond.notificationPrefs = data.notificationPrefs;
					state.writes += 1;
					return { count: 1 };
				},
			),
		},
		cropCycle: {
			findFirst: vi.fn(
				async ({ where }: { where: { pondId: string; status: string } }) =>
					state.cycles.find(
						(cycle) => cycle.pondId === where.pondId && cycle.status === where.status,
					) ?? null,
			),
		},
	},
}));

vi.mock("@/lib/auth/session", () => ({
	requireWriteAccess: vi.fn(),
	getCurrentPondOwnerId: vi.fn(),
}));

vi.mock("@/lib/auth/permissions", () => ({
	requirePermission: vi.fn(),
}));

vi.mock("next/cache", () => ({
	revalidatePath: vi.fn(),
}));

import { clearGrowthTarget, setGrowthTarget } from "@/lib/actions/growth-target";
import { requirePermission } from "@/lib/auth/permissions";
import { getCurrentPondOwnerId, requireWriteAccess } from "@/lib/auth/session";
import { toPredictionCycleContext } from "@/lib/crop-cycle/prediction-context";
import {
	growthTargetInputSchema,
	savedTargetWeightForCycle,
	targetWeightGrams,
} from "@/lib/growth-target";
import { clearGrowthTargetForPond, saveGrowthTargetForPond } from "@/lib/growth-target-store";
import { parsePondGrowthTarget, parsePondProfile } from "@/lib/pond-profile";

const NOW = new Date("2026-10-29T08:00:00.000Z");

function seed() {
	state.ponds.clear();
	state.cycles.length = 0;
	state.writes = 0;
	state.ponds.set("pond-a", {
		id: "pond-a",
		ownerId: "farm-1",
		notificationPrefs: {
			missedFeeding: true,
			profile: { areaM2: 100, averageDepthM: 1.5, feedPricePerKg: 30 },
		},
	});
	state.ponds.set("pond-b", {
		id: "pond-b",
		ownerId: "farm-1",
		notificationPrefs: { profile: { areaM2: 50 } },
	});
	state.ponds.set("pond-other", {
		id: "pond-other",
		ownerId: "farm-2",
		notificationPrefs: { profile: {} },
	});
	state.cycles.push(
		{ id: "cycle-a", pondId: "pond-a", status: "ACTIVE" },
		{ id: "cycle-b", pondId: "pond-b", status: "ACTIVE" },
	);
}

function prefsOf(pondId: string): unknown {
	return state.ponds.get(pondId)?.notificationPrefs;
}

beforeEach(() => {
	seed();
	vi.clearAllMocks();
	vi.mocked(requireWriteAccess).mockResolvedValue(undefined);
	vi.mocked(requirePermission).mockResolvedValue(undefined);
	vi.mocked(getCurrentPondOwnerId).mockResolvedValue("farm-1");
});

describe("growthTargetInputSchema", () => {
	it("accepts a realistic target with a population", () => {
		const parsed = growthTargetInputSchema.safeParse({
			targetWeightKg: 0.35,
			population: 1000,
		});
		expect(parsed.success).toBe(true);
	});

	it("rejects a missing, zero or out-of-range target weight", () => {
		expect(growthTargetInputSchema.safeParse({ population: 1000 }).success).toBe(false);
		expect(growthTargetInputSchema.safeParse({ targetWeightKg: 0 }).success).toBe(false);
		expect(growthTargetInputSchema.safeParse({ targetWeightKg: -1 }).success).toBe(false);
		expect(growthTargetInputSchema.safeParse({ targetWeightKg: 10.5 }).success).toBe(false);
	});

	it("rejects a fractional population", () => {
		expect(
			growthTargetInputSchema.safeParse({ targetWeightKg: 0.35, population: 10.5 }).success,
		).toBe(false);
	});

	it("stores tenths of a gram", () => {
		expect(targetWeightGrams(0.35)).toBe(350);
		expect(targetWeightGrams(0.33333)).toBe(333.3);
	});
});

describe("pond growth target storage", () => {
	it("round-trips through the JSON bridge without disturbing the profile", async () => {
		const result = await saveGrowthTargetForPond({
			pondId: "pond-a",
			ownerId: "farm-1",
			input: { targetWeightKg: 0.35, population: 1000 },
			now: NOW,
		});

		expect(result.success).toBe(true);
		const saved = parsePondGrowthTarget(prefsOf("pond-a"));
		expect(saved).toEqual({
			targetWeightG: 350,
			population: 1000,
			cycleId: "cycle-a",
			setAt: NOW.toISOString(),
		});
		expect(parsePondProfile(prefsOf("pond-a")).areaM2).toBe(100);
		const prefs = prefsOf("pond-a") as { missedFeeding?: boolean };
		expect(prefs.missedFeeding).toBe(true);
	});

	it("keeps each pond's target separate", async () => {
		await saveGrowthTargetForPond({
			pondId: "pond-a",
			ownerId: "farm-1",
			input: { targetWeightKg: 0.35, population: 1000 },
			now: NOW,
		});
		await saveGrowthTargetForPond({
			pondId: "pond-b",
			ownerId: "farm-1",
			input: { targetWeightKg: 0.5, population: 500 },
			now: NOW,
		});

		expect(parsePondGrowthTarget(prefsOf("pond-a"))?.targetWeightG).toBe(350);
		expect(parsePondGrowthTarget(prefsOf("pond-b"))?.targetWeightG).toBe(500);
		expect(parsePondGrowthTarget(prefsOf("pond-other"))).toBeNull();
	});

	it("denies a write for a pond owned by another tenant", async () => {
		const result = await saveGrowthTargetForPond({
			pondId: "pond-a",
			ownerId: "farm-2",
			input: { targetWeightKg: 0.35, population: 1000 },
			now: NOW,
		});

		expect(result).toEqual({ success: false, error: "Pond not found." });
		expect(state.writes).toBe(0);
		expect(parsePondGrowthTarget(prefsOf("pond-a"))).toBeNull();
	});

	it("refuses to save before a grow-out cycle exists", async () => {
		state.cycles.splice(0, state.cycles.length, {
			id: "cycle-b",
			pondId: "pond-b",
			status: "ACTIVE",
		});

		const result = await saveGrowthTargetForPond({
			pondId: "pond-a",
			ownerId: "farm-1",
			input: { targetWeightKg: 0.35, population: 1000 },
			now: NOW,
		});

		expect(result.success).toBe(false);
		expect(result.error).toMatch(/grow-out cycle/i);
		expect(state.writes).toBe(0);
	});

	it("clears only the target and keeps the rest of the profile", async () => {
		await saveGrowthTargetForPond({
			pondId: "pond-a",
			ownerId: "farm-1",
			input: { targetWeightKg: 0.35, population: 1000 },
			now: NOW,
		});

		const cleared = await clearGrowthTargetForPond({ pondId: "pond-a", ownerId: "farm-1" });

		expect(cleared.success).toBe(true);
		expect(parsePondGrowthTarget(prefsOf("pond-a"))).toBeNull();
		expect(parsePondProfile(prefsOf("pond-a")).areaM2).toBe(100);
	});

	it("denies a clear for a pond owned by another tenant", async () => {
		await saveGrowthTargetForPond({
			pondId: "pond-a",
			ownerId: "farm-1",
			input: { targetWeightKg: 0.35, population: 1000 },
			now: NOW,
		});
		const writesBefore = state.writes;

		const cleared = await clearGrowthTargetForPond({ pondId: "pond-a", ownerId: "farm-2" });

		expect(cleared).toEqual({ success: false, error: "Pond not found." });
		expect(state.writes).toBe(writesBefore);
		expect(parsePondGrowthTarget(prefsOf("pond-a"))?.targetWeightG).toBe(350);
	});
});

describe("savedTargetWeightForCycle", () => {
	const prefs = {
		profile: {
			growthTarget: {
				targetWeightG: 400,
				population: 1000,
				cycleId: "cycle-a",
				setAt: NOW.toISOString(),
			},
		},
	};
	const cycle = {
		id: "cycle-a",
		label: null,
		stockingDate: "2026-01-01",
		stockingCount: 1000,
		growOutDays: 120,
		targetHarvestDate: "2026-05-01",
		targetHarvestWeightG: 330,
		expectedSurvivalPct: 90,
	};

	it("returns the saved weight for the cycle it belongs to", () => {
		expect(savedTargetWeightForCycle(prefs, "cycle-a")).toBe(400);
	});

	it("ignores a target saved for a different cycle", () => {
		expect(savedTargetWeightForCycle(prefs, "cycle-b")).toBeNull();
	});

	it("returns null when nothing is saved", () => {
		expect(savedTargetWeightForCycle({}, "cycle-a")).toBeNull();
		expect(savedTargetWeightForCycle(null, "cycle-a")).toBeNull();
	});

	it("feeds the prediction context without changing the harvest date", () => {
		const savedWeightG = savedTargetWeightForCycle(prefs, cycle.id) ?? cycle.targetHarvestWeightG;
		const context = toPredictionCycleContext(
			{ ...cycle, targetHarvestWeightG: savedWeightG },
			"2026-03-02",
		);

		expect(context.targetHarvestWeightG).toBe(400);
		expect(context.targetHarvestDate).toBe("2026-05-01");
		// 400 g x 1,000 fish x 90% survival.
		expect(context.projectedHarvestBiomassKg).toBe(360);
	});
});

describe("growth target action guards", () => {
	it("allows an operator with the crop-cycle permission", async () => {
		const result = await setGrowthTarget("pond-a", { targetWeightKg: 0.35, population: 1000 });

		expect(result.success).toBe(true);
		expect(requirePermission).toHaveBeenCalledWith("manage_crop_cycle");
		expect(parsePondGrowthTarget(prefsOf("pond-a"))?.targetWeightG).toBe(350);
	});

	it("denies a caller without write access", async () => {
		vi.mocked(requireWriteAccess).mockRejectedValueOnce(new Error("Write access required"));

		const result = await setGrowthTarget("pond-a", { targetWeightKg: 0.35, population: 1000 });

		expect(result.success).toBe(false);
		expect(state.writes).toBe(0);
	});

	it("denies a caller without manage_crop_cycle", async () => {
		vi.mocked(requirePermission).mockRejectedValueOnce(new Error("Forbidden"));

		const result = await setGrowthTarget("pond-a", { targetWeightKg: 0.35, population: 1000 });

		expect(result.success).toBe(false);
		expect(state.writes).toBe(0);
	});

	it("allows clearing a target and denies clearing without write access", async () => {
		await setGrowthTarget("pond-a", { targetWeightKg: 0.35, population: 1000 });

		vi.mocked(requireWriteAccess).mockRejectedValueOnce(new Error("Write access required"));
		const denied = await clearGrowthTarget("pond-a");
		expect(denied.success).toBe(false);
		expect(parsePondGrowthTarget(prefsOf("pond-a"))?.targetWeightG).toBe(350);

		const allowed = await clearGrowthTarget("pond-a");
		expect(allowed.success).toBe(true);
		expect(parsePondGrowthTarget(prefsOf("pond-a"))).toBeNull();
	});
});
