import { describe, expect, it } from "vitest";
import { DEFAULT_DEVICE_STATUS_POLICY, deviceStatusPolicyFromValue } from "../device-status";
import {
	ACTIVE_DEVICE_WINDOW_DAYS,
	CONNECTIVITY_RETENTION_DAYS,
	activeDeviceCutoff,
	addUtcDays,
	buildConnectivitySnapshot,
	buildConnectivityTrend,
	buildTrendPoint,
	connectivityThresholds,
	lastCompletedUtcDays,
	normalizeRollupMarker,
	parseUtcDayKey,
	planConnectivityRollupDays,
	startOfUtcDay,
	summarizeDeviceDay,
	utcDayKey,
} from "../platform/connectivity-rules";

/**
 * Connectivity history rules (issue #479, M3C.10; decisions O22 and O24).
 *
 * The point of these tests is that the day is a UTC day, that "active" is the
 * agreed 30-day heartbeat-or-feed rule, that a gap is derived from the platform
 * settings instead of a new number, and that a day with no stored rows stays
 * missing instead of becoming a zero.
 */

const NOW = new Date("2026-11-02T12:00:00.000Z");
const POLICY = deviceStatusPolicyFromValue({ weakAfterMin: 4, offlineAfterMin: 5, graceMin: 0 });
// Stored cadence 5 min + two 5 s firmware beats of slack.
const THRESHOLDS = connectivityThresholds(POLICY, 5);
const MINUTE = 60 * 1000;

function at(day: string, hour = 0, minute = 0, second = 0): Date {
	return new Date(
		`${day}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:${String(second).padStart(2, "0")}.000Z`,
	);
}

describe("UTC day boundaries", () => {
	it("rounds down to UTC midnight, not the local midnight", () => {
		expect(startOfUtcDay(new Date("2026-11-02T23:59:59.999Z")).toISOString()).toBe(
			"2026-11-02T00:00:00.000Z",
		);
		expect(startOfUtcDay(new Date("2026-11-02T00:00:00.000Z")).toISOString()).toBe(
			"2026-11-02T00:00:00.000Z",
		);
		expect(utcDayKey(new Date("2026-11-02T23:59:59.999Z"))).toBe("2026-11-02");
	});

	it("never includes the current, partial day in the completed window", () => {
		expect(lastCompletedUtcDays(NOW, 3).map(utcDayKey)).toEqual([
			"2026-10-30",
			"2026-10-31",
			"2026-11-01",
		]);
		// Exactly at midnight the day that just began is still excluded.
		expect(lastCompletedUtcDays(new Date("2026-11-02T00:00:00.000Z"), 1).map(utcDayKey)).toEqual([
			"2026-11-01",
		]);
	});

	it("covers 90 completed days, oldest first", () => {
		const days = lastCompletedUtcDays(NOW);
		expect(days).toHaveLength(CONNECTIVITY_RETENTION_DAYS);
		expect(utcDayKey(days[0])).toBe("2026-08-04");
		expect(utcDayKey(days[days.length - 1])).toBe("2026-11-01");
	});

	it("accepts only a real YYYY-MM-DD day key", () => {
		expect(parseUtcDayKey("2026-11-01")?.toISOString()).toBe("2026-11-01T00:00:00.000Z");
		expect(parseUtcDayKey("2026-02-30")).toBeNull();
		expect(parseUtcDayKey("2026-11-1")).toBeNull();
		expect(parseUtcDayKey("")).toBeNull();
		expect(parseUtcDayKey(undefined)).toBeNull();
		expect(utcDayKey(addUtcDays(at("2026-10-31"), 1))).toBe("2026-11-01");
	});
});

describe("active devices (O22)", () => {
	it("uses a 30-day look-back from the supplied instant", () => {
		expect(ACTIVE_DEVICE_WINDOW_DAYS).toBe(30);
		expect(activeDeviceCutoff(NOW).toISOString()).toBe("2026-10-03T12:00:00.000Z");
	});
});

