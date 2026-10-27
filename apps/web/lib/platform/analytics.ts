import {
	buildDayKeys,
	buildStackedSeries,
	computeDelta,
	computePointDelta,
	fillDailySeries,
} from "@/components/charts/chart-data";
import { requirePlatformAdmin } from "@/lib/auth/require-platform-admin";
import { startOfDayInTimeZone } from "@/lib/chart-windows";
import { OFFLINE_THRESHOLD_MS, PH_TZ } from "@/lib/constants";
import prisma from "@/lib/prisma";

/**
 * Cross-tenant analytics for the platform overview (E16.1).
 *
 * Read-only. Every query is bounded (a date window, a small `take`) and the
 * whole page is loaded in one parallel wave — never a query per row. The
 * caller must be a platform admin: `getPlatformAnalytics` gates itself so a
 * future action or route cannot accidentally reuse it without the check.
 */

export const ANALYTICS_RANGES = [7, 30, 90] as const;
export type AnalyticsRange = (typeof ANALYTICS_RANGES)[number];
export const DEFAULT_ANALYTICS_RANGE: AnalyticsRange = 30;

const DAY_MS = 24 * 60 * 60 * 1000;
const TOP_FCR_LOOKBACK_DAYS = 180;

/** DeviceStateEvent types that represent an alert, not routine telemetry. */
export const ALERT_EVENT_TYPES = ["pellet_low", "disconnected", "command_failed"] as const;

export interface AnalyticsWindow {
	start: Date;
	end: Date;
	previousStart: Date;
	previousEnd: Date;
}

export interface PlatformAnalyticsKpis {
	users: CountKpi;
	organizations: CountKpi;
	ponds: CountKpi;
	feedersOnline: {
		total: number;
		online: number;
		pct: number;
		previousPct: number | null;
		deltaPct: number | null;
		direction: "up" | "down" | "flat";
	};
	feeds: FlowKpi;
	kgDispensed: FlowKpi;
	openAlerts: CountKpi;
	pendingApprovals: CountKpi;
}

export interface CountKpi {
	/** Current total (or currently open/pending count). */
	total: number;
	/** New rows created in the selected window. */
	newInRange: number;
	previousNew: number;
	deltaPct: number | null;
	direction: "up" | "down" | "flat";
}

export interface FlowKpi {
	total: number;
	previous: number;
	deltaPct: number | null;
	direction: "up" | "down" | "flat";
}

export interface OfflineFeederRow {
	id: string;
	label: string;
	mac: string;
	lastSeenAt: Date | null;
	pondName: string | null;
}

export interface PendingApprovalRow {
	id: string;
	label: string;
	mac: string;
	createdAt: Date;
}

export interface FailedJobRow {
	id: string;
	type: string;
	error: string | null;
	at: Date;
}

export interface FcrRankRow {
	pondId: string;
	pondName: string;
	fcrValue: number;
	periodEnd: Date;
}

export interface PlatformAnalytics {
	range: AnalyticsRange;
	window: AnalyticsWindow;
	/** Local day keys the series are bucketed on (oldest first). */
	dayKeys: string[];
	kpis: PlatformAnalyticsKpis;
	signupsPerDay: { label: string; value: number }[];
	feedsPerDayBySource: ReturnType<typeof buildStackedSeries>;
	kgPerDay: { label: string; value: number }[];
	deviceSplit: { name: string; value: number; segment: "online" | "offline" }[];
	alertsByType: { type: string; count: number }[];
	topFcrPonds: FcrRankRow[];
	mostOfflineFeeders: OfflineFeederRow[];
	pendingApprovalDevices: PendingApprovalRow[];
	failedJobs: FailedJobRow[];
}

/** Accept only the three supported ranges; anything else falls back to 30. */
export function parseAnalyticsRange(value: string | null | undefined): AnalyticsRange {
	const parsed = Number.parseInt(value ?? "", 10);
	return (ANALYTICS_RANGES as readonly number[]).includes(parsed)
		? (parsed as AnalyticsRange)
		: DEFAULT_ANALYTICS_RANGE;
}

