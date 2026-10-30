/**
 * Zod-free limit helpers. Client components import these directly so the
 * validation library stays out of their first-load bundle; `lib/limits.ts`
 * re-exports everything here for server code.
 */

export const MAX_FEED_GRAMS_PER_DAY_PER_DEVICE = 5000;
export const MAX_DISPENSE_MS = 300_000;
/** Calibration is the one deliberate exception: a measured run may last 10 minutes. */
export const CALIBRATION_MAX_DISPENSE_MS = 600_000;

/**
 * The only gram cap is the daily ceiling (`resolveDailyCapG`).
 *
 * This constant is deliberately NOT a per-dose limit: it is the schema sanity
 * bound, equal to the daily hard guard, so malformed input (a typo or an attack
 * payload) is rejected. Any dose up to the remaining daily ceiling is valid.
 * The firmware's own per-dispense guard is a separate hardware safety check.
 */
export const MAX_ACCEPTED_FEED_GRAMS = MAX_FEED_GRAMS_PER_DAY_PER_DEVICE;

export interface FeedNowLimit {
	/** The highest grams a manual Feed Now may dispense right now. */
	effectiveG: number;
	/** The resolved daily ceiling for this device. */
	dailyCapG: number;
	/** Grams already queued/dispensed today (Asia/Manila). */
	usedTodayG: number;
	/** What is left of the daily ceiling (never negative). */
	remainingDailyG: number;
}

/**
 * Resolve the manual Feed Now ceiling (issue #387 / #398).
 *
 * The daily ceiling is the only gram cap: a manual feed may use whatever is
 * left of `resolveDailyCapG()` today. There is no per-request or per-meal gram
 * limit. Callers must not do this arithmetic themselves.
 */
export function resolveFeedNowLimitG(input: {
	/** The resolved daily ceiling (`resolveDailyCapG()`); defaults to the standard cap. */
	dailyCapG?: number | null;
	/** Grams already queued/dispensed today (Asia/Manila). */
	usedTodayG?: number | null;
}): FeedNowLimit {
	const dailyCapG =
		typeof input.dailyCapG === "number" && Number.isFinite(input.dailyCapG) && input.dailyCapG > 0
			? input.dailyCapG
			: resolveDailyCapG({});
	const usedTodayG =
		typeof input.usedTodayG === "number" &&
		Number.isFinite(input.usedTodayG) &&
		input.usedTodayG > 0
			? input.usedTodayG
			: 0;
	const remainingDailyG = Math.max(0, dailyCapG - usedTodayG);

	return {
		effectiveG: remainingDailyG,
		dailyCapG,
		usedTodayG,
		remainingDailyG,
	};
}

/** Grams for a message: one decimal at most, never a thousands separator. */
export function formatFeedGrams(value: number): string {
	if (!Number.isFinite(value)) return "—";
	return String(Math.round(value * 10) / 10);
}

/**
 * The refusal text for a Feed Now request above the remaining daily ceiling
 * (issue #387 / #398). It names the number the operator needs and where to
 * change it.
 */
export function feedNowLimitMessage(limit: FeedNowLimit): string {
	return `Feed Now would exceed today's daily ceiling: ${formatFeedGrams(limit.remainingDailyG)} g left of ${formatFeedGrams(limit.dailyCapG)} g. Change it in Settings > Pond or the device daily ceiling in Settings > Hardware.`;
}

export const DAILY_CAP_MIN_G = 500;
export const DEFAULT_DAILY_CAP_G = 2000;

/** Coerce any stored value into the writable window; null/invalid → the default. */
export function normalizeDailyCapG(value: number | null | undefined): number {
	if (typeof value !== "number" || !Number.isFinite(value)) return DEFAULT_DAILY_CAP_G;
	return Math.min(Math.max(Math.round(value), DAILY_CAP_MIN_G), MAX_FEED_GRAMS_PER_DAY_PER_DEVICE);
}

export interface DailyCapInput {
	/** The pond's configured ceiling; null/undefined uses DEFAULT_DAILY_CAP_G. */
	configuredCapG?: number | null;
	/** Physical hopper capacity, when calibrated. */
	hopperCapacityG?: number | null;
	/** Platform safety multiplier (0-1); may only lower the cap. */
	dailyCapFactor?: number | null;
}

/**
 * The one daily-cap calculation. Every server path (schedule save, manual feed,
 * calibration, prediction, pond edit) must call this instead of doing the
 * arithmetic itself, so a tightened platform cap and a raised farmer ceiling
 * cannot disagree between screens.
 */
export function resolveDailyCapG(input: DailyCapInput = {}): number {
	const configured = normalizeDailyCapG(input.configuredCapG);
	const factor =
		typeof input.dailyCapFactor === "number" && Number.isFinite(input.dailyCapFactor)
			? Math.min(Math.max(input.dailyCapFactor, 0), 1)
			: 1;
	const platformCapped = configured * factor;
	const hopper =
		typeof input.hopperCapacityG === "number" &&
		Number.isFinite(input.hopperCapacityG) &&
		input.hopperCapacityG > 0
			? input.hopperCapacityG
			: null;
	const capped = hopper === null ? platformCapped : Math.min(platformCapped, hopper);
	return Math.round(capped * 100) / 100;
}

export function clamp(value: number, min: number, max: number): number {
	return Math.min(Math.max(value, min), max);
}
