import { type PondSettingsFieldError, pondFieldError } from "./pond-conflicts";
import type { PondSettingsField } from "./pond-fields";

/**
 * Parse the raw strings of the pond settings form (#371).
 *
 * Kept separate from the component so the same rules can be unit-tested at
 * their boundaries, and so a parse failure is a *field* error rather than a
 * silent `return` that leaves the reader with no feedback. Every message is
 * an English fallback; the form translates `code` for the reader.
 */

export interface PondSettingsDraft {
	feedingRate: string;
	feedsPerDay: string;
	sampleInterval: string;
	population: string;
	areaM2: string;
	averageDepthM: string;
	feedPricePerKg: string;
}

export interface ParsedPondSettings {
	feedingRatePct: number;
	feedsPerDay: number;
	sampleIntervalDays: number;
	population: number | null;
	areaM2: number | null;
	averageDepthM: number | null;
	feedPricePerKg: number | null;
}

export type PondSettingsParseResult =
	| { ok: true; values: ParsedPondSettings }
	| { ok: false; errors: PondSettingsFieldError[] };

export const POND_SAMPLE_INTERVAL_MIN = 1;
export const POND_SAMPLE_INTERVAL_MAX = 90;
export const POND_AREA_MAX_M2 = 1_000_000;
export const POND_DEPTH_MAX_M = 50;
export const POND_FEED_PRICE_MAX = 10_000;

function blank(value: string): boolean {
	return value.trim() === "";
}

function optionalNumber(
	value: string,
	field: PondSettingsField,
	errors: PondSettingsFieldError[],
	validate: (candidate: number) => PondSettingsFieldError | null,
): number | null {
	if (blank(value)) return null;
	const candidate = Number(value.trim());
	if (!Number.isFinite(candidate)) {
		errors.push(pondFieldError(field, "invalid_number", "Enter a number"));
		return null;
	}
	const error = validate(candidate);
	if (error) {
		errors.push(error);
		return null;
	}
	return candidate;
}

export function parsePondSettingsDraft(draft: PondSettingsDraft): PondSettingsParseResult {
	const errors: PondSettingsFieldError[] = [];

	const rate = Number(draft.feedingRate.trim());
	let feedingRatePct = 0;
	if (blank(draft.feedingRate) || !Number.isFinite(rate)) {
		errors.push(pondFieldError("feedingRatePct", "invalid_number", "Enter a feeding rate"));
	} else if (rate < 0.1) {
		errors.push(pondFieldError("feedingRatePct", "rate_min", "Feeding rate must be at least 0.1%"));
	} else if (rate > 10) {
		errors.push(pondFieldError("feedingRatePct", "rate_max", "Feeding rate cannot exceed 10%"));
	} else {
		feedingRatePct = rate;
	}

	const feeds = Number(draft.feedsPerDay.trim());
	let feedsPerDay = 0;
	if (blank(draft.feedsPerDay) || !Number.isInteger(feeds)) {
		errors.push(pondFieldError("feedsPerDay", "invalid_number", "Enter a whole number of feeds"));
	} else if (feeds < 1) {
		errors.push(pondFieldError("feedsPerDay", "feeds_min", "At least one feed per day"));
	} else if (feeds > 24) {
		errors.push(pondFieldError("feedsPerDay", "feeds_max", "At most 24 feeds per day"));
	} else {
		feedsPerDay = feeds;
	}

	const interval = Number(draft.sampleInterval.trim());
	let sampleIntervalDays = 0;
	if (blank(draft.sampleInterval) || !Number.isInteger(interval)) {
		errors.push(
			pondFieldError("sampleIntervalDays", "invalid_number", "Enter a whole number of days"),
		);
	} else if (interval < POND_SAMPLE_INTERVAL_MIN) {
		errors.push(pondFieldError("sampleIntervalDays", "interval_min", "At least 1 day"));
	} else if (interval > POND_SAMPLE_INTERVAL_MAX) {
		errors.push(pondFieldError("sampleIntervalDays", "interval_max", "At most 90 days"));
	} else {
		sampleIntervalDays = interval;
	}

	const population = optionalNumber(draft.population, "population", errors, (candidate) => {
		if (!Number.isInteger(candidate)) {
			return pondFieldError("population", "invalid_number", "Enter a whole number of fish");
		}
		if (candidate < 1) {
			return pondFieldError("population", "population_min", "Population must be at least 1");
		}
		if (candidate > 1_000_000) {
			return pondFieldError("population", "population_max", "Population is too large");
		}
		return null;
	});

	const areaM2 = optionalNumber(draft.areaM2, "areaM2", errors, (candidate) => {
		if (candidate <= 0) {
			return pondFieldError("areaM2", "area_invalid", "Pond area must be greater than 0");
		}
		if (candidate > POND_AREA_MAX_M2) {
			return pondFieldError("areaM2", "area_invalid", "Pond area is too large");
		}
		return null;
	});

	const averageDepthM = optionalNumber(
		draft.averageDepthM,
		"averageDepthM",
		errors,
		(candidate) => {
			if (candidate <= 0) {
				return pondFieldError("averageDepthM", "depth_invalid", "Depth must be greater than 0");
			}
			if (candidate > POND_DEPTH_MAX_M) {
				return pondFieldError("averageDepthM", "depth_invalid", "Depth is too large");
			}
			return null;
		},
	);

	const feedPricePerKg = optionalNumber(
		draft.feedPricePerKg,
		"feedPricePerKg",
		errors,
		(candidate) => {
			if (candidate < 0) {
				return pondFieldError("feedPricePerKg", "price_invalid", "Price cannot be negative");
			}
			if (candidate > POND_FEED_PRICE_MAX) {
				return pondFieldError("feedPricePerKg", "price_invalid", "Price is too large");
			}
			return null;
		},
	);

	if (errors.length > 0) return { ok: false, errors };

	return {
		ok: true,
		values: {
			feedingRatePct,
			feedsPerDay,
			sampleIntervalDays,
			population,
			areaM2,
			averageDepthM,
			feedPricePerKg,
		},
	};
}
