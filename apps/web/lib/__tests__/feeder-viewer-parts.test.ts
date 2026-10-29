import {
	CAMERA_PRESETS,
	chooseViewerTier,
	feederStatus,
	grainFillScale,
} from "@/lib/feeder/feeder-parts";
import { describe, expect, it } from "vitest";

describe("feeder viewer status", () => {
	const now = new Date("2026-10-29T10:00:00+08:00");

	it("is offline when there has never been a heartbeat or it is over 15 minutes old", () => {
		expect(feederStatus({ isPaused: false, lastSeenAt: null, lastFedAt: null, now })).toBe(
			"offline",
		);
		expect(
			feederStatus({
				isPaused: false,
				lastSeenAt: "2026-10-29T09:44:59+08:00",
				lastFedAt: null,
				now,
			}),
		).toBe("offline");
	});

	it("keeps exactly 15 minutes online, then pauses before dispensing", () => {
		expect(
			feederStatus({
				isPaused: false,
				lastSeenAt: "2026-10-29T09:45:00+08:00",
				lastFedAt: null,
				now,
			}),
		).toBe("idle");
		expect(
			feederStatus({
				isPaused: true,
				lastSeenAt: "2026-10-29T09:59:00+08:00",
				lastFedAt: "2026-10-29T09:59:55+08:00",
				now,
			}),
		).toBe("paused");
	});

	it("marks a dispense under 20 seconds as dispensing", () => {
		expect(
			feederStatus({
				isPaused: false,
				lastSeenAt: "2026-10-29T09:59:00+08:00",
				lastFedAt: "2026-10-29T09:59:45+08:00",
				now,
			}),
		).toBe("dispensing");
	});
});

describe("feeder viewer geometry", () => {
	it("clamps the grain fill and keeps a seed bed at zero", () => {
		expect(grainFillScale(null)).toBeCloseTo(0.02);
		expect(grainFillScale(0)).toBeCloseTo(0.02);
		expect(grainFillScale(50)).toBeCloseTo(0.51);
		expect(grainFillScale(100)).toBeCloseTo(1);
		expect(grainFillScale(150)).toBeCloseTo(1);
	});

	it("offers the six named camera presets", () => {
		expect(Object.keys(CAMERA_PRESETS)).toEqual(["iso", "front", "left", "right", "rear", "top"]);
	});
});

describe("feeder viewer tier", () => {
	it("falls back to the illustration for software WebGL or data saver", () => {
		expect(
			chooseViewerTier({
				webgl2: true,
				renderer: "ANGLE (Google, Vulkan 1.3.0, SwiftShader Device)",
			}),
		).toBe("low");
		expect(chooseViewerTier({ webgl2: true, renderer: "NVIDIA GeForce", saveData: true })).toBe(
			"low",
		);
	});

	it("uses medium on low-memory devices and high on a capable desktop", () => {
		expect(chooseViewerTier({ webgl2: true, renderer: "NVIDIA GeForce", deviceMemory: 2 })).toBe(
			"medium",
		);
		expect(
			chooseViewerTier({
				webgl2: true,
				renderer: "NVIDIA GeForce",
				deviceMemory: 8,
				hardwareConcurrency: 8,
			}),
		).toBe("high");
	});
});