describe("gap and online-time thresholds", () => {
	it("floors the reachability window at the stored row cadence", () => {
		expect(THRESHOLDS.rowCadenceMs).toBe(5 * MINUTE);
		// 5 min offline + 2 × 5 s of ingest slack.
		expect(THRESHOLDS.gapThresholdMs).toBe(5 * MINUTE + 10_000);
	});

	it("reuses the configured offline window and grace", () => {
		const slowPolicy = deviceStatusPolicyFromValue({
			weakAfterMin: 10,
			offlineAfterMin: 15,
			graceMin: 2,
		});
		expect(connectivityThresholds(slowPolicy, 5).gapThresholdMs).toBe(17 * MINUTE + 10_000);
	});

	it("follows a configured heartbeat slower than the row thinning", () => {
		expect(connectivityThresholds(DEFAULT_DEVICE_STATUS_POLICY, 300)).toEqual({
			rowCadenceMs: 5 * MINUTE,
			gapThresholdMs: 5 * MINUTE + 2 * 300_000,
		});
	});

	it("falls back to the firmware default when the interval is not usable", () => {
		expect(connectivityThresholds(POLICY, Number.NaN).gapThresholdMs).toBe(5 * MINUTE + 10_000);
		expect(connectivityThresholds(POLICY, 0).gapThresholdMs).toBe(5 * MINUTE + 10_000);
	});
});

describe("summarizeDeviceDay", () => {
	it("counts gaps and subtracts only the silence beyond the threshold", () => {
		const start = at("2026-11-01");
		const times = [0, 5, 20].map((minutes) => new Date(start.getTime() + minutes * MINUTE));
		const [row] = summarizeDeviceDay(
			times.map((receivedAt) => ({ deviceId: "dev-1", receivedAt })),
			THRESHOLDS,
		);

		expect(row).toMatchObject({
			deviceId: "dev-1",
			firstSeenAt: times[0],
			lastSeenAt: times[2],
			heartbeatCount: 3,
			gapCount: 1,
		});
		// Span 20 min − (15 min silence − 5 min 10 s threshold) ≈ 10 min.
		expect(row.onlineMinutes).toBe(10);
	});

	it("treats exactly the threshold as normal cadence", () => {
		const first = at("2026-11-01", 8);
		const second = new Date(first.getTime() + THRESHOLDS.gapThresholdMs);
		const [row] = summarizeDeviceDay(
			[
				{ deviceId: "dev-1", receivedAt: first },
				{ deviceId: "dev-1", receivedAt: second },
			],
			THRESHOLDS,
		);

		expect(row.gapCount).toBe(0);
		// The span equals the threshold, all of it reachable.
		expect(row.onlineMinutes).toBe(Math.floor(THRESHOLDS.gapThresholdMs / MINUTE));
	});

	it("counts one missing stored row as a gap", () => {
		const first = at("2026-11-01", 8);
		const second = new Date(first.getTime() + 10 * MINUTE);
		const [row] = summarizeDeviceDay(
			[
				{ deviceId: "dev-1", receivedAt: first },
				{ deviceId: "dev-1", receivedAt: second },
			],
			THRESHOLDS,
		);

		expect(row.gapCount).toBe(1);
		// 10 min span − 4 min 50 s of outage leaves 5 min 10 s, floored.
		expect(row.onlineMinutes).toBe(5);
	});

	it("keeps a single stored heartbeat as a reporting but zero-span day", () => {
		const [row] = summarizeDeviceDay(
			[{ deviceId: "dev-1", receivedAt: at("2026-11-01", 9) }],
			THRESHOLDS,
		);

		expect(row.heartbeatCount).toBe(1);
		expect(row.gapCount).toBe(0);
		expect(row.onlineMinutes).toBe(0);
	});

	it("groups interleaved, unsorted rows per device in a stable order", () => {
		const samples = [
			{ deviceId: "dev-b", receivedAt: at("2026-11-01", 1) },
			{ deviceId: "dev-a", receivedAt: at("2026-11-01", 1) },
			{ deviceId: "dev-b", receivedAt: at("2026-11-01", 1, 5, 5) },
			{ deviceId: "dev-a", receivedAt: at("2026-11-01", 1, 5, 5) },
		];
		const rows = summarizeDeviceDay(samples, THRESHOLDS);

		expect(rows.map((row) => row.deviceId)).toEqual(["dev-a", "dev-b"]);
		for (const row of rows) {
			expect(row.heartbeatCount).toBe(2);
			expect(row.gapCount).toBe(0);
			expect(row.onlineMinutes).toBe(5);
		}
	});

	it("returns nothing for a day with no stored heartbeat", () => {
		expect(summarizeDeviceDay([], THRESHOLDS)).toEqual([]);
	});
});

