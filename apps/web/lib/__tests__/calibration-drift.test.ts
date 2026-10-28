import { describe, expect, it } from "vitest";
import {
	DRIFT_REFILL_JUMP_POINTS,
	DRIFT_THRESHOLD_PCT,
	type DriftLevelSample,
	computeCalibrationDrift,
	levelDropGrams,
} from "../calibration/drift";

const DAY = 24 * 60 * 60 * 1000;
const START = new Date("2026-10-20T00:00:00.000Z");

function feed(grams: number, dayOffset = 0) {
	return { grams, receivedAt: new Date(START.getTime() + dayOffset * DAY) };
}

function level(levelPercent: number, hoursOffset = 0): DriftLevelSample {
	return {
		levelPercent,
		recordedAt: new Date(START.getTime() + hoursOffset * 60 * 60 * 1000),
	};
}

describe("computeCalibrationDrift", () => {
	it("reports ok when the level drop matches the dispensed feed", () => {
		// 3000 g capacity: a 20-point drop is 600 g.
		const result = computeCalibrationDrift({
			feeds: [feed(200, 0), feed(200, 1), feed(200, 2)],
			levels: [level(80, 0), level(60, 48)],
			hopperCapacityG: 3000,
		});

		expect(result).toEqual({
			status: "ok",
			dispensedG: 600,
			observedG: 600,
			diffPct: 0,
		});
	});

	it("reports drift above the 15% threshold", () => {
		// 30 points on a 3000 g hopper = 900 g observed vs 600 g dispensed.
		const result = computeCalibrationDrift({
			feeds: [feed(200, 0), feed(200, 1), feed(200, 2)],
			levels: [level(80, 0), level(50, 48)],
			hopperCapacityG: 3000,
		});

		expect(result.status).toBe("drift");
		expect(result.dispensedG).toBe(600);
		expect(result.observedG).toBe(900);
		expect(result.diffPct).toBe(50);
		expect(Math.abs(result.diffPct ?? 0)).toBeGreaterThan(DRIFT_THRESHOLD_PCT);
	});

	it("reports drift when the hopper barely dropped despite dispensing", () => {
		// 5 points = 150 g observed vs 600 g dispensed = -75%.
		const result = computeCalibrationDrift({
			feeds: [feed(200, 0), feed(200, 1), feed(200, 2)],
			levels: [level(80, 0), level(75, 48)],
			hopperCapacityG: 3000,
		});

		expect(result.status).toBe("drift");
		expect(result.diffPct).toBe(-75);
	});

	it("needs at least three confirmed feeds", () => {
		const result = computeCalibrationDrift({
			feeds: [feed(200, 0), feed(200, 1)],
			levels: [level(80, 0), level(50, 48)],
			hopperCapacityG: 3000,
		});

		expect(result.status).toBe("insufficient_data");
		expect(result.diffPct).toBeNull();
	});

	it("needs a hopper capacity", () => {
		const result = computeCalibrationDrift({
			feeds: [feed(200, 0), feed(200, 1), feed(200, 2)],
			levels: [level(80, 0), level(50, 48)],
			hopperCapacityG: null,
		});

		expect(result.status).toBe("insufficient_data");
		expect(result.observedG).toBe(0);
	});

	it("needs two level readings", () => {
		const result = computeCalibrationDrift({
			feeds: [feed(200, 0), feed(200, 1), feed(200, 2)],
			levels: [level(80, 0)],
			hopperCapacityG: 3000,
		});

		expect(result.status).toBe("insufficient_data");
	});

	it("ignores zero/negative feed rows when counting feeds", () => {
		const result = computeCalibrationDrift({
			feeds: [feed(0, 0), feed(-5, 1), feed(200, 2)],
			levels: [level(80, 0), level(50, 48)],
			hopperCapacityG: 3000,
		});

		expect(result.status).toBe("insufficient_data");
	});

	it("reports insufficient data when the level never dropped", () => {
		const result = computeCalibrationDrift({
			feeds: [feed(200, 0), feed(200, 1), feed(200, 2)],
			levels: [level(80, 0), level(80, 48)],
			hopperCapacityG: 3000,
		});

		expect(result.status).toBe("insufficient_data");
		expect(result.observedG).toBe(0);
	});

	it("excludes refills when summing the observed drop", () => {
		// 80 -> 70 is a 10-point drop; 70 -> 95 is a refill (> 5 point jump);
		// 95 -> 85 is another 10-point drop. Total 20 points = 600 g at 3000 g.
		const result = computeCalibrationDrift({
			feeds: [feed(200, 0), feed(200, 1), feed(200, 2)],
			levels: [level(80, 0), level(70, 12), level(95, 24), level(85, 48)],
			hopperCapacityG: 3000,
		});

		expect(result.status).toBe("ok");
		expect(result.observedG).toBe(600);
		expect(result.diffPct).toBe(0);
	});

	it("sorts readings by time before measuring the drop", () => {
		const result = computeCalibrationDrift({
			feeds: [feed(200, 0), feed(200, 1), feed(200, 2)],
			levels: [level(60, 48), level(80, 0)],
			hopperCapacityG: 3000,
		});

		expect(result.status).toBe("ok");
		expect(result.observedG).toBe(600);
	});
});

describe("levelDropGrams", () => {
	it("treats a jump at the threshold as noise, not a refill", () => {
		const levels = [level(70, 0), level(70 + DRIFT_REFILL_JUMP_POINTS, 1), level(60, 2)];
		// The +5 rise was noise: the hopper really fell from 70 % to 60 %, so
		// the drop is 10 points (100 g at 1,000 g capacity), not 15.
		expect(levelDropGrams(levels, 1000)).toBe(100);
	});

	it("does not count an upward noise spike as extra dispensed feed", () => {
		// 50 → 53 (noise, ignored) → 40: the real drop is 10 points. Measuring
		// each pair's fall would count 13 and overstate the feed by 30 %.
		const levels = [level(50, 0), level(53, 1), level(40, 2)];
		expect(levelDropGrams(levels, 1000)).toBe(100);
	});

	it("keeps measuring from the real peak after several small noise rises", () => {
		const levels = [level(50, 0), level(52, 1), level(54, 2), level(53, 3), level(45, 4)];
		expect(levelDropGrams(levels, 1000)).toBe(50);
	});

	it("starts a new segment at a refill and keeps the drop before it", () => {
		// 80 → 70 = 10 points, refill to 95, then 95 → 85 = 10 points.
		const levels = [level(80, 0), level(70, 1), level(95, 2), level(85, 3)];
		expect(levelDropGrams(levels, 1000)).toBe(200);
	});

	it("returns 0 without a capacity", () => {
		expect(levelDropGrams([level(80, 0), level(60, 1)], 0)).toBe(0);
	});
});
