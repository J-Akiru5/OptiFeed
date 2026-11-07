import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Issue #875: the feed calculator may only use an FCR the logs support.
 *
 * The old action selected the latest FcrReport and passed `fcrValue` straight
 * to `calculateFeedRequirement` (with a `: 0` fallback), so an imported value
 * the logs cannot reproduce sized a real feed request. These tests fail on
 * that behaviour.
 */

const mocks = vi.hoisted(() => ({
	calculateFeedRequirement: vi.fn(),
	getCurrentPondOwnerIdSafe: vi.fn(),
	getLiveCountForPond: vi.fn(),
	pondFindFirst: vi.fn(),
	cropCycleFindFirst: vi.fn(),
	energyDeviceFindMany: vi.fn(),
	feedEventAggregate: vi.fn(),
	feedEventCount: vi.fn(),
	biomassLogFindMany: vi.fn(),
	biomassLogCount: vi.fn(),
	fcrReportFindFirst: vi.fn(),
	// The old action used `findMany`; keeping it mocked makes the regression
	// test fail on the assertion, not on a missing mock method.
	fcrReportFindMany: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({
	getCurrentPondOwnerIdSafe: mocks.getCurrentPondOwnerIdSafe,
}));

vi.mock("@/lib/growth/live-count", () => ({
	getLiveCountForPond: mocks.getLiveCountForPond,
}));

vi.mock("@/lib/fcr-calculation", () => ({
	calculateFeedRequirement: mocks.calculateFeedRequirement,
}));

vi.mock("@/lib/prisma", () => ({
	default: {
		pond: { findFirst: mocks.pondFindFirst },
		cropCycle: { findFirst: mocks.cropCycleFindFirst },
		energyDevice: { findMany: mocks.energyDeviceFindMany },
		feedEvent: { aggregate: mocks.feedEventAggregate, count: mocks.feedEventCount },
		biomassLog: { findMany: mocks.biomassLogFindMany, count: mocks.biomassLogCount },
		fcrReport: {
			findFirst: mocks.fcrReportFindFirst,
			findMany: mocks.fcrReportFindMany,
		},
	},
}));

import { calculateFcrFeed } from "@/lib/actions/fcr";

const PERIOD = {
	periodStart: new Date("2026-09-01T00:00:00.000Z"),
	periodEnd: new Date("2026-10-01T00:00:00.000Z"),
};

const request = {
	pondId: "pond-demo",
	currentWeightKg: 0.05,
	targetWeightKg: 0.25,
	population: 1000,
	days: 60,
};

function storedReport(overrides: Partial<Record<string, unknown>> = {}) {
	return {
		id: "fcr-report-1",
		pondId: "pond-demo",
		...PERIOD,
		totalFeedKg: 0,
		biomassGainKg: 500,
		fcrValue: 1.8,
		...overrides,
	};
}

beforeEach(() => {
	vi.clearAllMocks();

	mocks.getCurrentPondOwnerIdSafe.mockResolvedValue("farm-1");
	mocks.pondFindFirst.mockResolvedValue({ population: 1000 });
	mocks.cropCycleFindFirst.mockResolvedValue(null);
	mocks.energyDeviceFindMany.mockResolvedValue([{ id: "dev-1" }]);
	mocks.feedEventAggregate.mockResolvedValue({ _sum: { grams: 0 } });
	mocks.biomassLogFindMany.mockResolvedValue([]);
	mocks.getLiveCountForPond.mockResolvedValue({
		stocked: 1000,
		dead: 0,
		live: 1000,
		source: "crop_cycle",
	});
	mocks.fcrReportFindFirst.mockResolvedValue(storedReport());
	mocks.fcrReportFindMany.mockResolvedValue([storedReport()]);
	mocks.feedEventCount.mockResolvedValue(0);
	mocks.biomassLogCount.mockResolvedValue(0);
	mocks.calculateFeedRequirement.mockImplementation((input: { currentFcr: number }) => ({
		totalFeedNeededKg: input.currentFcr * 100,
		dailyFeedRationKg: input.currentFcr,
		totalBiomassGainKg: 100,
		dailyBiomassGainKg: 2,
		suggestedFeedingRatePct: 3,
		gramsPerFeeding: 500,
		daysToTarget: 60,
	}));
});

describe("calculateFcrFeed provenance (#875)", () => {
	it("refuses a stored report whose period has no log coverage", async () => {
		const result = await calculateFcrFeed(request);

		expect(result.success).toBe(false);
		expect(result).toMatchObject({ code: "fcr-unverified" });
		expect("error" in result ? result.error : "").toMatch(/can be verified/i);
		expect(mocks.calculateFeedRequirement).not.toHaveBeenCalled();
		expect(result).not.toHaveProperty("latestFcr");
	});

	it("refuses a covered stored report whose ratio contradicts its own totals", async () => {
		mocks.fcrReportFindFirst.mockResolvedValue(
			storedReport({ totalFeedKg: 33.9, biomassGainKg: 153.8, fcrValue: 1.3 }),
		);
		mocks.feedEventCount.mockResolvedValue(4);
		mocks.biomassLogCount.mockResolvedValue(2);

		const result = await calculateFcrFeed(request);

		expect(result.success).toBe(false);
		expect(mocks.calculateFeedRequirement).not.toHaveBeenCalled();
	});

	it("uses the computed FCR instead of a stored report when the window has logs", async () => {
		// 100 kg fed; 10 kg start biomass (0.01 x 1,000) to 180 kg (0.2 x 900)
		// = 170 kg gain -> FCR 100 / 170 = 0.588235...
		mocks.feedEventAggregate.mockResolvedValue({ _sum: { grams: 100_000 } });
		mocks.biomassLogFindMany.mockResolvedValue([
			{ avgWeightKg: 0.01, sampleCount: 30, recordedAt: new Date("2026-09-02T00:00:00Z") },
			{ avgWeightKg: 0.2, sampleCount: 30, recordedAt: new Date("2026-09-30T00:00:00Z") },
		]);
		mocks.getLiveCountForPond.mockResolvedValue({
			stocked: 1000,
			dead: 100,
			live: 900,
			source: "crop_cycle",
		});

		const result = await calculateFcrFeed(request);

		expect(result.success).toBe(true);
		expect(mocks.fcrReportFindFirst).not.toHaveBeenCalled();
		expect(mocks.calculateFeedRequirement).toHaveBeenCalledTimes(1);
		const input = mocks.calculateFeedRequirement.mock.calls[0][0] as { currentFcr: number };
		expect(input.currentFcr).toBeCloseTo(100 / 170, 10);
		expect(result).toMatchObject({ fcrSource: "computed" });
		expect("latestFcr" in result ? result.latestFcr : null).toBeCloseTo(100 / 170, 10);
	});

	it("falls back to a stored value only when its logs reproduce it", async () => {
		mocks.fcrReportFindFirst.mockResolvedValue(
			storedReport({ totalFeedKg: 100, biomassGainKg: 50, fcrValue: 2 }),
		);
		mocks.feedEventCount.mockResolvedValue(3);
		mocks.biomassLogCount.mockResolvedValue(2);

		const result = await calculateFcrFeed(request);

		expect(result.success).toBe(true);
		expect(mocks.calculateFeedRequirement).toHaveBeenCalledWith(
			expect.objectContaining({ currentFcr: 2 }),
		);
		expect(result).toMatchObject({ latestFcr: 2, fcrSource: "stored" });
	});

	it("never falls back to 0 when neither source is usable", async () => {
		mocks.fcrReportFindFirst.mockResolvedValue(null);

		const result = await calculateFcrFeed(request);

		expect(result.success).toBe(false);
		expect(mocks.calculateFeedRequirement).not.toHaveBeenCalled();
		expect(JSON.stringify(result)).not.toContain('"latestFcr":0');
	});
});

describe("calculateFcrFeed existing refusal", () => {
	it("still asks for the fish count before touching FCR", async () => {
		mocks.pondFindFirst.mockResolvedValue({ population: null });

		const result = await calculateFcrFeed({ ...request, population: null });

		expect(result).toMatchObject({
			success: false,
			error: "Set the fish count on this pond before calculating feed.",
		});
		expect(mocks.cropCycleFindFirst).not.toHaveBeenCalled();
	});
});
