import { dailyFeedG, feedPerMealG, totalBiomassG } from "@/lib/feed-calc";
import {
	MAX_FEED_GRAMS_PER_DAY_PER_DEVICE,
	clamp,
	normalizeDailyCapG,
	resolveDailyCapG,
} from "@/lib/limits";
import type { PondSettingsField } from "./pond-fields";

/**
 * The pond-versus-device arithmetic behind issue #371.
 *
 * The pond settings (feeding rate, feeds per day, population, biomass) are the
 * source of truth: they produce the grams the feeder must dispense. The device
 * has three limits that can disagree with that number:
 *
 *  - its daily ceiling (`EnergyDevice.dailyCapG`, possibly lowered by the
 *    platform factor or the calibrated hopper capacity),
 *  - the relay-time window (`gramsPerSecond x maxDispenseMs`),
 *  - the hard per-request cap (`MAX_FEED_GRAMS_PER_REQUEST`).
 *
 * This module only computes the disagreement. It never writes and never relaxes
 * a limit; the caller shows the conflict and offers to move a *setting* (never
 * a hard maximum) to the pond value.
 *
 * It is intentionally free of Prisma and `"use server"` so the client form can
 * run the same arithmetic live and a unit test can pin every boundary.
 */

/** Two decimal grams; anything smaller is float noise, not a conflict. */
const EPSILON_G = 0.005;

export interface PondFeedPreview {
	status: "ready" | "no-population" | "no-biomass";
	biomassG: number | null;
	dailyG: number | null;
	perMealG: number | null;
	/**
	 * Meals x rounded per-meal grams: the daily total the device will actually
	 * be scheduled for, which is what the daily-cap guard multiplies. It can
	 * differ from `dailyG` by a cent because `gramsPerFeeding` is stored rounded,
	 * so the conflict check uses this number.
	 */
	scheduledDailyG: number | null;
}

export interface PondFeedInput {
	population: number | null | undefined;
	avgWeightKg: number | null | undefined;
	feedingRatePct: number;
	feedsPerDay: number;
}

/**
 * The grams the pond settings ask for.
 *
 * A missing population or biomass is reported instead of guessed
 * (Amendment A-001, D8): no number is better than an invented feed figure.
 */
export function buildPondFeedPreview(input: PondFeedInput): PondFeedPreview {
	if (
		typeof input.population !== "number" ||
		!Number.isFinite(input.population) ||
		input.population <= 0
	) {
		return {
			status: "no-population",
			biomassG: null,
			dailyG: null,
			perMealG: null,
			scheduledDailyG: null,
		};
	}
	const biomassG = totalBiomassG(input.population, input.avgWeightKg ?? Number.NaN);
	if (biomassG === null) {
		return {
			status: "no-biomass",
			biomassG: null,
			dailyG: null,
			perMealG: null,
			scheduledDailyG: null,
		};
	}
	if (!Number.isFinite(input.feedingRatePct) || input.feedingRatePct < 0) {
		return {
			status: "no-biomass",
			biomassG,
			dailyG: null,
			perMealG: null,
			scheduledDailyG: null,
		};
	}

	const dailyG = dailyFeedG(biomassG, input.feedingRatePct);
	const perMealG =
		Number.isFinite(input.feedsPerDay) && input.feedsPerDay > 0
			? feedPerMealG(biomassG, input.feedingRatePct, input.feedsPerDay)
			: null;
	if (dailyG === null || perMealG === null) {
		return {
			status: "no-biomass",
			biomassG,
			dailyG: null,
			perMealG: null,
			scheduledDailyG: null,
		};
	}
	return {
		status: "ready",
		biomassG,
		dailyG,
		perMealG,
		scheduledDailyG: Math.round(perMealG * input.feedsPerDay * 100) / 100,
	};
}

/** Which layer produced the effective daily ceiling. */
export type PondDailyCapSource = "device" | "platform" | "hopper";

