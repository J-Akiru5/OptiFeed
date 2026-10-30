import { type ChartPoint, fillDailySeries } from "@/components/charts/chart-data";
import { requirePlatformAdmin } from "@/lib/auth/require-platform-admin";
import { resolveDayWindow } from "@/lib/chart-windows";
import { PH_TZ } from "@/lib/constants";
import {
	DEFAULT_DEVICE_STATUS_POLICY,
	type DeviceStatusPolicy,
	evaluateDeviceStatus,
} from "@/lib/device-status";
import prisma from "@/lib/prisma";

/**
 * System health for the platform console (E16.4, task I-15).
 *
 * Read-only and platform-gated. Every query is bounded: the job aggregates are
 * counts, the failure list is `take: 20`, the device table is `take: limit + 1`
 * (the extra row only tells the page the list was cut) and the two daily series
 * are aggregated in SQL so a busy queue never streams into the page.
 *
 * Cron freshness has no heartbeat table of its own. It is inferred, and the
 * page says so, from the rows each job writes:
 *  - `device-watch` → the latest `DeviceStateEvent` with
 *    `eventType = "disconnected"` and `source = "system"` (only that cron
 *    writes it; a healthy fleet writes nothing, so "no activity inferred" is a
 *    normal result, not an error).
 *  - `crop-watch` → the latest `ReminderLog.sentAt` (reminders are its output).
 *  - `jobs` → the latest `BackgroundJob.startedAt` (the worker claims rows).
 */

export const HEALTH_RANGE_DAYS = 14;
/** Device tables are dense; show the first 200 and say when the list is cut. */
export const HEALTH_DEVICE_LIMIT = 200;

export type DeviceSortField = "lastSeen" | "label" | "mac";
export type SortDirection = "asc" | "desc";

export interface JobFailureRow {
	id: string;
	type: string;
	error: string | null;
	attempts: number;
	finishedAt: Date | null;
	createdAt: Date;
}

export interface OldestQueuedJob {
	id: string;
	type: string;
	createdAt: Date;
}

export interface CronActivityRow {
	job: "device-watch" | "crop-watch" | "jobs";
	lastActivityAt: Date | null;
	/** What produced the timestamp, so the page can explain the inference. */
	eventType: string | null;
}

export interface HealthDeviceRow {
	id: string;
	label: string;
	mac: string;
	lastSeenAt: Date | null;
	pondName: string | null;
}

export interface JobHealth {
	counts: Record<string, number>;
	total: number;
	queued: number;
	running: number;
	succeeded: number;
	failed: number;
	oldestQueued: OldestQueuedJob | null;
	recentFailures: JobFailureRow[];
	jobsPerDay: ChartPoint[];
	failuresPerDay: ChartPoint[];
}

export interface SystemHealth {
	rangeDays: number;
	dayKeys: string[];
	generatedAt: Date;
	jobs: JobHealth;
	cron: CronActivityRow[];
	devices: HealthDeviceRow[];
	devicesTruncated: boolean;
}

interface DayCountRow {
	day: string;
	total: number;
}

const DEVICE_SORT_FIELDS: readonly DeviceSortField[] = ["lastSeen", "label", "mac"];

/** Accept only the three supported sort keys; anything else is last contact. */
export function parseDeviceSort(
	sort: string | null | undefined,
	direction: string | null | undefined,
): { field: DeviceSortField; direction: SortDirection } {
	const field = DEVICE_SORT_FIELDS.includes((sort ?? "") as DeviceSortField)
		? (sort as DeviceSortField)
		: "lastSeen";
	// Last contact reads best newest-first; labels and MACs read A→Z.
	const fallback: SortDirection = field === "lastSeen" ? "desc" : "asc";
	const dir: SortDirection = direction === "asc" || direction === "desc" ? direction : fallback;
	return { field, direction: dir };
}

/**
 * Sort a bounded device list in JS.
 *
 * A device with no reading sorts last in both directions: an unknown last
 * contact should not jump to the top of a "most recent" list or hide between
 * known dates in the other direction.
 */
export function sortHealthDevices(
	rows: readonly HealthDeviceRow[],
	field: DeviceSortField,
	direction: SortDirection,
): HealthDeviceRow[] {
	const sorted = [...rows];
	const factor = direction === "asc" ? 1 : -1;

	sorted.sort((a, b) => {
		if (field === "lastSeen") {
			if (!a.lastSeenAt && !b.lastSeenAt) {
				return a.label.localeCompare(b.label, undefined, { sensitivity: "base" });
			}
			if (!a.lastSeenAt) return 1;
			if (!b.lastSeenAt) return -1;
			return (a.lastSeenAt.getTime() - b.lastSeenAt.getTime()) * factor;
		}
		return a[field].localeCompare(b[field], undefined, { sensitivity: "base" }) * factor;
	});

	return sorted;
}

