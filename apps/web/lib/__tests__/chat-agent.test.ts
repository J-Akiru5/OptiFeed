import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildGrowthPlan } from "../growth-plan";

const mocks = vi.hoisted(() => ({
	completeAi: vi.fn(),
	hasPermission: vi.fn(),
	cycleFindFirst: vi.fn(),
}));

vi.mock("@/lib/ai", () => ({
	completeAi: mocks.completeAi,
	stableSessionId: () => "agent-session",
}));

vi.mock("@/lib/auth/permissions", () => ({
	hasPermission: mocks.hasPermission,
}));

vi.mock("@/lib/prisma", () => ({
	default: { cropCycle: { findFirst: mocks.cycleFindFirst } },
}));

import { planAgentAction } from "../chat/agent";

const baseParams = {
	message: "Set our grow-out cycle from May 1 to August 29 with 1000 fish at 330g",
	history: [],
	locale: "en",
	ownerId: "owner-1",
	context: null,
	plan: null,
	pondId: "pond-1",
	pondName: "Pond A",
	areaM2: 100,
	averageDepthM: 1.5,
};

describe("planAgentAction", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.hasPermission.mockResolvedValue(true);
		mocks.cycleFindFirst.mockResolvedValue(null);
	});

	it("turns a create-cycle request into a validated preview", async () => {
		mocks.completeAi.mockResolvedValue({
			content: JSON.stringify({
				kind: "create_crop_cycle",
				args: {
					stockingDate: "2026-05-01",
					stockingCount: 1000,
					stockingAvgWeightG: 10,
					targetHarvestDate: "2026-08-29",
					targetHarvestWeightG: 330,
					expectedSurvivalPct: 90,
				},
			}),
			reasoning: null,
		});

		const result = await planAgentAction(baseParams);

		expect(result.kind).toBe("action");
		if (result.kind !== "action") return;
		expect(result.action.type).toBe("create_crop_cycle");
		expect(result.action.args).toMatchObject({
			pondId: "pond-1",
			stockingDate: "2026-05-01",
			targetHarvestDate: "2026-08-29",
			stockingCount: 1000,
			targetHarvestWeightG: 330,
			growOutDays: 120,
		});
		expect(result.action.fields.some((field) => field.label === "Density")).toBe(true);
		expect(result.action.summary).toContain("Pond A");
	});

	it("asks for a missing target weight instead of inventing one", async () => {
		mocks.completeAi.mockResolvedValue({
			content: JSON.stringify({
				kind: "create_crop_cycle",
				args: {
					stockingDate: "2026-05-01",
					stockingCount: 1000,
					targetHarvestDate: "2026-08-29",
				},
			}),
			reasoning: null,
		});

		const result = await planAgentAction(baseParams);

		expect(result.kind).toBe("clarify");
		if (result.kind !== "clarify") return;
		expect(result.text).toMatch(/target weight/i);
	});

	it("uses update when an active cycle already exists", async () => {
		mocks.cycleFindFirst.mockResolvedValue({
			id: "cycle-1",
			label: "Batch A",
			stockingDate: new Date("2026-05-01T00:00:00Z"),
			stockingCount: 1000,
			stockingAvgWeightG: 10,
			targetHarvestDate: new Date("2026-08-29T00:00:00Z"),
			targetHarvestWeightG: 300,
			expectedSurvivalPct: 90,
			notes: null,
		});
		mocks.completeAi.mockResolvedValue({
			content: JSON.stringify({
				kind: "update_crop_cycle",
				args: { cycleId: "cycle-1", targetHarvestWeightG: 330 },
			}),
			reasoning: null,
		});

		const result = await planAgentAction(baseParams);

		expect(result.kind).toBe("action");
		if (result.kind !== "action") return;
		expect(result.action.type).toBe("update_crop_cycle");
		expect(result.action.args).toMatchObject({
			cycleId: "cycle-1",
			targetHarvestWeightG: 330,
			stockingCount: 1000,
		});
	});

	it("builds a capped feeding adjustment preview", async () => {
		const plan = buildGrowthPlan({
			cycle: {
				id: "cycle-1",
				label: "Batch A",
				stockingDate: "2026-01-01",
				stockingCount: 1000,
				stockingAvgWeightG: 10,
				growOutDays: 120,
				targetHarvestDate: "2026-05-01",
				targetHarvestWeightG: 330,
				expectedSurvivalPct: 90,
			},
			latestSample: {
				id: "sample-2",
				date: "2026-03-02",
				avgWeightG: 170,
				sampleCount: 30,
			},
			previousSample: null,
			population: 1000,
			feedingRatePct: 3,
			feedsPerDay: 3,
			currentGramsPerFeeding: 1000,
			deviceMaxGramsPerFeeding: 5000,
			hasDevice: true,
			latestFcr: 1.5,
			lastAdjustmentAt: "2026-02-10",
			today: "2026-03-02",
			pond: { areaM2: 100, averageDepthM: 1.5, feedPricePerKg: 30 },
		});
		mocks.completeAi.mockResolvedValue({
			content: JSON.stringify({ kind: "apply_growth_plan", args: {} }),
			reasoning: null,
		});

		const result = await planAgentAction({ ...baseParams, plan });

		expect(result.kind).toBe("action");
		if (result.kind !== "action") return;
		expect(result.action.type).toBe("apply_growth_plan");
		expect(result.action.args).toMatchObject({ grams: 1100, pondId: "pond-1" });
	});

	it("falls back to the streaming chat when the planner returns an answer", async () => {
		mocks.completeAi.mockResolvedValue({
			content: JSON.stringify({ kind: "answer" }),
			reasoning: null,
		});

		const result = await planAgentAction(baseParams);

		expect(result.kind).toBe("fallback");
	});
});
