import { describe, expect, it } from "vitest";

import { previewWaterTempC, rawWaterTempC } from "@/lib/calibration/water-temp";

/**
 * The offset is applied once, on the device (#622). These helpers are the only
 * place the app removes or re-applies it, so the arithmetic is pinned here.
 */

describe("rawWaterTempC", () => {
	it("removes the offset the firmware applied", () => {
		// Firmware: 29.2 + (-0.7) = 28.5 transmitted and stored.
		expect(rawWaterTempC(28.5, -0.7)).toBeCloseTo(29.2, 5);
	});

	it("removes a positive offset", () => {
		expect(rawWaterTempC(28.5, 0.5)).toBeCloseTo(28.0, 5);
	});

	it("leaves the reading alone when no offset is stored", () => {
		expect(rawWaterTempC(27.8, 0)).toBe(27.8);
	});

	it("returns NaN for a non-finite reading and treats a bad offset as zero", () => {
		expect(rawWaterTempC(Number.NaN, -0.7)).toBeNaN();
		expect(rawWaterTempC(27.8, Number.NaN)).toBe(27.8);
	});
});

describe("previewWaterTempC", () => {
	it("returns the reported reading when the draft offset is the stored one", () => {
		expect(previewWaterTempC(28.5, -0.7, -0.7)).toBeCloseTo(28.5, 5);
	});

	it("previews a new offset on top of the true raw value", () => {
		// Raw 29.2 with no offset would read 29.2, not 28.5 + 0.
		expect(previewWaterTempC(28.5, -0.7, 0)).toBeCloseTo(29.2, 5);
		expect(previewWaterTempC(28.5, -0.7, -1.2)).toBeCloseTo(28.0, 5);
	});

	it("is not affected by adding the offset twice", () => {
		// The old bug: 28.5 + (-0.7) = 27.8.
		expect(previewWaterTempC(28.5, -0.7, -0.7)).not.toBeCloseTo(27.8, 5);
	});

	it("returns NaN when a reading is missing or the draft is not a number", () => {
		expect(previewWaterTempC(Number.NaN, -0.7, -0.7)).toBeNaN();
		expect(previewWaterTempC(28.5, -0.7, Number.NaN)).toBeNaN();
	});
});