/** True when a device has not been heard from inside the offline window. */
export function isDeviceOffline(
	lastSeenAt: Date | null,
	now = new Date(),
	policy: DeviceStatusPolicy = DEFAULT_DEVICE_STATUS_POLICY,
): boolean {
	return evaluateDeviceStatus({ lastSeenAt, now, policy }).isOffline;
}

export async function getSystemHealth(
	now: Date = new Date(),
	deviceLimit = HEALTH_DEVICE_LIMIT,
): Promise<SystemHealth> {
	// Gate before any query so a non-platform admin learns nothing, not even
	// from a partially built result.
	await requirePlatformAdmin();

	const window = resolveDayWindow(HEALTH_RANGE_DAYS, now, PH_TZ);

	const [
		statusGroups,
		oldestQueued,
		recentFailures,
		deviceWatch,
		cropWatch,
		jobsActivity,
		deviceRows,
		jobDayRows,
		failureDayRows,
	] = await Promise.all([
		prisma.backgroundJob.groupBy({
			by: ["status"],
			_count: { _all: true },
		}),
		prisma.backgroundJob.findFirst({
			where: { status: "queued" },
			orderBy: { createdAt: "asc" },
			select: { id: true, type: true, createdAt: true },
		}),
		prisma.backgroundJob.findMany({
			where: { status: "failed" },
			orderBy: { finishedAt: "desc" },
			take: 20,
			select: {
				id: true,
				type: true,
				error: true,
				attempts: true,
				finishedAt: true,
				createdAt: true,
			},
		}),
		prisma.deviceStateEvent.findFirst({
			where: { eventType: "disconnected", source: "system" },
			orderBy: { createdAt: "desc" },
			select: { createdAt: true, eventType: true },
		}),
		prisma.reminderLog.findFirst({
			orderBy: { sentAt: "desc" },
			select: { sentAt: true, kind: true },
		}),
		prisma.backgroundJob.findFirst({
			where: { startedAt: { not: null } },
			orderBy: { startedAt: "desc" },
			select: { startedAt: true, type: true },
		}),
		prisma.energyDevice.findMany({
			orderBy: { label: "asc" },
			take: deviceLimit + 1,
			select: {
				id: true,
				label: true,
				mac: true,
				lastSeenAt: true,
				pond: { select: { name: true } },
			},
		}),
		prisma.$queryRaw<DayCountRow[]>`
			SELECT to_char(date_trunc('day', "createdAt" AT TIME ZONE 'UTC' AT TIME ZONE ${PH_TZ}::text), 'YYYY-MM-DD') AS day,
			       COUNT(*)::int AS total
			FROM "BackgroundJob"
			WHERE "createdAt" >= ${window.start}
			GROUP BY 1
			ORDER BY 1
		`,
		prisma.$queryRaw<DayCountRow[]>`
			SELECT to_char(date_trunc('day', COALESCE("finishedAt", "createdAt") AT TIME ZONE 'UTC' AT TIME ZONE ${PH_TZ}::text), 'YYYY-MM-DD') AS day,
			       COUNT(*)::int AS total
			FROM "BackgroundJob"
			WHERE "status" = 'failed' AND COALESCE("finishedAt", "createdAt") >= ${window.start}
			GROUP BY 1
			ORDER BY 1
		`,
	]);

	const counts: Record<string, number> = {};
	for (const row of statusGroups) counts[row.status] = row._count._all;
	const total = Object.values(counts).reduce((sum, value) => sum + value, 0);

	const devices = deviceRows.slice(0, deviceLimit).map((row) => ({
		id: row.id,
		label: row.label,
		mac: row.mac,
		lastSeenAt: row.lastSeenAt,
		pondName: row.pond?.name ?? null,
	}));

	return {
		rangeDays: HEALTH_RANGE_DAYS,
		dayKeys: window.dayKeys,
		generatedAt: now,
		jobs: {
			counts,
			total,
			queued: counts.queued ?? 0,
			running: counts.running ?? 0,
			succeeded: counts.succeeded ?? 0,
			failed: counts.failed ?? 0,
			oldestQueued: oldestQueued ?? null,
			recentFailures,
			jobsPerDay: fillDailySeries(
				jobDayRows.map((row) => ({ label: row.day, value: row.total })),
				window.dayKeys,
			),
			failuresPerDay: fillDailySeries(
				failureDayRows.map((row) => ({ label: row.day, value: row.total })),
				window.dayKeys,
			),
		},
		cron: [
			{
				job: "device-watch",
				lastActivityAt: deviceWatch?.createdAt ?? null,
				eventType: deviceWatch?.eventType ?? null,
			},
			{
				job: "crop-watch",
				lastActivityAt: cropWatch?.sentAt ?? null,
				eventType: cropWatch?.kind ?? null,
			},
			{
				job: "jobs",
				lastActivityAt: jobsActivity?.startedAt ?? null,
				eventType: jobsActivity?.type ?? null,
			},
		],
		devices,
		devicesTruncated: deviceRows.length > deviceLimit,
	};
}
