import { z } from "zod";
import {
	HOPPER_DENSITY_G_CM3_MAX,
	HOPPER_DENSITY_G_CM3_MIN,
	HOPPER_DIAMETER_CM_MAX,
	HOPPER_DIAMETER_CM_MIN,
	hopperCapacityFromGeometry,
} from "./hopper-capacity";
import {
	DAILY_CAP_MIN_G,
	MAX_ACCEPTED_FEED_GRAMS,
	MAX_FEED_GRAMS_PER_DAY_PER_DEVICE,
} from "./limits-core";

export * from "./limits-core";
export * from "./hopper-capacity";

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
//
// Issue #415: the tank diameter and feed bulk density let the capacity be
// computed from the cylinder between the two marks (lib/hopper-capacity.ts)
// instead of typed in. A device is valid with either the computed geometry or
// an explicit capacity, so rows calibrated before this field existed keep
// working; a diameter alone is enough because the density has a documented
// default.
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
			.max(HOPPER_CAPACITY_G_MAX, `Hopper capacity cannot exceed ${HOPPER_CAPACITY_G_MAX} g`)
			.optional(),
		hopperDiameterCm: z
			.number("Tank diameter must be a number")
			.finite("Tank diameter must be a number")
			.min(HOPPER_DIAMETER_CM_MIN, `Tank diameter cannot be below ${HOPPER_DIAMETER_CM_MIN} cm`)
			.max(HOPPER_DIAMETER_CM_MAX, `Tank diameter cannot exceed ${HOPPER_DIAMETER_CM_MAX} cm`)
			.optional(),
		hopperBulkDensityGCm3: z
			.number("Feed density must be a number")
			.finite("Feed density must be a number")
			.min(
				HOPPER_DENSITY_G_CM3_MIN,
				`Feed density cannot be below ${HOPPER_DENSITY_G_CM3_MIN} g/cm³`,
			)
			.max(HOPPER_DENSITY_G_CM3_MAX, `Feed density cannot exceed ${HOPPER_DENSITY_G_CM3_MAX} g/cm³`)
			.optional(),
	})
	.refine((value) => value.hopperEmptyCm > value.hopperFullCm, {
		message: "The empty distance must be greater than the full distance",
		path: ["hopperEmptyCm"],
	})
	.refine(
		(value) => {
			// A diameter is only useful if the geometry it implies is physically
			// possible; the computed number is what gets stored, so it is checked
			// here rather than only in the form.
			if (value.hopperDiameterCm === undefined) return true;
			const capacity = hopperCapacityFromGeometry(
				{
					diameterCm: value.hopperDiameterCm,
					fullCm: value.hopperFullCm,
					emptyCm: value.hopperEmptyCm,
				},
				value.hopperBulkDensityGCm3,
			);
			return capacity !== null && capacity <= HOPPER_CAPACITY_G_MAX;
		},
		{
			message: `The computed hopper capacity cannot exceed ${HOPPER_CAPACITY_G_MAX} g`,
			path: ["hopperDiameterCm"],
		},
	);

// Guided motor calibration: run the motor for a bounded test window, weigh the
// output, then derive grams per second. The upper bounds keep a test dose
// inside the calibration ceiling and the weighed output physically plausible.
export const CALIBRATION_TEST_SECONDS_MIN = 3;
export const CALIBRATION_TEST_SECONDS_MAX = 600;
export const CALIBRATION_TEST_GRAMS_MAX = 5000;
export const CALIBRATION_ACTUAL_GRAMS_MAX = 5000;

// Target check (issue #191): dispense an exact target, weigh it, and correct
// grams per second from the error. The target bounds are the calibration
// limits; ±5% is the acceptance window.
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

// The daily ceiling is the only gram cap. This upper bound is a sanity guard
// (the daily hard guard), not a per-request limit: it rejects impossible input.
export const feedGramsSchema = z
	.number("Feed amount must be a number")
	.min(1, "Feed amount must be at least 1 g")
	.max(MAX_ACCEPTED_FEED_GRAMS, `Feed amount cannot exceed ${MAX_ACCEPTED_FEED_GRAMS} g`);

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

export const dailyCapSchema = z
	.number("Daily feed ceiling must be a number")
	.int("Daily feed ceiling must be a whole number")
	.min(DAILY_CAP_MIN_G, `Daily feed ceiling must be at least ${DAILY_CAP_MIN_G} g`)
	.max(
		MAX_FEED_GRAMS_PER_DAY_PER_DEVICE,
		`Daily feed ceiling cannot exceed ${MAX_FEED_GRAMS_PER_DAY_PER_DEVICE} g`,
	);
