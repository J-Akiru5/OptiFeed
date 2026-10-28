import { z } from "zod";

export const MAX_FEED_GRAMS_PER_REQUEST = 1000;
export const MAX_FEED_GRAMS_PER_DAY_PER_DEVICE = 5000;
export const MAX_DISPENSE_MS = 300_000;

export const FEEDING_RATE_PCT_MIN = 0.1;
export const FEEDING_RATE_PCT_MAX = 10;
export const FEEDS_PER_DAY_MIN = 1;
export const FEEDS_PER_DAY_MAX = 24;
export const BUTTON_FEED_GRAMS_MIN = 1;
export const BUTTON_FEED_GRAMS_MAX = 500;
export const POPULATION_MIN = 1;
export const POPULATION_MAX = 1_000_000;
export const SAMPLE_COUNT_MIN = 1;

export const GRAMS_PER_SECOND_MIN = 0.5;
export const GRAMS_PER_SECOND_MAX = 50;
export const TEMP_OFFSET_C_MIN = -20;
export const TEMP_OFFSET_C_MAX = 20;

// Hopper shape calibration. The empty distance must be larger than the full
// distance (the sensor measures downward), and a capacity of zero would make
// the daily feed cap fall back to the hard maximum, so it is rejected.
export const HOPPER_FULL_CM_MAX = 200;
export const HOPPER_EMPTY_CM_MAX = 500;
export const HOPPER_CAPACITY_G_MAX = 50_000;

export const hopperCalibrationSchema = z
	.object({
		hopperFullCm: z
			.number("Full distance must be a number")
			.finite("Full distance must be a number")
			.min(0, "Full distance cannot be negative")
			.max(HOPPER_FULL_CM_MAX, `Full distance cannot exceed ${HOPPER_FULL_CM_MAX} cm`),
		hopperEmptyCm: z
			.number("Empty distance must be a number")
			.finite("Empty distance must be a number")
			.min(0, "Empty distance cannot be negative")
			.max(HOPPER_EMPTY_CM_MAX, `Empty distance cannot exceed ${HOPPER_EMPTY_CM_MAX} cm`),
		hopperCapacityG: z
			.number("Hopper capacity must be a number")
			.finite("Hopper capacity must be a number")
			.min(1, "Hopper capacity must be greater than 0 g")
			.max(HOPPER_CAPACITY_G_MAX, `Hopper capacity cannot exceed ${HOPPER_CAPACITY_G_MAX} g`),
	})
	.refine((value) => value.hopperEmptyCm > value.hopperFullCm, {
		message: "The empty distance must be greater than the full distance",
		path: ["hopperEmptyCm"],
	});

// Guided motor calibration: run the motor for a bounded test window, weigh the
// output, then derive grams per second. The upper bounds keep a test dose
// inside the per-request feed cap and the weighed output physically plausible.
export const CALIBRATION_TEST_SECONDS_MIN = 3;
export const CALIBRATION_TEST_SECONDS_MAX = 30;
export const CALIBRATION_TEST_GRAMS_MAX = 1000;
export const CALIBRATION_ACTUAL_GRAMS_MAX = 2000;

// Target check (issue #191): dispense an exact target, weigh it, and correct
// grams per second from the error. The target bounds match the dashboard Feed
// Now cap; ±5% is the acceptance window.
export const TARGET_CHECK_GRAMS_MIN = 5;
export const TARGET_CHECK_GRAMS_MAX = 500;
export const TARGET_CHECK_TOLERANCE_PCT = 5;

export { OFFLINE_THRESHOLD_MS } from "./constants";

export const feedingRatePctSchema = z
	.number("Feeding rate must be a number")
	.min(FEEDING_RATE_PCT_MIN, `Feeding rate must be at least ${FEEDING_RATE_PCT_MIN}%`)
	.max(FEEDING_RATE_PCT_MAX, `Feeding rate cannot exceed ${FEEDING_RATE_PCT_MAX}%`);

export const feedsPerDaySchema = z
	.number("Feeds per day must be a number")
	.int("Feeds per day must be a whole number")
	.min(FEEDS_PER_DAY_MIN, `Feeds per day must be at least ${FEEDS_PER_DAY_MIN}`)
	.max(FEEDS_PER_DAY_MAX, `Feeds per day cannot exceed ${FEEDS_PER_DAY_MAX}`);

export const buttonFeedGramsSchema = z
	.number("Button feed amount must be a number")
	.min(BUTTON_FEED_GRAMS_MIN, `Button feed amount must be at least ${BUTTON_FEED_GRAMS_MIN} g`)
	.max(BUTTON_FEED_GRAMS_MAX, `Button feed amount cannot exceed ${BUTTON_FEED_GRAMS_MAX} g`);

export const populationSchema = z
	.number("Population must be a number")
	.int("Population must be a whole number")
	.min(POPULATION_MIN, `Population must be at least ${POPULATION_MIN}`)
	.max(POPULATION_MAX, `Population cannot exceed ${POPULATION_MAX.toLocaleString("en-US")}`);

export const feedGramsSchema = z
	.number("Feed amount must be a number")
	.min(1, "Feed amount must be at least 1 g")
	.max(
		MAX_FEED_GRAMS_PER_REQUEST,
		`Feed amount cannot exceed ${MAX_FEED_GRAMS_PER_REQUEST} g per request`,
	);

