import {
	CAMERA_PRESETS,
	type FeederStatus,
	chooseViewerTier,
	feederComponentStatus,
	feederStatus,
	grainFillScale,
} from "@/lib/feeder/feeder-parts";
import { describe, expect, it } from "vitest";

describe("feeder viewer status", () => {
	const now = new Date("2026-10-29T10:00:00+08:00");

	it("is offline when there has never been a heartbeat or silence passes the grace window", () => {
		expect(feederStatus({ isPaused: false, lastSeenAt: null, lastFedAt: null, now })).toBe(
			"offline",
		);
		expect(
			feederStatus({
				isPaused: false,
				lastSeenAt: "2026-10-29T09:42:59+08:00",
				lastFedAt: null,
				now,
			}),
		).toBe("offline");
	});

	it("shows weak signal for a late heartbeat instead of flipping to offline", () => {
		expect(
			feederStatus({
				isPaused: false,
				lastSeenAt: "2026-10-29T09:45:00+08:00",
				lastFedAt: null,
				now,
			}),
		).toBe("weak");
		expect(
			feederStatus({
				isPaused: false,
				lastSeenAt: "2026-10-29T09:43:00+08:00",
				lastFedAt: null,
				now,
			}),
		).toBe("weak");
	});

	it("pauses before dispensing while the heartbeat is fresh", () => {
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

	it("points the ISO preset at the front-left angle", () => {
		expect(CAMERA_PRESETS.iso[0]).toBeLessThan(0);
		expect(CAMERA_PRESETS.iso[2]).toBeGreaterThan(0);
	});
});

describe("feeder viewer component status", () => {
	function summary(status: FeederStatus, level: number | null) {
		return feederComponentStatus({ status, level }).map(({ id, state, percent }) => [
			id,
			state,
			percent,
		]);
	}

	it("keeps the last hopper reading while every component is offline", () => {
		expect(summary("offline", 30)).toEqual([
			["hopper", "lastKnown", 30],
			["sensor", "lastKnown", 30],
			["controller", "offline", null],
			["motor", "offline", null],
			["auger", "offline", null],
			["outlet", "offline", null],
		]);
	});

	it("reports an idle feeder as online, idle and ready", () => {
		expect(summary("idle", 30)).toEqual([
			["hopper", "live", 30],
			["sensor", "live", 30],
			["controller", "online", null],
			["motor", "idle", null],
			["auger", "idle", null],
			["outlet", "ready", null],
		]);
	});

	it("reports a dispensing feeder as running with an open outlet", () => {
		expect(summary("dispensing", 30).slice(2)).toEqual([
			["controller", "online", null],
			["motor", "running", null],
			["auger", "running", null],
			["outlet", "dispensing", null],
		]);
	});

	it("reports a paused feeder as paused everywhere", () => {
		expect(summary("paused", 30)).toEqual([
			["hopper", "live", 30],
			["sensor", "live", 30],
			["controller", "paused", null],
			["motor", "paused", null],
			["auger", "paused", null],
			["outlet", "paused", null],
		]);
	});

	it("has no hopper reading when the level is missing, online or offline", () => {
		for (const status of ["idle", "offline"] as const) {
			const [hopper, sensor] = summary(status, null);
			expect(hopper).toEqual(["hopper", "noReading", null]);
			expect(sensor).toEqual(["sensor", "noReading", null]);
		}
	});

	it("clamps the reported hopper percentage", () => {
		expect(summary("idle", 150)[0]).toEqual(["hopper", "live", 100]);
		expect(summary("idle", -5)[0]).toEqual(["hopper", "live", 0]);
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
