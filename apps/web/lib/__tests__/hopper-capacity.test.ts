import {
	DEFAULT_HOPPER_BULK_DENSITY_G_CM3,
	HOPPER_DENSITY_G_CM3_MAX,
	hopperCapacityFromGeometry,
	hopperUsableVolumeCm3,
	hopperUsableVolumeL,
} from "@/lib/hopper-capacity";
import { describe, expect, it } from "vitest";

/**
 * Issue #415: the hopper capacity is computed from the tank geometry (a
 * cylinder between the full and empty marks) and the feed bulk density, so the
 * stored gram figure no longer has to be guessed.
 */
describe("hopper capacity from tank geometry", () => {
	it("computes the cylinder volume between the full and empty marks", () => {
		// 20 cm tank, 25 cm of usable height: π · 10² · 25 = 7,853.98 cm³.
		const cm3 = hopperUsableVolumeCm3({ diameterCm: 20, fullCm: 5, emptyCm: 30 });

		expect(cm3).toBeCloseTo(7853.98, 1);
		expect(hopperUsableVolumeL({ diameterCm: 20, fullCm: 5, emptyCm: 30 })).toBeCloseTo(7.854, 3);
	});

	it("turns the volume into grams with the feed density", () => {
		// 7,853.98 cm³ · 0.65 g/cm³ = 5,105.09 g, stored as whole grams.
		expect(hopperCapacityFromGeometry({ diameterCm: 20, fullCm: 5, emptyCm: 30 }, 0.65)).toBe(5105);
		expect(hopperCapacityFromGeometry({ diameterCm: 20, fullCm: 5, emptyCm: 30 }, 0.6)).toBe(4712);
	});

	it("defaults the density to a typical floating pellet", () => {
		expect(DEFAULT_HOPPER_BULK_DENSITY_G_CM3).toBe(0.65);
		expect(hopperCapacityFromGeometry({ diameterCm: 20, fullCm: 5, emptyCm: 30 })).toBe(5105);
	});

	it("scales with the square of the diameter", () => {
		const narrow = hopperCapacityFromGeometry({ diameterCm: 10, fullCm: 5, emptyCm: 30 }, 0.6);
		const wide = hopperCapacityFromGeometry({ diameterCm: 20, fullCm: 5, emptyCm: 30 }, 0.6);

		expect(narrow).toBe(1178);
		expect(wide).toBe(4712);
		expect(wide).toBe((narrow as number) * 4);
	});

	it("returns null instead of a fake number for unusable geometry", () => {
		expect(hopperUsableVolumeCm3({ diameterCm: null, fullCm: 5, emptyCm: 30 })).toBeNull();
		expect(hopperUsableVolumeCm3({ diameterCm: 20, fullCm: null, emptyCm: 30 })).toBeNull();
		expect(hopperUsableVolumeCm3({ diameterCm: 20, fullCm: 5, emptyCm: Number.NaN })).toBeNull();
		expect(hopperUsableVolumeCm3({ diameterCm: 0, fullCm: 5, emptyCm: 30 })).toBeNull();
		expect(hopperUsableVolumeCm3({ diameterCm: -20, fullCm: 5, emptyCm: 30 })).toBeNull();
		// Empty must be deeper than full; equal marks mean no usable height.
		expect(hopperUsableVolumeCm3({ diameterCm: 20, fullCm: 30, emptyCm: 30 })).toBeNull();
		expect(hopperUsableVolumeCm3({ diameterCm: 20, fullCm: 30, emptyCm: 5 })).toBeNull();
	});

	it("rejects a density outside the plausible feed range", () => {
		const geometry = { diameterCm: 20, fullCm: 5, emptyCm: 30 };

		expect(hopperCapacityFromGeometry(geometry, 0.1)).toBeNull();
		expect(hopperCapacityFromGeometry(geometry, HOPPER_DENSITY_G_CM3_MAX + 0.01)).toBeNull();
		expect(hopperCapacityFromGeometry(geometry, Number.POSITIVE_INFINITY)).toBeNull();
		expect(hopperCapacityFromGeometry(geometry, HOPPER_DENSITY_G_CM3_MAX)).not.toBeNull();
	});
});
