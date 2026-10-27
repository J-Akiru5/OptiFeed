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
		.string("Batch label must be a text value")
		.max(64, "Batch label must be 64 characters or fewer")
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

export function dailyFeedCapG(hopperCapacityG: number | null | undefined): number {
	if (
		typeof hopperCapacityG === "number" &&
		Number.isFinite(hopperCapacityG) &&
		hopperCapacityG > 0
	) {
		return Math.min(MAX_FEED_GRAMS_PER_DAY_PER_DEVICE, hopperCapacityG);
	}
	return MAX_FEED_GRAMS_PER_DAY_PER_DEVICE;
}

export function clamp(value: number, min: number, max: number): number {
	return Math.min(Math.max(value, min), max);
}
