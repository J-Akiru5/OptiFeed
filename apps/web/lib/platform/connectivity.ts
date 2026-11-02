import { reportError } from "@/lib/observability";
import {
	CONNECTIVITY_RETENTION_DAYS,
	type ConnectivityRollupMarker,
	type ConnectivityThresholds,
	type ConnectivityTrendPoint,
	type ConnectivityTrendRow,
	activeDeviceCutoff,
	addUtcDays,
	buildConnectivityTrend,
	connectivityThresholds,
	lastCompletedUtcDays,
	normalizeRollupMarker,
	planConnectivityRollupDays,
	startOfUtcDay,
	summarizeDeviceDay,
	utcDayKey,
} from "@/lib/platform/connectivity-rules";
import prisma from "@/lib/prisma";
import { getDeviceStatusPolicy } from "@/lib/settings/device-status";
import { getFirmwareGates } from "@/lib/settings/firmware-gates";

/**
 * Registered-versus-active and connectivity history readers/writers
 * (#479, M3C.10; decisions O22 and O24).
 *
 * Read side: `countActiveDevices` and `loadConnectivityTrend`, both called from
 * the existing `getPlatformAnalytics` wave (no second analytics layer).
 *
 * Write side: `rollupDeviceConnectivity`, called by the existing
 * `device-watch` cron **before** `deleteOldHeartbeatEvents`, because that sweep
 * deletes the heartbeat rows (7-day retention) the rollup reads. The rollup
 * recomputes the previous completed UTC day, replaces it in one transaction and
 * prunes anything older than 90 days.
 *
 * All rules (day boundaries, gap threshold, online minutes, plan) live in
 * `connectivity-rules.ts`; this file only queries and writes.
 */

/** `PlatformSetting` key holding the last rolled-up day. */
export const CONNECTIVITY_ROLLUP_SETTING_KEY = "connectivity.rollup";

interface TrendQueryRow extends ConnectivityTrendRow {
	day: string;
}

/**
 * O22: devices with a heartbeat (`lastSeenAt`) **or any feed event** in the
 * last 30 days. The `some` subquery counts each device once, so a unit with
 * both a heartbeat and a hundred feed rows is still one active device. No
 * event-type or source filter: an imported `hand_fed` daily total counts.
 */
export async function countActiveDevices(now = new Date()): Promise<number> {
	const cutoff = activeDeviceCutoff(now);
	return prisma.energyDevice.count({
		where: {
			OR: [
				{ lastSeenAt: { gte: cutoff } },
				{ feedEvents: { some: { receivedAt: { gte: cutoff } } } },
			],
		},
	});
}

/**
 * The stored daily trend for the last 90 completed UTC days, oldest first.
 *
 * Only rows that exist are returned. A day with no rollup is simply absent;
 * the caller reports it as "no data" and the panel never draws a zero for it.
 */
export async function loadConnectivityTrend(now = new Date()): Promise<ConnectivityTrendPoint[]> {
	const windowDays = lastCompletedUtcDays(now, CONNECTIVITY_RETENTION_DAYS);
	if (windowDays.length === 0) return [];
	const startKey = utcDayKey(windowDays[0]);
	const endKey = utcDayKey(windowDays[windowDays.length - 1]);

	// `day` is a DATE; both bounds are passed as date-only strings so a session
	// time zone can never shift which rows are included.
	const rows = await prisma.$queryRaw<TrendQueryRow[]>`
		SELECT to_char("day", 'YYYY-MM-DD') AS "day",
		       COUNT(*)::int AS "devicesReporting",
		       COALESCE(SUM("onlineMinutes"), 0)::float8 AS "onlineMinutes",
		       COALESCE(SUM(EXTRACT(EPOCH FROM ("lastSeenAt" - "firstSeenAt")) / 60), 0)::float8 AS "observedMinutes",
		       COALESCE(SUM("gapCount"), 0)::int AS "gapCount",
		       COALESCE(SUM("heartbeatCount"), 0)::int AS "heartbeatCount"
		FROM "DeviceConnectivityDaily"
		WHERE "day" >= ${startKey}::date AND "day" <= ${endKey}::date
		GROUP BY 1
		ORDER BY 1
	`;

	return buildConnectivityTrend(rows);
}