/**
 * The selected window and the equally long window immediately before it, used
 * for the KPI deltas. Both ends are instants; the current window starts at
 * local midnight so the KPI counts and the day buckets cover the same days.
 */
export function resolveAnalyticsWindow(range: AnalyticsRange, now = new Date()): AnalyticsWindow {
	const end = now;
	const today = startOfDayInTimeZone(end, PH_TZ);
	const start = new Date(today.getTime() - (range - 1) * DAY_MS);
	return {
		start,
		end,
		previousStart: new Date(start.getTime() - range * DAY_MS),
		previousEnd: start,
	};
}

interface SignupRow {
	day: string;
	total: number;
}

interface FeedBucketQueryRow {
	day: string;
	source: string;
	total: number;
	grams: number;
}

export async function getPlatformAnalytics(
	range: AnalyticsRange = DEFAULT_ANALYTICS_RANGE,
	now = new Date(),
): Promise<PlatformAnalytics> {
	// Gate before touching the database, so a non-platform admin can never
	// learn anything from a timing difference or a partially built result.
	await requirePlatformAdmin();

	const window = resolveAnalyticsWindow(range, now);
	const current = { gte: window.start, lt: window.end };
	const previous = { gte: window.previousStart, lt: window.previousEnd };
	const onlineCutoff = new Date(window.end.getTime() - OFFLINE_THRESHOLD_MS);

	const [
		userTotal,
		orgTotal,
		pondTotal,
		deviceTotal,
		deviceOnline,
		openAlerts,
		pendingApprovalTotal,
		newUsers,
		previousNewUsers,
		newOrgs,
		previousNewOrgs,
		newPonds,
		previousNewPonds,
		feeds,
		previousFeeds,
		newAlerts,
		previousNewAlerts,
		newPending,
		previousNewPending,
		signupRows,
		feedRows,
		alertGroups,
		stateGroups,
		fcrReports,
		offlineDevices,
		pendingDevices,
		failedJobs,
	] = await Promise.all([
		prisma.user.count(),
		prisma.organization.count(),
		prisma.pond.count(),
		prisma.energyDevice.count(),
		prisma.energyDevice.count({ where: { lastSeenAt: { gte: onlineCutoff } } }),
		prisma.notification.count({ where: { read: false, acknowledgedAt: null } }),
		prisma.energyDevice.count({ where: { approvalStatus: "PENDING" } }),
		prisma.user.count({ where: { createdAt: current } }),
		prisma.user.count({ where: { createdAt: previous } }),
		prisma.organization.count({ where: { createdAt: current } }),
		prisma.organization.count({ where: { createdAt: previous } }),
		prisma.pond.count({ where: { createdAt: current } }),
		prisma.pond.count({ where: { createdAt: previous } }),
		prisma.feedEvent.aggregate({
			where: { eventType: "feed_dispensed", receivedAt: current },
			_count: { _all: true },
			_sum: { grams: true },
		}),
		prisma.feedEvent.aggregate({
			where: { eventType: "feed_dispensed", receivedAt: previous },
			_count: { _all: true },
			_sum: { grams: true },
		}),
		prisma.notification.count({ where: { createdAt: current } }),
		prisma.notification.count({ where: { createdAt: previous } }),
		prisma.energyDevice.count({ where: { approvalStatus: "PENDING", createdAt: current } }),
		prisma.energyDevice.count({ where: { approvalStatus: "PENDING", createdAt: previous } }),
		prisma.$queryRaw<SignupRow[]>`
			SELECT to_char(date_trunc('day', "createdAt" AT TIME ZONE 'UTC' AT TIME ZONE ${PH_TZ}::text), 'YYYY-MM-DD') AS day,
			       COUNT(*)::int AS total
			FROM "User"
			WHERE "createdAt" >= ${window.start} AND "createdAt" < ${window.end}
			GROUP BY 1
			ORDER BY 1
		`,
		prisma.$queryRaw<FeedBucketQueryRow[]>`
			SELECT to_char(date_trunc('day', "receivedAt" AT TIME ZONE 'UTC' AT TIME ZONE ${PH_TZ}::text), 'YYYY-MM-DD') AS day,
			       COALESCE(NULLIF("source", ''), 'unknown') AS source,
			       COUNT(*)::int AS total,
			       COALESCE(SUM("grams"), 0)::float8 AS grams
			FROM "FeedEvent"
			WHERE "eventType" = 'feed_dispensed'
			  AND "receivedAt" >= ${window.start} AND "receivedAt" < ${window.end}
			GROUP BY 1, 2
			ORDER BY 1, 2
		`,
		prisma.deviceStateEvent.groupBy({
			by: ["eventType"],
			where: { eventType: { in: [...ALERT_EVENT_TYPES] }, createdAt: current },
			_count: { _all: true },
		}),
		prisma.deviceStateEvent.groupBy({
			by: ["eventType"],
			where: { eventType: { in: ["connected", "disconnected"] }, createdAt: previous },
			_count: { _all: true },
		}),
		prisma.fcrReport.findMany({
			where: {
				periodEnd: { gte: new Date(window.end.getTime() - TOP_FCR_LOOKBACK_DAYS * DAY_MS) },
			},
			orderBy: { periodEnd: "desc" },
			take: 100,
			select: {
				pondId: true,
				fcrValue: true,
				periodEnd: true,
				pond: { select: { name: true } },
			},
		}),
		prisma.energyDevice.findMany({
			where: { OR: [{ lastSeenAt: null }, { lastSeenAt: { lt: onlineCutoff } }] },
			orderBy: { lastSeenAt: "asc" },
			take: 20,
			select: {
				id: true,
				label: true,
				mac: true,
				lastSeenAt: true,
				pond: { select: { name: true } },
			},
		}),
		prisma.energyDevice.findMany({
			where: { approvalStatus: "PENDING" },
			orderBy: { createdAt: "asc" },
			take: 5,
			select: { id: true, label: true, mac: true, createdAt: true },
		}),
		prisma.backgroundJob.findMany({
			where: { status: "failed" },
			orderBy: { finishedAt: "desc" },
			take: 5,
			select: { id: true, type: true, error: true, finishedAt: true, createdAt: true },
		}),
	]);

	const dayKeys = buildDayKeys(window.start, window.end, PH_TZ).slice(-range);

	const signupsPerDay = fillDailySeries(
		signupRows.map((row) => ({ label: row.day, value: row.total })),
		dayKeys,
	);

	const feedsPerDayBySource = buildStackedSeries(
		feedRows.map((row) => ({
			label: row.day,
			source: row.source,
			count: row.total,
			grams: row.grams,
		})),
		dayKeys,
		{ value: "count" },
	);

	const gramsByDay = new Map<string, number>();
	for (const row of feedRows) {
		gramsByDay.set(row.day, (gramsByDay.get(row.day) ?? 0) + (Number(row.grams) || 0));
	}
	const kgPerDay = fillDailySeries(
		[...gramsByDay.entries()].map(([label, grams]) => ({
			label,
			value: Math.round((grams / 1000) * 100) / 100,
		})),
		dayKeys,
	);

	const feedsCount = feeds._count._all;
	const previousFeedsCount = previousFeeds._count._all;
	const kg = Math.round(((feeds._sum.grams ?? 0) / 1000) * 100) / 100;
	const previousKg = Math.round(((previousFeeds._sum.grams ?? 0) / 1000) * 100) / 100;

	const onlinePct = deviceTotal > 0 ? Math.round((deviceOnline / deviceTotal) * 1000) / 10 : 0;
	// There is no heartbeat history to replay, so the previous-period online
	// share is estimated from the connectivity transitions recorded in that
	// window. With no transitions the delta is unknown and the UI shows a dash.
	const transitions = new Map(stateGroups.map((row) => [row.eventType, row._count._all]));
	const connected = transitions.get("connected") ?? 0;
	const disconnected = transitions.get("disconnected") ?? 0;
	const previousOnlinePct =
		connected + disconnected > 0
			? Math.round((connected / (connected + disconnected)) * 1000) / 10
			: null;

	const feedsDelta = computeDelta(feedsCount, previousFeedsCount);
	const kgDelta = computeDelta(kg, previousKg);
	const usersDelta = computeDelta(newUsers, previousNewUsers);
	const orgsDelta = computeDelta(newOrgs, previousNewOrgs);
	const pondsDelta = computeDelta(newPonds, previousNewPonds);
	const alertsDelta = computeDelta(newAlerts, previousNewAlerts);
	const pendingDelta = computeDelta(newPending, previousNewPending);
	const onlineDelta = computePointDelta(onlinePct, previousOnlinePct);

	const alertsByType = alertGroups
		.map((row) => ({ type: row.eventType, count: row._count._all }))
		.sort((a, b) => b.count - a.count || a.type.localeCompare(b.type));

	// One row per pond: the most recent report wins, then the worst (highest)
	// FCR first — the list is "needs attention", not a leaderboard of the best.
	const seenPonds = new Set<string>();
	const topFcrPonds: FcrRankRow[] = [];
	for (const report of fcrReports) {
		if (seenPonds.has(report.pondId)) continue;
		seenPonds.add(report.pondId);
		topFcrPonds.push({
			pondId: report.pondId,
			pondName: report.pond.name,
			fcrValue: report.fcrValue,
			periodEnd: report.periodEnd,
		});
	}
	topFcrPonds.sort((a, b) => b.fcrValue - a.fcrValue);

	// Postgres puts NULLs last for ASC, so never-seen devices are moved to the
	// front explicitly before taking the five oldest.
	const mostOfflineFeeders = [...offlineDevices]
		.sort((a, b) => {
			if (!a.lastSeenAt && !b.lastSeenAt) return a.label.localeCompare(b.label);
			if (!a.lastSeenAt) return -1;
			if (!b.lastSeenAt) return 1;
			return a.lastSeenAt.getTime() - b.lastSeenAt.getTime();
		})
		.slice(0, 5)
		.map((device) => ({
			id: device.id,
			label: device.label,
			mac: device.mac,
			lastSeenAt: device.lastSeenAt,
			pondName: device.pond?.name ?? null,
		}));

	return {
		range,
		window,
		dayKeys,
		kpis: {
			users: {
				total: userTotal,
				newInRange: newUsers,
				previousNew: previousNewUsers,
				deltaPct: usersDelta.pct,
				direction: usersDelta.direction,
			},
			organizations: {
				total: orgTotal,
				newInRange: newOrgs,
				previousNew: previousNewOrgs,
				deltaPct: orgsDelta.pct,
				direction: orgsDelta.direction,
			},
			ponds: {
				total: pondTotal,
				newInRange: newPonds,
				previousNew: previousNewPonds,
				deltaPct: pondsDelta.pct,
				direction: pondsDelta.direction,
			},
			feedersOnline: {
				total: deviceTotal,
				online: deviceOnline,
				pct: onlinePct,
				previousPct: previousOnlinePct,
				deltaPct: onlineDelta.pct,
				direction: onlineDelta.direction,
			},
			feeds: {
				total: feedsCount,
				previous: previousFeedsCount,
				deltaPct: feedsDelta.pct,
				direction: feedsDelta.direction,
			},
			kgDispensed: {
				total: kg,
				previous: previousKg,
				deltaPct: kgDelta.pct,
				direction: kgDelta.direction,
			},
			openAlerts: {
				total: openAlerts,
				newInRange: newAlerts,
				previousNew: previousNewAlerts,
				deltaPct: alertsDelta.pct,
				direction: alertsDelta.direction,
			},
			pendingApprovals: {
				total: pendingApprovalTotal,
				newInRange: newPending,
				previousNew: previousNewPending,
				deltaPct: pendingDelta.pct,
				direction: pendingDelta.direction,
			},
		},
		signupsPerDay,
		feedsPerDayBySource,
		kgPerDay,
		deviceSplit: [
			{ name: "online", segment: "online", value: deviceOnline },
			{ name: "offline", segment: "offline", value: Math.max(0, deviceTotal - deviceOnline) },
		],
		alertsByType,
		topFcrPonds: topFcrPonds.slice(0, 5),
		mostOfflineFeeders,
		pendingApprovalDevices: pendingDevices,
		failedJobs: failedJobs.map((job) => ({
			id: job.id,
			type: job.type,
			error: job.error,
			at: job.finishedAt ?? job.createdAt,
		})),
	};
}
