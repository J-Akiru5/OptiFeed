import { HEARTBEAT_ROW_INTERVAL_MS } from "@/lib/constants";
import type { DeviceStatusPolicy } from "@/lib/device-status";
import { FIRMWARE_HEARTBEAT_INTERVAL_S } from "@/lib/firmware/config";

/**
 * Registered-versus-active and connectivity-trend rules (#479, M3C.10).
 *
 * Decisions recorded in docs/SUPERADMIN-MULTITENANCY-PLAN.md:
 *
 *  - **O22 — active** means a device with a heartbeat (`lastSeenAt`) **or** any
 *    feed event in the last 30 days. Hand-fed imports count: they are feed
 *    activity for the unit the sheet belongs to, even though they are a daily
 *    total rather than a machine dispense.
 *  - **O24 — history** is a daily per-device rollup kept for 90 days, read
 *    only from stored rows. A day with no row is "no data"; nothing is
 *    estimated from a neighbour or interpolated across a gap.
 *
 * Everything here is pure. The Prisma readers/writers live in
 * `lib/platform/connectivity.ts`, so every rule can be unit tested without a
 * database.
 */

/** How long a rollup row is kept. */
export const CONNECTIVITY_RETENTION_DAYS = 90;

/** The "active" look-back decided by O22. */
export const ACTIVE_DEVICE_WINDOW_DAYS = 30;

const DAY_MS = 24 * 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;

// ---------------------------------------------------------------------------
// UTC day boundaries
// ---------------------------------------------------------------------------

/**
 * Midnight UTC of `at`. The rollup is deliberately UTC-based (O24): the
 * heartbeat rows it reads carry a UTC instant, and a DATE bucket means the
 * unique (deviceId, day) key can never drift with a display time zone. The
 * tenant charts keep their own Asia/Manila day; this history is the platform's.
 */
export function startOfUtcDay(at: Date): Date {
	return new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()));
}

/** `YYYY-MM-DD` for the UTC day containing `at`. */
export function utcDayKey(at: Date): string {
	return startOfUtcDay(at).toISOString().slice(0, 10);
}

export function addUtcDays(day: Date, days: number): Date {
	return new Date(startOfUtcDay(day).getTime() + days * DAY_MS);
}

/** Parse a stored `YYYY-MM-DD` marker, or null when it is not a real date. */
export function parseUtcDayKey(value: unknown): Date | null {
	if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
	const parsed = new Date(`${value}T00:00:00.000Z`);
	if (Number.isNaN(parsed.getTime())) return null;
	return parsed.toISOString().slice(0, 10) === value ? parsed : null;
}

/**
 * The last `count` **completed** UTC days, oldest first. The current (partial)
 * day is never included: a rollup of today would store a partial day as if it
 * were final.
 */
export function lastCompletedUtcDays(now: Date, count = CONNECTIVITY_RETENTION_DAYS): Date[] {
	const today = startOfUtcDay(now);
	return Array.from({ length: count }, (_, index) => addUtcDays(today, index - count));
}

/** O22: the instant the 30-day active window starts. */
export function activeDeviceCutoff(now: Date): Date {
	return new Date(now.getTime() - ACTIVE_DEVICE_WINDOW_DAYS * DAY_MS);
}

// ---------------------------------------------------------------------------
// What counts as a gap, and how online time is measured
// ---------------------------------------------------------------------------

export interface ConnectivityThresholds {
	/** Expected spacing of stored heartbeat rows. */
	rowCadenceMs: number;
	/** Silence longer than this is an outage, not normal reporting cadence. */
	gapThresholdMs: number;
}

/**
 * Derive the gap threshold from the values the platform actually carries.
 *
 * - **Stored row cadence.** The ingest thins heartbeat rows to at most one per
 *   device per `HEARTBEAT_ROW_INTERVAL_MS` (5 minutes) unless a stored value
 *   changed, and the firmware beat is `firmware.gates.heartbeat_interval_s`
 *   (5 s by default, 2–300 s envelope). The expected spacing is therefore the
 *   larger of the two — 5 minutes for every current deployment.
 * - **Reachability window.** The platform's own `device.status` policy says a
 *   unit is offline after `offlineAfterMin` (plus grace). That is the
 *   configured definition of "not reachable", so it is reused here rather than
 *   copied as a new number, and floored at one row cadence.
 * - **Tolerance.** Two firmware beats of ingest/jitter slack are added on top.
 *   Without it a row written 300.4 s after the previous one would look like an
 *   outage, because the thinning interval is exactly 5 minutes.
 *
 * With the shipped defaults: `max(5 min, 5 min) + 2 × 5 s = 310 s`. A single
 * missed stored row (≈610 s) is a gap; normal 300–310 s spacing is not.
 */
