import { buildDayKeys, buildHourKeys } from "@/components/charts/chart-data";
import { PH_TZ } from "@/lib/constants";

/**
 * Time windows for the pond charts (#188, E15).
 *
 * The charts bucket in the farm's local timezone (`Asia/Manila`) so a "day"
 * means a day the farmer recognises, not a UTC day. Everything here is pure
 * date math, kept out of the query module so the buckets can be unit tested
 * without a database.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

/** Feed dispensed is always charted over the last 30 local days. */
export const FEED_CHART_DAYS = 30;

/** Hopper level offers a week by default and a month on demand. */
export const HOPPER_RANGE_DAYS = [7, 30] as const;
export type HopperRange = (typeof HOPPER_RANGE_DAYS)[number];
export const DEFAULT_HOPPER_RANGE: HopperRange = 7;
/**
 * The History page opens on the month window. A feeder that was offline for
 * most of the last week can still have older readings, and a week containing a
 * single day would otherwise render as one lonely dot.
 */
export const DEFAULT_HISTORY_HOPPER_RANGE: HopperRange = 30;

/** Water temperature on the dashboard: the last day or the last week. */
export const WATER_TEMP_RANGES = ["24h", "7d"] as const;
export type WaterTempRange = (typeof WATER_TEMP_RANGES)[number];
export const DEFAULT_WATER_TEMP_RANGE: WaterTempRange = "24h";

/** Accept only the two supported hopper windows; anything else uses `fallback`. */
export function parseHopperRange(
	value: string | null | undefined,
	fallback: HopperRange = DEFAULT_HOPPER_RANGE,
): HopperRange {
	const parsed = Number.parseInt(value ?? "", 10);
	return (HOPPER_RANGE_DAYS as readonly number[]).includes(parsed)
		? (parsed as HopperRange)
		: fallback;
}

/** Accept only the two supported water windows; anything else is 24 hours. */
export function parseWaterTempRange(value: string | null | undefined): WaterTempRange {
	return value === "7d" ? "7d" : DEFAULT_WATER_TEMP_RANGE;
}

/** Offset of `timeZone` at `date`, in milliseconds (wall clock − UTC). */
function zoneOffsetMs(date: Date, timeZone: string): number {
	const formatter = new Intl.DateTimeFormat("en-US", {
		timeZone,
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
		hour: "2-digit",
		minute: "2-digit",
		second: "2-digit",
		hourCycle: "h23",
	});
	const parts = new Map(formatter.formatToParts(date).map((part) => [part.type, part.value]));
	const asUtc = Date.UTC(
		Number(parts.get("year")),
		Number(parts.get("month")) - 1,
		Number(parts.get("day")),
		Number(parts.get("hour")),
		Number(parts.get("minute")),
		Number(parts.get("second")),
	);
	return asUtc - date.getTime();
}

/** Start of the local day (or hour) that contains `date`, as an instant. */
function startOfLocalUnit(date: Date, timeZone: string, unit: "day" | "hour"): Date {
	const formatter = new Intl.DateTimeFormat("en-US", {
		timeZone,
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
		...(unit === "hour" ? { hour: "2-digit", hourCycle: "h23" } : {}),
	});
	const parts = new Map(formatter.formatToParts(date).map((part) => [part.type, part.value]));
	const utcStart = Date.UTC(
		Number(parts.get("year")),
		Number(parts.get("month")) - 1,
		Number(parts.get("day")),
		unit === "hour" ? Number(parts.get("hour")) : 0,
	);
	let instant = new Date(utcStart - zoneOffsetMs(new Date(utcStart), timeZone));
	// Second pass settles zones whose offset changed between the guess and the
	// resulting instant (not needed in Asia/Manila, harmless elsewhere).
	instant = new Date(utcStart - zoneOffsetMs(instant, timeZone));
	return instant;
}

/** Midnight at the start of `date`'s local day, as an instant. */
export function startOfDayInTimeZone(date: Date, timeZone = PH_TZ): Date {
	return startOfLocalUnit(date, timeZone, "day");
}

/** Start of `date`'s local hour, as an instant. */
export function startOfHourInTimeZone(date: Date, timeZone = PH_TZ): Date {
	return startOfLocalUnit(date, timeZone, "hour");
}

export interface DayWindow {
	/** Local midnight `days - 1` days before today. */
	start: Date;
	/** The instant the page was rendered. */
	end: Date;
	/** One `YYYY-MM-DD` key per local day in the window, oldest first. */
	dayKeys: string[];
}

/** A continuous window of `days` local days, ending today. */
export function resolveDayWindow(days: number, now = new Date(), timeZone = PH_TZ): DayWindow {
	const end = now;
	const today = startOfDayInTimeZone(end, timeZone);
	const start = new Date(today.getTime() - (days - 1) * DAY_MS);
	return { start, end, dayKeys: buildDayKeys(start, end, timeZone) };
}

export interface WaterTempWindow {
	start: Date;
	end: Date;
	/** `hour` for the 24 h view, `day` for the 7 d view. */
	bucket: "hour" | "day";
	/** One label per bucket in the window, oldest first. */
	keys: string[];
}

/**
 * The water-temperature window. 24 h gives 24 hourly buckets so a handful of
 * readings still draws a trend; a week is bucketed per day.
 *
 * `startAt` is the active cycle's stocking date. When it falls inside the
 * requested window, the axis starts there instead of showing hours before the
 * fish were released. A missing or older date leaves the normal window intact.
 */
export function resolveWaterTempWindow(
	range: WaterTempRange,
	now = new Date(),
	startAt: Date | null = null,
): WaterTempWindow {
	let start: Date;
	let end = now;
	let bucket: "hour" | "day";

	if (range === "24h") {
		start = new Date(startOfHourInTimeZone(end).getTime() - 23 * HOUR_MS);
		bucket = "hour";
	} else {
		const window = resolveDayWindow(7, now);
		start = window.start;
		end = window.end;
		bucket = "day";
	}

	if (startAt) {
		const releaseStart = startOfDayInTimeZone(startAt);
		if (releaseStart > start && releaseStart < end) start = releaseStart;
	}

	const keys = bucket === "hour" ? buildHourKeys(start, end) : buildDayKeys(start, end);
	return { start, end, bucket, keys };
}
