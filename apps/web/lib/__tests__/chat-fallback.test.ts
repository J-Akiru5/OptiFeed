import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	eventFindFirst: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
	default: { deviceStateEvent: { findFirst: mocks.eventFindFirst } },
}));

import { runFallbackIntent } from "../chat/fallback";

const ctx = {
	pondName: "Pond A",
	feedsPerDay: 3,
	feedingRatePct: 3,
	population: 1000,
	totalBiomassG: 100_000,
	scheduleStart: new Date("1970-01-01T06:00:00.000Z"),
	scheduleEnd: new Date("1970-01-01T16:00:00.000Z"),
	deviceOnline: true,
	devicePaused: false,
	hopperLevelPct: 80,
	waterTempC: 28,
	waterTempOk: true,
	latestFcr: 1.4,
	latestAbwG: 100,
	sampleCount: 20,
	feedingsToday: 1,
	lastDispensedAt: null,
	lastCommandStatus: "acked",
	currentGramsPerFeeding: 100,
	predictedFeedGrams: 100,
	predictedFeedReasoning: null,
	lastSampleAt: null,
	isFallow: false,
	cycleLabel: null,
	growOutDay: null,
	daysToHarvest: null,
	targetHarvestDate: null,
	targetHarvestWeightG: null,
	growthPlan: null,
	calibrationDrift: {
		status: "insufficient_data" as const,
		dispensedG: 0,
		observedG: 0,
		diffPct: null,
	},
};

describe("runFallbackIntent", () => {
	it("reports the stored schedule as a wall clock, not as a shifted instant", async () => {
		// 06:00–16:00 stored in a `@db.Time`. Converting it as an instant to
		// Asia/Manila would report 2:00 PM–2:00 AM.
		const reply = await runFallbackIntent({
			message: "when is the next feed?",
			locale: "en",
			ownerId: "owner-1",
			ctx,
		});

		expect(reply).toContain("6:00 AM");
		expect(reply).toContain("4:00 PM");
	});

	it("reports a failed command time in the farm timezone", async () => {
		mocks.eventFindFirst.mockResolvedValue({
			createdAt: new Date("2026-10-27T18:00:00.000Z"),
		});

		const reply = await runFallbackIntent({
			message: "a feeding was missed",
			locale: "en",
			ownerId: "owner-1",
			ctx,
		});

		// 18:00 UTC on 27 Oct is 02:00 on 28 Oct in Manila.
		expect(reply).toContain("Oct 28");
		expect(reply).toContain("2:00 AM");
	});
});