describe("trend points (O24)", () => {
	it("computes the online share of observed time", () => {
		expect(
			buildTrendPoint({
				day: "2026-11-01",
				devicesReporting: 4,
				onlineMinutes: 50,
				observedMinutes: 100,
				gapCount: 1,
				heartbeatCount: 288,
			}),
		).toEqual({
			day: "2026-11-01",
			devicesReporting: 4,
			onlineMinutes: 50,
			observedMinutes: 100,
			gapCount: 1,
			heartbeatCount: 288,
			onlineSharePct: 50,
		});
	});

	it("never turns a missing span into 0 %", () => {
		expect(
			buildTrendPoint({
				day: "2026-11-01",
				devicesReporting: 2,
				onlineMinutes: 0,
				observedMinutes: 0,
				gapCount: 0,
				heartbeatCount: 2,
			}).onlineSharePct,
		).toBeNull();
	});

	it("keeps stored days only, oldest first, and drops a zero-device row", () => {
		const trend = buildConnectivityTrend([
			{
				day: "2026-10-30",
				devicesReporting: 3,
				onlineMinutes: 30,
				observedMinutes: 60,
				gapCount: 0,
				heartbeatCount: 300,
			},
			{
				day: "2026-11-01",
				devicesReporting: 5,
				onlineMinutes: 90,
				observedMinutes: 100,
				gapCount: 1,
				heartbeatCount: 500,
			},
			{
				day: "2026-10-31",
				devicesReporting: 0,
				onlineMinutes: 0,
				observedMinutes: 0,
				gapCount: 0,
				heartbeatCount: 0,
			},
		]);

		expect(trend.map((point) => point.day)).toEqual(["2026-10-30", "2026-11-01"]);
		expect(trend.map((point) => point.onlineSharePct)).toEqual([50, 90]);
	});
});

describe("connectivity snapshot", () => {
	it("reports the active share and the days that have no stored history", () => {
		const snapshot = buildConnectivitySnapshot({
			registered: 10,
			active30d: 4,
			trend: [
				{
					day: "2026-11-01",
					devicesReporting: 2,
					onlineMinutes: 60,
					observedMinutes: 120,
					gapCount: 0,
					heartbeatCount: 48,
					onlineSharePct: 50,
				},
			],
			now: NOW,
		});

		expect(snapshot.registered).toBe(10);
		expect(snapshot.active30d).toBe(4);
		expect(snapshot.activePct).toBe(40);
		expect(snapshot.activeCutoff.toISOString()).toBe("2026-10-03T12:00:00.000Z");
		expect(snapshot.windowDays).toHaveLength(CONNECTIVITY_RETENTION_DAYS);
		expect(snapshot.trend).toHaveLength(1);
		expect(snapshot.daysWithoutData).toBe(CONNECTIVITY_RETENTION_DAYS - 1);
	});

	it("does not invent a share when nothing is registered", () => {
		const snapshot = buildConnectivitySnapshot({
			registered: 0,
			active30d: 0,
			trend: [],
			now: NOW,
		});
		expect(snapshot.activePct).toBeNull();
		expect(snapshot.daysWithoutData).toBe(CONNECTIVITY_RETENTION_DAYS);
	});
});

describe("rollup planning", () => {
	it("starts with only the previous completed day when there is no marker", () => {
		expect(planConnectivityRollupDays(null, NOW).map(utcDayKey)).toEqual(["2026-11-01"]);
	});

	it("does nothing when the previous day is already stored", () => {
		expect(
			planConnectivityRollupDays({ lastRolledUpDay: "2026-11-01", completedAt: "" }, NOW),
		).toEqual([]);
	});

	it("catches up days missed while the heartbeat rows are still retained", () => {
		expect(
			planConnectivityRollupDays({ lastRolledUpDay: "2026-10-29", completedAt: "" }, NOW).map(
				utcDayKey,
			),
		).toEqual(["2026-10-30", "2026-10-31", "2026-11-01"]);
	});

	it("never plans a day older than the retention floor", () => {
		const days = planConnectivityRollupDays(
			{ lastRolledUpDay: "2026-01-01", completedAt: "" },
			NOW,
		);
		expect(days).toHaveLength(CONNECTIVITY_RETENTION_DAYS);
		expect(utcDayKey(days[0])).toBe("2026-08-04");
		expect(utcDayKey(days[days.length - 1])).toBe("2026-11-01");
	});

	it("ignores a marker ahead of the clock", () => {
		expect(
			planConnectivityRollupDays({ lastRolledUpDay: "2026-11-05", completedAt: "" }, NOW),
		).toEqual([]);
	});

	it("rejects a malformed marker instead of trusting it", () => {
		expect(normalizeRollupMarker(null)).toBeNull();
		expect(normalizeRollupMarker({ lastRolledUpDay: "yesterday" })).toBeNull();
		expect(normalizeRollupMarker({ lastRolledUpDay: "2026-11-01" })).toEqual({
			lastRolledUpDay: "2026-11-01",
			completedAt: "",
		});
	});
});