export interface PondDeviceConstraints {
	deviceId: string;
	/** The stored ceiling; null means the 2,000 g default. */
	configuredDailyCapG: number | null;
	/** The ceiling actually enforced by `resolveDailyCapG`. */
	effectiveDailyCapG: number;
	dailyCapSource: PondDailyCapSource;
	gramsPerSecond: number;
	maxDispenseMs: number;
	hopperCapacityG: number | null;
}

export interface PondDeviceConstraintInput {
	deviceId: string;
	configuredDailyCapG: number | null;
	hopperCapacityG: number | null;
	gramsPerSecond: number;
	maxDispenseMs: number;
	dailyCapFactor: number;
}

/**
 * Turn the stored device row plus the platform caps into the effective limits.
 *
 * Uses `resolveDailyCapG`, the one daily-cap implementation, so the conflict a
 * reader sees here is the same number the ingest and feed paths enforce.
 */
export function buildPondDeviceConstraints(
	input: PondDeviceConstraintInput,
): PondDeviceConstraints {
	const configured = normalizeDailyCapG(input.configuredDailyCapG);
	const factor =
		typeof input.dailyCapFactor === "number" && Number.isFinite(input.dailyCapFactor)
			? clamp(input.dailyCapFactor, 0, 1)
			: 1;
	const hopper =
		typeof input.hopperCapacityG === "number" &&
		Number.isFinite(input.hopperCapacityG) &&
		input.hopperCapacityG > 0
			? input.hopperCapacityG
			: null;
	const effectiveDailyCapG = resolveDailyCapG({
		configuredCapG: input.configuredDailyCapG,
		hopperCapacityG: input.hopperCapacityG,
		dailyCapFactor: factor,
	});
	const platformCapped = configured * factor;
	// `hopper <= platformCapped` (not `<`) is deliberate: when the two tie, the
	// hopper is the physical reason the ceiling cannot be raised from this form.
	const dailyCapSource: PondDailyCapSource =
		hopper !== null && hopper <= platformCapped ? "hopper" : factor < 1 ? "platform" : "device";

	return {
		deviceId: input.deviceId,
		configuredDailyCapG: input.configuredDailyCapG,
		effectiveDailyCapG,
		dailyCapSource,
		gramsPerSecond: input.gramsPerSecond,
		maxDispenseMs: input.maxDispenseMs,
		hopperCapacityG: hopper,
	};
}

export type PondConflictCode = "daily-ceiling" | "relay-time";

export interface PondDeviceConflict {
	code: PondConflictCode;
	/** The pond field whose value produces this conflict. */
	field: PondSettingsField;
	deviceId: string;
	/** The pond's daily or per-meal amount, depending on `code`. */
	pondValueG: number;
	/** The device's effective ceiling or maximum dose. */
	deviceValueG: number;
	/** `data-help` anchor of the device control to open. */
	target: string;
	/** Locale-less route that holds the control. */
	route: string;
	/** Route plus hash, so a reload still scrolls to the control. */
	href: string;
	/** True only when changing a device *setting* can reach the pond value. */
	canUsePondValue: boolean;
	/** The value the "Use pond value" button writes, already inside safe bounds. */
	pondValueToApplyG: number | null;
	/** The pond value itself is above a hard maximum, so it cannot be applied. */
	aboveHardMax: boolean;
	/** For a relay-time conflict: the fewest meals that fit the window. */
	suggestedFeedsPerDay: number | null;
}

export const HARDWARE_SETTINGS_ROUTE = "/dashboard/settings/hardware";

/** The daily-ceiling control on the hardware screen (input id is dynamic). */
export const DAILY_CEILING_TARGET = "device-daily-ceiling";
/** The calibration control on the hardware screen. */
export const CALIBRATION_TARGET = "calibration-form";

export function dailyCeilingHref(): string {
	return `${HARDWARE_SETTINGS_ROUTE}#daily-ceiling`;
}

