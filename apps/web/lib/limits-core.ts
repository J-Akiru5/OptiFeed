/**
 * Zod-free limit helpers. Client components import these directly so the
 * validation library stays out of their first-load bundle; `lib/limits.ts`
 * re-exports everything here for server code.
 */

export const MAX_FEED_GRAMS_PER_REQUEST = 1000;
export const MAX_FEED_GRAMS_PER_DAY_PER_DEVICE = 5000;
export const MAX_DISPENSE_MS = 300_000;
/** Calibration is the one deliberate exception: a measured run may last 10 minutes. */
export const CALIBRATION_MAX_DISPENSE_MS = 600_000;

/**
 * Why a Feed Now request was limited. The effective limit is the lowest of:
 * - the pond/device per-meal ceiling (`EnergyDevice.gramsPerFeeding`),
 * - the remaining daily ceiling from `resolveDailyCapG()`,
 * - the absolute safety ceiling `MAX_FEED_GRAMS_PER_REQUEST`.
 */
export type FeedNowLimitSource = "hard_ceiling" | "pond_per_meal" | "remaining_daily";

export interface FeedNowLimit {
	/** The highest grams a manual Feed Now may dispense right now. */
	effectiveG: number;
	/** The configured per-meal ceiling (not clamped; may exceed the hard ceiling). */
	perMealCeilingG: number;
	/** The absolute safety ceiling (`MAX_FEED_GRAMS_PER_REQUEST`). */
	hardCeilingG: number;
	/** What is left of the daily ceiling (never negative). */
	remainingDailyG: number;
	/** Which ceiling produced `effectiveG`. */
	source: FeedNowLimitSource;
}

/**
 * Resolve the manual Feed Now ceiling (issue #387, decision E30).
 *
 * The pond/device per-meal dose is the farm's chosen ceiling, but it can only
 * lower the manual limit: `MAX_FEED_GRAMS_PER_REQUEST` stays the absolute hard
 * safety ceiling and is never raised. The remaining daily allowance can lower
 * it further, and comes from the same resolved daily cap every server path
 * uses. Callers must not do this arithmetic themselves.
 */
export function resolveFeedNowLimitG(input: {
	/** `EnergyDevice.gramsPerFeeding` — the configured per-meal dose. */
	perMealG?: number | null;
	/** The resolved daily ceiling (`resolveDailyCapG()`); defaults to the standard cap. */
	dailyCapG?: number | null;
	/** Grams already queued/dispensed today (Asia/Manila). */
	usedTodayG?: number | null;
}): FeedNowLimit {
	const hardCeilingG = MAX_FEED_GRAMS_PER_REQUEST;
	const configuredPerMeal =
		typeof input.perMealG === "number" && Number.isFinite(input.perMealG) && input.perMealG > 0
			? input.perMealG
			: hardCeilingG;
	const manualCeiling = Math.min(configuredPerMeal, hardCeilingG);
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
	const effectiveG = Math.min(manualCeiling, remainingDailyG);

	let source: FeedNowLimitSource = "hard_ceiling";
	if (remainingDailyG < manualCeiling) source = "remaining_daily";
	else if (configuredPerMeal < hardCeilingG) source = "pond_per_meal";

	return {
		effectiveG,
		perMealCeilingG: configuredPerMeal,
		hardCeilingG,
		remainingDailyG,
		source,
	};
}

/** Grams for a message: one decimal at most, never a thousands separator. */
export function formatFeedGrams(value: number): string {
	if (!Number.isFinite(value)) return "—";
	return String(Math.round(value * 10) / 10);
}

/**
 * The refusal text for a Feed Now request above the effective limit. It names
 * every setting and number the operator needs (issue #387): the limit that
 * tripped, the pond per-meal ceiling, the absolute safety ceiling, the
 * remaining daily ceiling, and where to change it.
 */
export function feedNowLimitMessage(limit: FeedNowLimit): string {
	const reason =
		limit.source === "remaining_daily"
			? "remaining daily ceiling"
			: limit.source === "pond_per_meal"
				? "pond per-meal ceiling"
				: "absolute safety ceiling";
	return `Feed Now limit is ${formatFeedGrams(limit.effectiveG)} g (${reason}). Pond per-meal ceiling: ${formatFeedGrams(limit.perMealCeilingG)} g. Absolute safety ceiling: ${formatFeedGrams(limit.hardCeilingG)} g. Remaining daily ceiling: ${formatFeedGrams(limit.remainingDailyG)} g. Change the pond feeding rate or meals per day in Settings > Pond.`;
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