/** The thresholds the rollup uses: the configured policy, not a copy of it. */
export async function resolveConnectivityThresholds(): Promise<ConnectivityThresholds> {
	const [policy, gates] = await Promise.all([getDeviceStatusPolicy(), getFirmwareGates()]);
	return connectivityThresholds(policy, gates.heartbeat_interval_s);
}

async function readRollupMarker(): Promise<ConnectivityRollupMarker | null> {
	try {
		const row = await prisma.platformSetting.findUnique({
			where: { key: CONNECTIVITY_ROLLUP_SETTING_KEY },
			select: { value: true },
		});
		return normalizeRollupMarker(row?.value);
	} catch (error) {
		// A failed marker read only means a day may be recomputed. The replace is
		// idempotent, so this is safe; the run itself must not fail for it.
		reportError(error, { job: "connectivity-rollup", stage: "read-marker" });
		return null;
	}
}

export interface ConnectivityRollupRun {
	/** Days stored (a day with no heartbeat rows is stored as absent). */
	processedDays: string[];
	/** Days left absent because no heartbeat row survived for them. */
	emptyDays: string[];
	/** Device-day rows written. */
	devices: number;
	/** Rows removed past the 90-day retention. */
	pruned: number;
	/** True when the marker said the previous day was already stored. */
	alreadyRolledUp: boolean;
}

/**
 * Aggregate the previous completed UTC day from stored heartbeat rows.
 *
 * One transaction per day: delete that day, insert the recomputed rows. A
 * crash therefore leaves the day either at its previous content or fully
 * replaced, never half-written, and a re-run produces the same rows (the
 * source is immutable history). The `connectivity.rollup` marker skips a day
 * that is already stored.
 */
export async function rollupDeviceConnectivity(now = new Date()): Promise<ConnectivityRollupRun> {
	const marker = await readRollupMarker();
	const days = planConnectivityRollupDays(marker, now);
	const thresholds = await resolveConnectivityThresholds();

	const processedDays: string[] = [];
	const emptyDays: string[] = [];
	let devices = 0;

	for (const day of days) {
		const nextDay = addUtcDays(day, 1);
		const key = utcDayKey(day);

		const samples = await prisma.feedEvent.findMany({
			where: { eventType: "heartbeat", receivedAt: { gte: day, lt: nextDay } },
			select: { deviceId: true, receivedAt: true },
			orderBy: [{ deviceId: "asc" }, { receivedAt: "asc" }],
		});
		const stats = summarizeDeviceDay(samples, thresholds);

		await prisma.$transaction(async (tx) => {
			await tx.deviceConnectivityDaily.deleteMany({ where: { day } });
			if (stats.length > 0) {
				await tx.deviceConnectivityDaily.createMany({
					data: stats.map((row) => ({
						deviceId: row.deviceId,
						day,
						firstSeenAt: row.firstSeenAt,
						lastSeenAt: row.lastSeenAt,
						onlineMinutes: row.onlineMinutes,
						heartbeatCount: row.heartbeatCount,
						gapCount: row.gapCount,
					})),
				});
			}
		});

		processedDays.push(key);
		if (stats.length === 0) emptyDays.push(key);
		devices += stats.length;
	}

	if (processedDays.length > 0) {
		const lastRolledUpDay = processedDays[processedDays.length - 1];
		await prisma.platformSetting.upsert({
			where: { key: CONNECTIVITY_ROLLUP_SETTING_KEY },
			create: {
				key: CONNECTIVITY_ROLLUP_SETTING_KEY,
				value: { lastRolledUpDay, completedAt: now.toISOString(), days: processedDays.length },
			},
			update: {
				value: { lastRolledUpDay, completedAt: now.toISOString(), days: processedDays.length },
			},
		});
	}

	const pruned = await pruneConnectivityHistory(now);

	return {
		processedDays,
		emptyDays,
		devices,
		pruned,
		alreadyRolledUp: days.length === 0,
	};
}

/** First UTC day that is still inside the 90-day retention window. */
export function connectivityPruneCutoff(now = new Date()): Date {
	return addUtcDays(startOfUtcDay(now), -CONNECTIVITY_RETENTION_DAYS);
}

/** Delete rollup rows older than the retention floor. */
export async function pruneConnectivityHistory(now = new Date()): Promise<number> {
	const result = await prisma.deviceConnectivityDaily.deleteMany({
		where: { day: { lt: connectivityPruneCutoff(now) } },
	});
	return result.count;
}