export function connectivityThresholds(
	policy: DeviceStatusPolicy,
	heartbeatIntervalSeconds: number,
): ConnectivityThresholds {
	const beatMs =
		Number.isFinite(heartbeatIntervalSeconds) && heartbeatIntervalSeconds > 0
			? heartbeatIntervalSeconds * 1000
			: FIRMWARE_HEARTBEAT_INTERVAL_S * 1000;
	const rowCadenceMs = Math.max(beatMs, HEARTBEAT_ROW_INTERVAL_MS);
	const reachableWindowMs = Math.max(policy.offlineAfterMs + policy.graceMs, rowCadenceMs);
	return { rowCadenceMs, gapThresholdMs: reachableWindowMs + beatMs * 2 };
}

export interface HeartbeatSample {
	deviceId: string;
	receivedAt: Date;
}

export interface DeviceDayStats {
	deviceId: string;
	firstSeenAt: Date;
	lastSeenAt: Date;
	heartbeatCount: number;
	gapCount: number;
	onlineMinutes: number;
}

/**
 * Fold one UTC day of stored heartbeat rows into one row per device.
 *
 * Rule, stated exactly:
 *
 *  - `heartbeatCount` counts stored rows.
 *  - `gapCount` counts consecutive pairs separated by **more than**
 *    `gapThresholdMs`; exactly at the threshold is still normal cadence.
 *  - `onlineMinutes` is the measured span (`lastSeenAt - firstSeenAt`) minus,
 *    for every gap, the silence **beyond** the threshold
 *    (`delta - gapThresholdMs`). The threshold window itself is reachable by
 *    the platform's own rule, so it is not deducted; the excess is the outage.
 *    The result is floored to whole minutes and never negative.
 *  - A device with a single stored row has a zero span and therefore reports
 *    `onlineMinutes: 0`. It still counts as reporting that day. Nothing is
 *    extrapolated to the day boundary or past the last row — no estimate.
 */
export function summarizeDeviceDay(
	samples: readonly HeartbeatSample[],
	thresholds: ConnectivityThresholds,
): DeviceDayStats[] {
	const byDevice = new Map<string, number[]>();
	for (const sample of samples) {
		const time = sample.receivedAt.getTime();
		if (!Number.isFinite(time)) continue;
		const list = byDevice.get(sample.deviceId);
		if (list) list.push(time);
		else byDevice.set(sample.deviceId, [time]);
	}

	const stats: DeviceDayStats[] = [];
	for (const [deviceId, times] of byDevice) {
		times.sort((a, b) => a - b);
		let gapCount = 0;
		let silenceBeyondThresholdMs = 0;
		for (let index = 1; index < times.length; index++) {
			const delta = times[index] - times[index - 1];
			if (delta > thresholds.gapThresholdMs) {
				gapCount++;
				silenceBeyondThresholdMs += delta - thresholds.gapThresholdMs;
			}
		}
		const spanMs = times[times.length - 1] - times[0];
		const onlineMs = Math.max(0, spanMs - silenceBeyondThresholdMs);
		stats.push({
			deviceId,
			firstSeenAt: new Date(times[0]),
			lastSeenAt: new Date(times[times.length - 1]),
			heartbeatCount: times.length,
			gapCount,
			onlineMinutes: Math.floor(onlineMs / MINUTE_MS),
		});
	}

	// Deterministic order: the insert and every test see the same rows.
	return stats.sort((a, b) => a.deviceId.localeCompare(b.deviceId));
}

// ---------------------------------------------------------------------------
// Trend and snapshot
// ---------------------------------------------------------------------------

export interface ConnectivityTrendRow {
	day: string;
	devicesReporting: number;
	onlineMinutes: number;
	observedMinutes: number;
	gapCount: number;
	heartbeatCount: number;
}

export interface ConnectivityTrendPoint {
	/** `YYYY-MM-DD`, UTC. */
	day: string;
	devicesReporting: number;
	onlineMinutes: number;
	observedMinutes: number;
	gapCount: number;
	heartbeatCount: number;
	/**
	 * Share of the time devices were actually observed, 0–100 with one decimal.
	 * Null when the stored day has no measured span at all (for example every
	 * device sent one heartbeat): a 0 % bar would be a false zero.
	 */
	onlineSharePct: number | null;
}