export function calibrationHref(): string {
	return `${HARDWARE_SETTINGS_ROUTE}#calibration`;
}

/**
 * Every way the pond's feed plan disagrees with the device's limits.
 *
 * Returns an empty list when the preview is not ready (no population/biomass):
 * a missing number is not a conflict.
 */
export function detectPondDeviceConflicts(
	preview: PondFeedPreview,
	constraints: PondDeviceConstraints,
): PondDeviceConflict[] {
	if (preview.status !== "ready" || preview.perMealG === null) {
		return [];
	}

	const conflicts: PondDeviceConflict[] = [];
	const dailyG = preview.scheduledDailyG ?? preview.dailyG ?? 0;
	const perMealG = preview.perMealG;
	const base = {
		deviceId: constraints.deviceId,
		route: HARDWARE_SETTINGS_ROUTE,
	};

	if (dailyG > constraints.effectiveDailyCapG + EPSILON_G) {
		const aboveHardMax = dailyG > MAX_FEED_GRAMS_PER_DAY_PER_DEVICE;
		const canUsePondValue = constraints.dailyCapSource === "device" && !aboveHardMax;
		conflicts.push({
			...base,
			code: "daily-ceiling",
			field: "feedingRatePct",
			pondValueG: dailyG,
			deviceValueG: constraints.effectiveDailyCapG,
			target: DAILY_CEILING_TARGET,
			href: dailyCeilingHref(),
			canUsePondValue,
			pondValueToApplyG: canUsePondValue ? Math.ceil(dailyG) : null,
			aboveHardMax,
			suggestedFeedsPerDay: null,
		});
	}

	const maxDoseG =
		constraints.gramsPerSecond > 0
			? constraints.gramsPerSecond * (constraints.maxDispenseMs / 1000)
			: 0;
	if (maxDoseG > 0 && perMealG > maxDoseG + EPSILON_G) {
		// More meals is the pond-side fix; a calibration is a measurement, so it
		// is never "applied" from here. The card links to the calibration control.
		const suggested = Math.ceil(dailyG / maxDoseG);
		conflicts.push({
			...base,
			code: "relay-time",
			field: "feedsPerDay",
			pondValueG: perMealG,
			deviceValueG: maxDoseG,
			target: CALIBRATION_TARGET,
			href: calibrationHref(),
			canUsePondValue: false,
			pondValueToApplyG: null,
			aboveHardMax: false,
			suggestedFeedsPerDay: suggested > 0 && suggested <= 24 ? suggested : null,
		});
	}

	return conflicts;
}

/** Field errors returned by the server, keyed by the field they belong to. */
export type PondSettingsErrorCode =
	| "rate_min"
	| "rate_max"
	| "feeds_min"
	| "feeds_max"
	| "interval_min"
	| "interval_max"
	| "population_min"
	| "population_max"
	| "area_invalid"
	| "depth_invalid"
	| "price_invalid"
	| "invalid_number";

export interface PondSettingsFieldError {
	field: PondSettingsField;
	code: PondSettingsErrorCode;
	/** English fallback for logs/tests; the form renders `errors.<code>`. */
	message: string;
}

export const POND_SETTINGS_ERROR_KEYS: Record<PondSettingsErrorCode, string> = {
	rate_min: "errors.rateMin",
	rate_max: "errors.rateMax",
	feeds_min: "errors.feedsMin",
	feeds_max: "errors.feedsMax",
	interval_min: "errors.intervalMin",
	interval_max: "errors.intervalMax",
	population_min: "errors.populationMin",
	population_max: "errors.populationMax",
	area_invalid: "errors.areaInvalid",
	depth_invalid: "errors.depthInvalid",
	price_invalid: "errors.priceInvalid",
	invalid_number: "errors.invalidNumber",
};

export function pondFieldError(
	field: PondSettingsField,
	code: PondSettingsErrorCode,
	message: string,
): PondSettingsFieldError {
	return { field, code, message };
}
