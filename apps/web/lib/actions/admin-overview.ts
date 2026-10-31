"use server";

import {
	type ChartPoint,
	type StackedSeries,
	buildStackedSeries,
	fillDailySeries,
} from "@/components/charts/chart-data";
import {
	ADMIN_ACTIVITY_DAYS,
	ADMIN_FEED_DAYS,
	type AdminDeviceHealth,
	EMPTY_ACTIVITY_POINTS,
	EMPTY_FEED_SERIES,
	buildActivityRows,
	buildDeviceHealth,
	buildFeedRows,
	trimTruncatedDayKeys,
} from "@/lib/admin-overview";
import { resolveOrgScope } from "@/lib/auth/org-scope";
import { requireTenantAdmin } from "@/lib/auth/tenant-admin";
import { resolveDayWindow } from "@/lib/chart-windows";
import prisma from "@/lib/prisma";
import { getDeviceStatusPolicy } from "@/lib/settings/device-status";

/**
 * Read-only data for the farm-owner Admin Overview graphs (#277).
 *
 * Separate from `getAdminStats` so the existing counts/recent-activity contract
 * and its tenancy tests stay untouched. Every query is scoped to the caller's
 * organization (`resolveOrgScope().pondIds`), and the whole action is gated by
 * `requireTenantAdmin`.
 */

export interface AdminOverviewData {
	deviceHealth: AdminDeviceHealth;
	feedStack: StackedSeries;
	activityPoints: ChartPoint[];
	feedDays: number;
	activityDays: number;
	feedTotalGrams: number;
	activityTotal: number;
	/** Inclusive farm-day keys for the activity window, even when empty. */
	activityFrom: string | null;
	activityTo: string | null;
	/** The 5,000-row cap bound, so the totals are a lower bound and the oldest day is partial. */
	feedTruncated: boolean;
	activityTruncated: boolean;
}

/**
 * Hard row ceiling per series. The windows are 30 and 14 days; a farm with
 * hundreds of devices can still produce more rows, so the chart shows the most
 * recent 5,000 rather than an unbounded read. The counts remain a floor, not a
 * silently claimed exact total.
 */
const OVERVIEW_ROW_LIMIT = 5_000;

/** Cap the device list; a tenant with more than 500 feeders is out of scope. */
const OVERVIEW_DEVICE_LIMIT = 500;

function emptyOverview(): AdminOverviewData {
	return {
		deviceHealth: { online: 0, offline: 0, pending: 0, paused: 0, total: 0 },
		feedStack: EMPTY_FEED_SERIES,
		activityPoints: EMPTY_ACTIVITY_POINTS,
		feedDays: ADMIN_FEED_DAYS,
		activityDays: ADMIN_ACTIVITY_DAYS,
		feedTotalGrams: 0,
		activityTotal: 0,
		activityFrom: null,
		activityTo: null,
		feedTruncated: false,
		activityTruncated: false,
	};
}

export async function getAdminOverview(): Promise<AdminOverviewData> {
	await requireTenantAdmin();
	const scope = await resolveOrgScope();

	if (scope.pondIds.length === 0) return emptyOverview();

	const now = new Date();
	const statusPolicy = await getDeviceStatusPolicy();
	const feedWindow = resolveDayWindow(ADMIN_FEED_DAYS, now);
	const activityWindow = resolveDayWindow(ADMIN_ACTIVITY_DAYS, now);

	const [devices, feedEvents, activityEvents] = await Promise.all([
		prisma.energyDevice.findMany({
			where: { pondId: { in: scope.pondIds } },
			select: { lastSeenAt: true, approvalStatus: true, isPaused: true },
			take: OVERVIEW_DEVICE_LIMIT,
			orderBy: { createdAt: "asc" },
		}),
		prisma.feedEvent.findMany({
			where: {
				device: { pondId: { in: scope.pondIds } },
				eventType: "feed_dispensed",
				receivedAt: { gte: feedWindow.start },
			},
			select: { grams: true, source: true, receivedAt: true },
			orderBy: { receivedAt: "desc" },
			take: OVERVIEW_ROW_LIMIT,
		}),
		prisma.deviceStateEvent.findMany({
			where: {
				device: { pondId: { in: scope.pondIds } },
				createdAt: { gte: activityWindow.start },
			},
			select: { createdAt: true },
			orderBy: { createdAt: "desc" },
			take: OVERVIEW_ROW_LIMIT,
		}),
	]);

	const feedTruncated = feedEvents.length >= OVERVIEW_ROW_LIMIT;
	const activityTruncated = activityEvents.length >= OVERVIEW_ROW_LIMIT;

	const feedRows = buildFeedRows(feedEvents);
	const feedKeys = trimTruncatedDayKeys(
		feedWindow.dayKeys,
		feedEvents.at(-1)?.receivedAt ?? null,
		feedTruncated,
	);
	const feedStack =
		feedRows.length > 0
			? buildStackedSeries(feedRows, feedKeys, { value: "grams" })
			: EMPTY_FEED_SERIES;

	const activityRows = buildActivityRows(activityEvents);
	const activityKeys = trimTruncatedDayKeys(
		activityWindow.dayKeys,
		activityEvents.at(-1)?.createdAt ?? null,
		activityTruncated,
	);
	const activityPoints =
		activityRows.length > 0 ? fillDailySeries(activityRows, activityKeys) : EMPTY_ACTIVITY_POINTS;

	const feedTotalGrams = Object.values(feedStack.totalsBySource).reduce(
		(total, grams) => total + (Number.isFinite(grams) ? grams : 0),
		0,
	);
	const activityTotal = activityPoints.reduce(
		(total, point) => total + (Number.isFinite(point.value) ? point.value : 0),
		0,
	);

	return {
		deviceHealth: buildDeviceHealth(devices, now, statusPolicy),
		feedStack,
		activityPoints,
		feedDays: ADMIN_FEED_DAYS,
		activityDays: ADMIN_ACTIVITY_DAYS,
		feedTotalGrams,
		activityTotal,
		activityFrom: activityWindow.dayKeys[0] ?? null,
		activityTo: activityWindow.dayKeys.at(-1) ?? null,
		feedTruncated,
		activityTruncated,
	};
}