const hhmm = /^([01]\d|2[0-3]):[0-5]\d$/;

export const scheduleInputSchema = z.object({
	scheduleStart: z.string().regex(hhmm, "Schedule start must be a time in HH:MM format"),
	scheduleEnd: z.string().regex(hhmm, "Schedule end must be a time in HH:MM format"),
	feedsPerDay: feedsPerDaySchema,
	feedingRatePct: feedingRatePctSchema,
	buttonFeedGrams: buttonFeedGramsSchema.optional(),
});

export const pondSettingsSchema = z.object({
	feedingRatePct: feedingRatePctSchema,
	feedsPerDay: feedsPerDaySchema,
	population: populationSchema.nullish(),
});

export const biomassLogSchema = z.object({
	sampleCount: z
		.number("Sample count must be a number")
		.int("Sample count must be a whole number")
		.min(SAMPLE_COUNT_MIN, `Sample count must be at least ${SAMPLE_COUNT_MIN}`),
	sampleWeightKg: z
		.number("Sample weight must be a number")
		.refine((v) => v > 0, "Sample weight must be greater than 0"),
	sampleLengthCm: z
		.number("Sample length must be a number")
		.refine((v) => v >= 0, "Sample length must be 0 or greater"),
	batchLabel: z
		.string("Sampling batch label must be a text value")
		.max(64, "Sampling batch label must be 64 characters or fewer")
		.nullish(),
});

export const fishSampleRowSchema = z.object({
	weightGrams: z
		.number("Weight must be a number")
		.refine((v) => v > 0, "Weight must be greater than 0"),
	lengthCm: z
		.number("Length must be a number")
		.refine((v) => v >= 0, "Length must be 0 or greater"),
});

export const fishSamplesSchema = z.array(fishSampleRowSchema);

export const DEFAULT_NOTIFICATION_PREFS = {
	missedFeeding: true,
	deviceOffline: true,
	hopperLow: true,
	harvestReminders: true,
	samplingReminders: true,
	emailReminders: true,
} as const;

export type NotificationPrefs = {
	[K in keyof typeof DEFAULT_NOTIFICATION_PREFS]: boolean;
};

/**
 * Read `Pond.notificationPrefs` defensively. Legacy rows only contain the
 * three feeding/device keys, and old JSON may be partial, null, or malformed.
 * Missing (or non-boolean) keys fall back to `true` so a legacy pond keeps
 * receiving reminders instead of crashing the cron or the settings form.
 */
export function normalizeNotificationPrefs(value: unknown): NotificationPrefs {
	const source =
		value !== null && typeof value === "object" && !Array.isArray(value)
			? (value as Record<string, unknown>)
			: {};
	const read = (key: keyof NotificationPrefs): boolean => {
		const candidate = source[key];
		return typeof candidate === "boolean" ? candidate : DEFAULT_NOTIFICATION_PREFS[key];
	};

	return {
		missedFeeding: read("missedFeeding"),
		deviceOffline: read("deviceOffline"),
		hopperLow: read("hopperLow"),
		harvestReminders: read("harvestReminders"),
		samplingReminders: read("samplingReminders"),
		emailReminders: read("emailReminders"),
	};
}

export const notificationPrefsSchema = z.object({
	missedFeeding: z.boolean().default(DEFAULT_NOTIFICATION_PREFS.missedFeeding),
	deviceOffline: z.boolean().default(DEFAULT_NOTIFICATION_PREFS.deviceOffline),
	hopperLow: z.boolean().default(DEFAULT_NOTIFICATION_PREFS.hopperLow),
	harvestReminders: z.boolean().default(DEFAULT_NOTIFICATION_PREFS.harvestReminders),
	samplingReminders: z.boolean().default(DEFAULT_NOTIFICATION_PREFS.samplingReminders),
	emailReminders: z.boolean().default(DEFAULT_NOTIFICATION_PREFS.emailReminders),
});

export function formatZodError(error: z.ZodError): string {
	const issue = error.issues[0];
	if (!issue) return "Invalid input";
	const field = issue.path.join(".");
	return field ? `${field}: ${issue.message}` : issue.message;
}

/**
 * The daily feed allowance for one device.
 *
 * The farmer/admin ceiling (`EnergyDevice.dailyCapG`) defaults to 2,000 g and
 * may be raised to the hard guard (5,000 g, matching the firmware's
 * `MAX_GRAMS_PER_DAY`). The platform setting (`dailyCapFactor`) may only lower
 * the result, and a calibrated hopper is the final physical limit.
 */
export const DAILY_CAP_MIN_G = 500;
export const DEFAULT_DAILY_CAP_G = 2000;

export const dailyCapSchema = z
	.number("Daily feed ceiling must be a number")
	.int("Daily feed ceiling must be a whole number")
	.min(DAILY_CAP_MIN_G, `Daily feed ceiling must be at least ${DAILY_CAP_MIN_G} g`)
	.max(
		MAX_FEED_GRAMS_PER_DAY_PER_DEVICE,
		`Daily feed ceiling cannot exceed ${MAX_FEED_GRAMS_PER_DAY_PER_DEVICE} g`,
	);

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
