import { PH_TZ } from "@/lib/constants";
import { farmWallClock } from "@/lib/date-local";

/**
 * Next scheduled feeding for a pond, in the farm's wall clock (Asia/Manila).
 *
 * `Pond.scheduleStart` / `Pond.scheduleEnd` are stored as `@db.Time` and read
 * back with the farm wall-clock hour in their UTC components (the rest of the
 * app formats them with `getUTCHours()`), so this module never converts them to
 * an instant. The comparison is wall clock against wall clock, which keeps the
 * answer correct no matter which timezone the server renders in.
 *
 * A schedule that ends before it starts is an overnight window: its tail runs
 * after midnight, so the previous day's series is a candidate too.
 */

const MINUTES_PER_DAY = 24 * 60;
const MAX_FEEDS_PER_DAY = 24;

export interface NextFeedingSlot {
	/** Farm wall-clock hour, 0-23. */
	hours: number;
	/** Farm wall-clock minute, 0-59. */
	minutes: number;
	/** 0 = later today, 1 = tomorrow. */
	dayOffset: 0 | 1;
}

export interface NextFeedingInput {
	scheduleStart: Date;
	scheduleEnd: Date;
	feedsPerDay: number;
	now?: Date;
	timeZone?: string;
}

function wallClockMinutesOfDay(value: Date): number {
	return value.getUTCHours() * 60 + value.getUTCMinutes();
}

function clampFeedsPerDay(feedsPerDay: number): number {
	if (!Number.isFinite(feedsPerDay)) return 1;
	return Math.min(MAX_FEEDS_PER_DAY, Math.max(1, Math.round(feedsPerDay)));
}

function toSlot(minutesFromTodayMidnight: number): NextFeedingSlot {
	const dayOffset = minutesFromTodayMidnight >= MINUTES_PER_DAY ? 1 : 0;
	const withinDay =
		((minutesFromTodayMidnight % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
	return { hours: Math.floor(withinDay / 60), minutes: withinDay % 60, dayOffset };
}

/**
 * The next feed time for a schedule, or null when the stored times are invalid.
 *
 * Feed `i` of `n` sits evenly between the start and end of the window, matching
 * the device's own spacing. Slots are compared in minutes from the current
 * farm day's midnight; candidates from yesterday's overnight tail and today's
 * whole series are considered, and the earliest one in the future wins.
 */
export function computeNextFeedingSlot(input: NextFeedingInput): NextFeedingSlot | null {
	const start = wallClockMinutesOfDay(input.scheduleStart);
	const rawEnd = wallClockMinutesOfDay(input.scheduleEnd);
	if (!Number.isFinite(start) || !Number.isFinite(rawEnd)) return null;

	const feeds = clampFeedsPerDay(input.feedsPerDay);
	const end = rawEnd >= start ? rawEnd : rawEnd + MINUTES_PER_DAY;
	const interval = feeds > 1 ? (end - start) / (feeds - 1) : 0;

	const clock = farmWallClock(input.now ?? new Date(), input.timeZone ?? PH_TZ);
	const nowMinutes = clock.hour * 60 + clock.minute;

	// Today's series, the tail of yesterday's series (overnight schedules), and
	// tomorrow's series as the fallback when every slot has already passed.
	const seriesOffsets = [0, -MINUTES_PER_DAY, MINUTES_PER_DAY];
	let next: number | null = null;
	for (const offset of seriesOffsets) {
		for (let index = 0; index < feeds; index += 1) {
			const minutes = offset + Math.round(start + index * interval);
			if (minutes <= nowMinutes) continue;
			if (next === null || minutes < next) next = minutes;
		}
	}

	return toSlot(next ?? start + MINUTES_PER_DAY);
}