/** One stored day → one plot point. Missing days never become a zero. */
export function buildTrendPoint(row: ConnectivityTrendRow): ConnectivityTrendPoint {
	const observedMinutes = Number.isFinite(row.observedMinutes) ? row.observedMinutes : 0;
	const onlineMinutes = Number.isFinite(row.onlineMinutes) ? row.onlineMinutes : 0;
	const share =
		observedMinutes > 0 ? Math.round((onlineMinutes / observedMinutes) * 1000) / 10 : null;
	return {
		day: row.day,
		devicesReporting: row.devicesReporting,
		onlineMinutes,
		observedMinutes,
		gapCount: row.gapCount,
		heartbeatCount: row.heartbeatCount,
		onlineSharePct: share === null ? null : Math.min(100, Math.max(0, share)),
	};
}

/** Trend points for the stored rows only, oldest first. No day is filled in. */
export function buildConnectivityTrend(
	rows: readonly ConnectivityTrendRow[],
): ConnectivityTrendPoint[] {
	return rows
		.map(buildTrendPoint)
		.filter((point) => point.devicesReporting > 0)
		.sort((a, b) => a.day.localeCompare(b.day));
}

export interface PlatformConnectivity {
	registered: number;
	active30d: number;
	/** Share of registered devices active in the window, or null with none. */
	activePct: number | null;
	activeWindowDays: number;
	activeCutoff: Date;
	/** Every completed UTC day the trend covers, oldest first. */
	windowDays: string[];
	/** Days with stored history, oldest first. May be shorter than the window. */
	trend: ConnectivityTrendPoint[];
	/** Completed days in the window that have no stored row (never estimated). */
	daysWithoutData: number;
}

export interface BuildConnectivitySnapshotInput {
	registered: number;
	active30d: number;
	trend: readonly ConnectivityTrendPoint[];
	now?: Date;
}

/**
 * Assemble what the panel renders. `registered` is passed in from the caller's
 * existing device count so the overview never runs a second count for it.
 */
export function buildConnectivitySnapshot({
	registered,
	active30d,
	trend,
	now = new Date(),
}: BuildConnectivitySnapshotInput): PlatformConnectivity {
	const windowDays = lastCompletedUtcDays(now).map(utcDayKey);
	return {
		registered,
		active30d,
		activePct: registered > 0 ? Math.round((active30d / registered) * 1000) / 10 : null,
		activeWindowDays: ACTIVE_DEVICE_WINDOW_DAYS,
		activeCutoff: activeDeviceCutoff(now),
		windowDays,
		trend: [...trend],
		daysWithoutData: Math.max(0, windowDays.length - trend.length),
	};
}

// ---------------------------------------------------------------------------
// Rollup planning (which completed days still need storing)
// ---------------------------------------------------------------------------

export interface ConnectivityRollupMarker {
	lastRolledUpDay: string;
	completedAt: string;
}

/** Read a stored marker value, or null when it is absent or malformed. */
export function normalizeRollupMarker(value: unknown): ConnectivityRollupMarker | null {
	if (typeof value !== "object" || value === null) return null;
	const record = value as Record<string, unknown>;
	if (!parseUtcDayKey(record.lastRolledUpDay)) return null;
	return {
		lastRolledUpDay: record.lastRolledUpDay as string,
		completedAt: typeof record.completedAt === "string" ? record.completedAt : "",
	};
}

/**
 * The completed UTC days this run must store, oldest first.
 *
 * - No marker (first run): only the previous completed day. Older heartbeat his-
 *   tory may already be gone, so back-filling is not attempted.
 * - Marker present: every finished day after it, so a cron that missed a day
 *   catches up while the 7-day heartbeat retention still holds the rows.
 * - Never older than the retention floor: a day whose source rows may already
 *   have been deleted is not rolled up from partial data.
 * - Never today: the current day is still being written.
 */
export function planConnectivityRollupDays(
	marker: ConnectivityRollupMarker | null,
	now: Date,
): Date[] {
	const yesterday = addUtcDays(startOfUtcDay(now), -1);
	const retentionFloor = addUtcDays(startOfUtcDay(now), -CONNECTIVITY_RETENTION_DAYS);

	const markerDay = marker ? parseUtcDayKey(marker.lastRolledUpDay) : null;
	let cursor = markerDay ? addUtcDays(markerDay, 1) : yesterday;
	if (cursor < retentionFloor) cursor = retentionFloor;

	const days: Date[] = [];
	while (cursor <= yesterday) {
		days.push(cursor);
		cursor = addUtcDays(cursor, 1);
	}
	return days;
}
