import { describe, expect, it } from "vitest";

import type { DeviceTelemetryRow } from "@/lib/platform/fleet-health-rules";
import {
	summarizeFleetFaults,
	summarizeTelemetryFreshness,
} from "@/lib/platform/fleet-health-rules";

/**
 * Section C's telemetry summaries are pure: they read the per-device rows the
 * fleet monitor already built, so they add no query and cannot disagree with the
 * device table.
 */

const AT = new Date("2026-11-02T04:00:00.000Z");

function telemetry(overrides: Partial<DeviceTelemetryRow> = {}): DeviceTelemetryRow {
	return {
		id: "dev-1",
		label: "Feeder 1",
		mac: "AA:BB:CC:DD:EE:01",
		pondName: "Pond One",
		tenantId: "org-1",
		tenantName: "Alpha Farm",
		connection: "online",
		lastHeartbeatAt: AT,
		rssiDbm: -55,
		rssiFreshness: "fresh",
		rssiAt: AT,
		firmware: { version: "1.9.0", at: AT, source: "diag" },
		lastFeedAt: AT,
		feedLevel: { percent: 70, at: AT, freshness: "fresh" },
		waterTemp: { celsius: 27.5, at: AT, freshness: "fresh", probeOk: true },
		health: null,
		...overrides,
	};
}

describe("summarizeTelemetryFreshness", () => {
	it("counts fresh, stale and never-reported readings per metric", () => {
		const rows = [
			telemetry({ id: "dev-1" }),
			telemetry({
				id: "dev-2",
				rssiFreshness: "stale",
				rssiDbm: null,
				feedLevel: { percent: null, at: null, freshness: "none" },
				waterTemp: null,
			}),
			telemetry({
				id: "dev-3",
				rssiFreshness: "none",
				rssiDbm: null,
				feedLevel: { percent: 40, at: AT, freshness: "stale" },
				waterTemp: { celsius: 26, at: AT, freshness: "stale", probeOk: false },
			}),
		];

		const summary = summarizeTelemetryFreshness(rows);

		expect(summary.devices).toBe(3);
		expect(summary.rssi).toEqual({ fresh: 1, stale: 1, none: 1, total: 3 });
		expect(summary.feedLevel).toEqual({ fresh: 1, stale: 1, none: 1, total: 3 });
		// A null waterTemp is "none": the data cannot distinguish no probe from
		// a probe that never reported.
		expect(summary.waterTemp).toEqual({ fresh: 1, stale: 1, none: 1, total: 3 });
	});

	it("returns zeroed histograms for an empty fleet", () => {
		const summary = summarizeTelemetryFreshness([]);

		expect(summary).toEqual({
			devices: 0,
			rssi: { fresh: 0, stale: 0, none: 0, total: 0 },
			feedLevel: { fresh: 0, stale: 0, none: 0, total: 0 },
			waterTemp: { fresh: 0, stale: 0, none: 0, total: 0 },
		});
	});
});

describe("summarizeFleetFaults", () => {
	it("counts current faults across units, highest first", () => {
		const rows = [
			telemetry({
				id: "dev-1",
				health: { safeMode: false, faults: ["hopper_sensor", "rtc"], since: AT },
			}),
			telemetry({
				id: "dev-2",
				health: { safeMode: false, faults: ["hopper_sensor"], since: AT },
			}),
			telemetry({ id: "dev-3", health: null }),
		];

		expect(summarizeFleetFaults(rows)).toEqual([
			{ fault: "hopper_sensor", devices: 2 },
			{ fault: "rtc", devices: 1 },
		]);
	});

	it("returns an empty distribution when no unit reports a fault", () => {
		expect(summarizeFleetFaults([telemetry({ health: null })])).toEqual([]);
		expect(summarizeFleetFaults([])).toEqual([]);
	});
});
