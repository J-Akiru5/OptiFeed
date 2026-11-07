import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Issue #875: coverage is derived at read time from the rows in the stored
 * report's own period. The query predicates matter as much as the arithmetic —
 * a zero-gram event is not feed evidence, and a sample outside the window does
 * not close the gain.
 */

const mocks = vi.hoisted(() => ({
	energyDeviceFindMany: vi.fn(),
	feedEventCount: vi.fn(),
	feedEventFindMany: vi.fn(),
	biomassLogCount: vi.fn(),
	biomassLogFindMany: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
	default: {
		energyDevice: { findMany: mocks.energyDeviceFindMany },
		feedEvent: { count: mocks.feedEventCount, findMany: mocks.feedEventFindMany },
		biomassLog: { count: mocks.biomassLogCount, findMany: mocks.biomassLogFindMany },
	},
}));

import { loadStoredFcrAssessments, storedFcrCoverageForReport } from "@/lib/analytics/fcr";

const SEP = new Date("2026-09-01T00:00:00.000Z");
const OCT = new Date("2026-10-01T00:00:00.000Z");
const NOV = new Date("2026-11-01T00:00:00.000Z");

function report(id: string, from: Date, to: Date) {
	return {
		id,
		periodStart: from,
		periodEnd: to,
		// Consistent totals, so only coverage decides the label.
		totalFeedKg: 100,
		biomassGainKg: 50,
		fcrValue: 2,
	};
}

beforeEach(() => {
	vi.clearAllMocks();
	mocks.energyDeviceFindMany.mockResolvedValue([{ id: "dev-1" }]);
	mocks.feedEventCount.mockResolvedValue(0);
	mocks.biomassLogCount.mockResolvedValue(0);
	mocks.feedEventFindMany.mockResolvedValue([]);
	mocks.biomassLogFindMany.mockResolvedValue([]);
});

describe("storedFcrCoverageForReport", () => {
	it("counts only positive dispensed feed events inside the report period", async () => {
		mocks.feedEventCount.mockResolvedValue(5);
		mocks.biomassLogCount.mockResolvedValue(8);

		const coverage = await storedFcrCoverageForReport("pond-1", report("r1", SEP, OCT));

		expect(coverage).toEqual({ feedEvents: 5, biomassSamples: 8 });
		expect(mocks.feedEventCount).toHaveBeenCalledWith({
			where: {
				deviceId: { in: ["dev-1"] },
				eventType: "feed_dispensed",
				grams: { gt: 0 },
				// Same scope as the computed feed: seed/synthetic are artefacts.
				dataSource: { notIn: ["seed", "synthetic"] },
				receivedAt: { gte: SEP, lte: OCT },
			},
		});
		expect(mocks.biomassLogCount).toHaveBeenCalledWith({
			where: { pondId: "pond-1", recordedAt: { gte: SEP, lte: OCT } },
		});
	});

	it("returns zero coverage for a report with no usable period without querying", async () => {
		const coverage = await storedFcrCoverageForReport("pond-1", {
			...report("r1", SEP, OCT),
			periodStart: null,
		});

		expect(coverage).toEqual({ feedEvents: 0, biomassSamples: 0 });
		expect(mocks.feedEventCount).not.toHaveBeenCalled();
		expect(mocks.biomassLogCount).not.toHaveBeenCalled();
	});
});

describe("loadStoredFcrAssessments", () => {
	it("attributes each log row to the report window that contains it", async () => {
		const reports = [report("r2", OCT, NOV), report("r1", SEP, OCT)];
		mocks.feedEventFindMany.mockResolvedValue([
			// R1 only.
			{ receivedAt: new Date("2026-09-15T00:00:00.000Z") },
			// Boundary: included in both periods (inclusive windows).
			{ receivedAt: OCT },
			// R2 only.
			{ receivedAt: new Date("2026-10-15T00:00:00.000Z") },
		]);
		mocks.biomassLogFindMany.mockResolvedValue([
			// Two samples per period: one to start the gain, one to close it.
			{ recordedAt: new Date("2026-09-05T00:00:00.000Z") },
			{ recordedAt: new Date("2026-09-20T00:00:00.000Z") },
			{ recordedAt: new Date("2026-10-10T00:00:00.000Z") },
			{ recordedAt: new Date("2026-10-20T00:00:00.000Z") },
		]);

		const assessments = await loadStoredFcrAssessments("pond-1", reports, {
			deviceIds: ["dev-1"],
		});

		// Order is preserved: newest report first.
		expect(assessments.map((assessment) => assessment.report.id)).toEqual(["r2", "r1"]);
		expect(assessments[0].coverage).toEqual({ feedEvents: 2, biomassSamples: 2 });
		expect(assessments[1].coverage).toEqual({ feedEvents: 2, biomassSamples: 2 });
		// Both periods have coverage; the arithmetic is consistent.
		expect(assessments.every((assessment) => assessment.verified)).toBe(true);
		// The bulk read uses the same artefact exclusion as the computed feed.
		const where = mocks.feedEventFindMany.mock.calls[0][0].where;
		expect(where.dataSource).toEqual({ notIn: ["seed", "synthetic"] });
		// The caller supplied the devices, so no duplicate lookup.
		expect(mocks.energyDeviceFindMany).not.toHaveBeenCalled();
	});

	it("marks a report with no dates as uncovered instead of crashing", async () => {
		const assessments = await loadStoredFcrAssessments("pond-1", [
			{ ...report("r1", SEP, OCT), periodStart: undefined, periodEnd: undefined },
		]);

		expect(assessments[0].verified).toBe(false);
		expect(assessments[0].coverage).toEqual({ feedEvents: 0, biomassSamples: 0 });
	});
});
