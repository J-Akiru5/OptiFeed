import type { ChartPoint, DailyRow, FeedBucketRow } from "@/components/charts/chart-data";
import { OFFLINE_THRESHOLD_MS } from "@/lib/constants";
import { farmWallClock } from "@/lib/date-local";

/**
 * Pure data shaping for the farm-owner Admin Overview (#277).
 *
 * The page needs three graphs — feed dispensed per day, device activity per day
 * and fleet health — and every bucket must use the farm's own day (Asia/Manila),
 * not the UTC day. Keeping the maths here means it is unit-tested without a
 * database and the chart components stay presentation-only.
 */

/** Feed dispensed is charted over the same 30 farm days as the farmer History. */
export const ADMIN_FEED_DAYS = 30;

/** Device activity is a shorter window so a quiet week is obvious. */
export const ADMIN_ACTIVITY_DAYS = 14;

export interface AdminOverviewDevice {
	lastSeenAt: Date | null;
	approvalStatus: string;
	isPaused: boolean;
}

export interface AdminOverviewFeedEvent {
	grams: number | null;
	source: string | null;
	receivedAt: Date;
}

export interface AdminOverviewActivityEvent {
	createdAt: Date;
}

export interface AdminDeviceHealth {
	online: number;
	offline: number;
	pending: number;
	paused: number;
	total: number;
}

/** `YYYY-MM-DD` for the Asia/Manila day that contains `date`. */
export function farmDayKey(date: Date): string {
	const clock = farmWallClock(date);
	return `${clock.year}-${String(clock.month).padStart(2, "0")}-${String(clock.day).padStart(2, "0")}`;
}

/**
 * Fleet health with one offline rule, reused from `isDeviceOffline`:
 * no heartbeat within `OFFLINE_THRESHOLD_MS`.
 *
 * A device awaiting approval is counted as `pending`, not online/offline, so
 * the three donut segments always add up to `total`.
 */
export function buildDeviceHealth(
	devices: ReadonlyArray<AdminOverviewDevice>,
	now: Date = new Date(),
): AdminDeviceHealth {
	let online = 0;
	let offline = 0;
	let pending = 0;
	let paused = 0;

	for (const device of devices) {
		if (device.isPaused) paused += 1;
		if (device.approvalStatus === "PENDING") {
			pending += 1;
			continue;
		}
		if (device.lastSeenAt && now.getTime() - device.lastSeenAt.getTime() <= OFFLINE_THRESHOLD_MS) {
			online += 1;
		} else {
			offline += 1;
		}
	}

	return { online, offline, pending, paused, total: devices.length };
}

/** Raw feed events → `(farm day, source)` buckets for `buildStackedSeries`. */
export function buildFeedRows(events: ReadonlyArray<AdminOverviewFeedEvent>): FeedBucketRow[] {
	return events.map((event) => ({
		label: farmDayKey(event.receivedAt),
		source: event.source ?? "unknown",
		count: 1,
		grams: typeof event.grams === "number" && Number.isFinite(event.grams) ? event.grams : 0,
	}));
}

/** Raw activity events → one count per farm day for `fillDailySeries`. */
export function buildActivityRows(events: ReadonlyArray<AdminOverviewActivityEvent>): DailyRow[] {
	return events.map((event) => ({ label: farmDayKey(event.createdAt), value: 1 }));
}

/** The empty feed series; the chart frame treats an empty row list as "no data". */
export const EMPTY_FEED_SERIES = {
	sources: [] as string[],
	rows: [] as Array<{ label: string } & Record<string, number | string>>,
	totalsBySource: {} as Record<string, number>,
};

/** Empty activity points; an empty array (not 14 zeroes) renders the empty state. */
export const EMPTY_ACTIVITY_POINTS: ChartPoint[] = [];
