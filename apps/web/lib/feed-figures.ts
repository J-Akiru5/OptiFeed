import { startOfDayInTimeZone } from "@/lib/chart-windows";
import { PH_TZ } from "@/lib/constants";

/**
 * Shared feed-figure rules (issue #236).
 *
 * The History page used to add up the grams of whatever rows happened to be on
 * the first page and call that "Recent Feed Dispensed". One page mixes machine
 * dispenses (at most 1,000 g each) with imported `hand_fed` rows, which are a
 * whole day's hand feeding, so the sum was not a dispense and not a window.
 *
 * These helpers keep the answer to a farmer's real questions — what the last
 * machine dispense was, what went in today, and what the week totals — in one
 * place, with one unit rule.
 */

/** Sources the device itself reports. Each row is one dispense. */
export const MACHINE_FEED_SOURCES = ["scheduled", "dashboard", "button"] as const;

type MachineFeedSource = (typeof MACHINE_FEED_SOURCES)[number];

/** Imported precision-feeding record. One row is a whole day, not a dispense. */
export const HAND_FED_SOURCE = "hand_fed";

export function isMachineFeedSource(source: string | null | undefined): boolean {
	return !!source && (MACHINE_FEED_SOURCES as readonly string[]).includes(source);
}

/** True for a `hand_fed` row, which is a daily total and must be labelled so. */
export function isDailyTotalSource(source: string | null | undefined): boolean {
	return source === HAND_FED_SOURCE;
}

export interface FeedAmount {
	value: string;
	unit: "g" | "kg";
}

/**
 * One consistent rendering for every feed amount:
 *
 * - below 1,000 g the number stays in grams (`500 g`);
 * - at or above 1,000 g it becomes kilograms with two decimals
 *   (`1,240 g` → `1.24 kg`), so no figure is silently rounded to `1 kg`.
 *
 * Units are symbols, not translated words — the same in English and Hiligaynon.
 */
export function formatFeedAmount(grams: number | null | undefined, locale = "en-US"): FeedAmount {
	const amount = typeof grams === "number" && Number.isFinite(grams) ? Math.max(0, grams) : 0;
	if (amount >= 1000) {
		return {
			value: (amount / 1000).toLocaleString(locale, {
				minimumFractionDigits: 2,
				maximumFractionDigits: 2,
			}),
			unit: "kg",
		};
	}
	return {
		value: amount.toLocaleString(locale, { maximumFractionDigits: 1 }),
		unit: "g",
	};
}

/** `formatFeedAmount` as a single label, e.g. `1.04 kg`. */
export function formatFeedAmountLabel(grams: number | null | undefined, locale = "en-US"): string {
	const { value, unit } = formatFeedAmount(grams, locale);
	return `${value} ${unit}`;
}

/** Start of the Asia/Manila farm day that contains `now`. */
export function startOfFarmDay(now = new Date()): Date {
	return startOfDayInTimeZone(now, PH_TZ);
}

/** Totals the History summary cards show. All grams, all in the farm day. */
export interface FeedTotals {
	/** Most recent row the device dispensed itself; `hand_fed` never qualifies. */
	lastMachineFeed: { grams: number; source: string; receivedAt: Date } | null;
	/** Every source, current Asia/Manila day (feed given, not only machine). */
	todayGrams: number;
	todayCount: number;
	/** Every source, the 7 farm days ending today. */
	last7DaysGrams: number;
	last7DaysCount: number;
	last7DaysDailyAverageG: number;
}

export const EMPTY_FEED_TOTALS: FeedTotals = {
	lastMachineFeed: null,
	todayGrams: 0,
	todayCount: 0,
	last7DaysGrams: 0,
	last7DaysCount: 0,
	last7DaysDailyAverageG: 0,
};
