import {
	CAMERA_MAX_DISTANCE,
	CAMERA_MIN_DISTANCE,
	CAMERA_PAN_BOUNDS,
	CAMERA_TARGET,
	FEEDER_CAMERA_LOCK_KEY,
	FITTED_CAMERA_DISTANCE,
	parseCameraLocked,
} from "@/components/feeder/feeder-viewer";
import { CAMERA_PRESETS, type CameraPreset } from "@/lib/feeder/feeder-parts";
import { describe, expect, it } from "vitest";

/**
 * #623: the viewer's camera is locked by default, unlocks only on an explicit
 * stored `"false"`, zooms around the fitted ISO distance and cannot be panned
 * away from the feeder.
 */
describe("feeder camera lock", () => {
	it("persists under the documented storage key", () => {
		expect(FEEDER_CAMERA_LOCK_KEY).toBe("feeder-viewer:locked");
	});

	it("treats a missing, blank or unreadable value as locked", () => {
		expect(parseCameraLocked(null)).toBe(true);
		expect(parseCameraLocked(undefined)).toBe(true);
		expect(parseCameraLocked("")).toBe(true);
		expect(parseCameraLocked("true")).toBe(true);
	});

	it("unlocks only on an explicit false", () => {
		expect(parseCameraLocked("false")).toBe(false);
	});
});

describe("feeder camera bounds", () => {
	const distanceToTarget = (preset: CameraPreset) =>
		Math.hypot(
			CAMERA_PRESETS[preset][0] - CAMERA_TARGET[0],
			CAMERA_PRESETS[preset][1] - CAMERA_TARGET[1],
			CAMERA_PRESETS[preset][2] - CAMERA_TARGET[2],
		);

	it("fits the ISO preset at the fitted distance", () => {
		expect(distanceToTarget("iso")).toBeCloseTo(FITTED_CAMERA_DISTANCE, 6);
	});

	it("bounds the dolly range around the fitted distance", () => {
		expect(CAMERA_MIN_DISTANCE).toBeLessThan(FITTED_CAMERA_DISTANCE);
		expect(CAMERA_MAX_DISTANCE).toBeGreaterThan(FITTED_CAMERA_DISTANCE);
	});

	it("keeps every preset inside the dolly range, so a switch is never clamped", () => {
		for (const preset of Object.keys(CAMERA_PRESETS) as CameraPreset[]) {
			const distance = distanceToTarget(preset);
			expect(distance, preset).toBeGreaterThanOrEqual(CAMERA_MIN_DISTANCE);
			expect(distance, preset).toBeLessThanOrEqual(CAMERA_MAX_DISTANCE);
		}
	});

	it("bounds the orbit target to the feeder footprint", () => {
		const [minX, minY, minZ] = CAMERA_PAN_BOUNDS.min;
		const [maxX, maxY, maxZ] = CAMERA_PAN_BOUNDS.max;

		expect(minX).toBeLessThan(CAMERA_TARGET[0]);
		expect(maxX).toBeGreaterThan(CAMERA_TARGET[0]);
		expect(minY).toBeLessThan(CAMERA_TARGET[1]);
		expect(maxY).toBeGreaterThan(CAMERA_TARGET[1]);
		expect(minZ).toBeLessThan(CAMERA_TARGET[2]);
		expect(maxZ).toBeGreaterThan(CAMERA_TARGET[2]);

		// A truck stop that stays on the base plate; the feeder cannot leave frame.
		expect(maxX - minX).toBeLessThanOrEqual(0.8);
		expect(maxZ - minZ).toBeLessThanOrEqual(0.8);
	});
});
