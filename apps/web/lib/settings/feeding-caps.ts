import { MAX_DISPENSE_MS } from "@/lib/limits";
import prisma from "@/lib/prisma";
import { cache } from "react";

/**
 * Platform-wide feeding safety caps (decision E16, superadmin configuration
 * centre I-14).
 *
 * These are the two caps a platform admin may tighten when a deployment needs
 * a shorter relay run or a smaller daily allowance. They are deliberately
 * *ceilings only*: the hard-coded maxima in `lib/limits.ts` stay authoritative
 * and a stored value is always read through `min(stored, hardMax)`. A setting
 * can therefore never raise a dose above the firmware/server contract, even if
 * a row is edited by hand or written by an older build.
 *
 * Both the form and the action validate against the hard maxima; the readers
 * clamp as a second line of defence.
 */

export const FEEDING_CAPS_KEY = "feeding.limits";

/** The absolute upper bounds. Nothing may exceed these. */
export const FEEDING_CAPS_HARD_MAX = {
	maxDispenseMs: MAX_DISPENSE_MS,
	dailyCapFactor: 1,
} as const;

/** Lower bounds keep a lowered cap operationally usable. */
export const FEEDING_CAPS_MIN = {
	maxDispenseMs: 5_000,
	dailyCapFactor: 0.1,
} as const;

export type FeedingCaps = {
	maxDispenseMs: number;
	dailyCapFactor: number;
};

/** Defaults equal the hard maxima: untouched settings change no behaviour. */
export const FEEDING_CAPS_DEFAULTS: FeedingCaps = {
	maxDispenseMs: FEEDING_CAPS_HARD_MAX.maxDispenseMs,
	dailyCapFactor: FEEDING_CAPS_HARD_MAX.dailyCapFactor,
};

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readNumber(
	value: unknown,
	minimum: number,
	hardMaximum: number,
	fallback: number,
	integer: boolean,
): number {
	let candidate: unknown = value;
	if (typeof candidate === "string" && candidate.trim() !== "") candidate = Number(candidate);
	if (typeof candidate !== "number" || !Number.isFinite(candidate)) return fallback;
	const normalized = integer ? Math.round(candidate) : candidate;
	return Math.min(Math.max(normalized, minimum), hardMaximum);
}

/**
 * Coerce a stored JSON value into usable caps.
 *
 * Unknown shapes fall back to the defaults and out-of-range numbers are
 * clamped to `[min, hardMax]`. This is the "readers use min(setting, hardMax)"
 * rule and it is what makes a corrupt or hand-edited row harmless.
 */
export function normalizeFeedingCaps(value: unknown): FeedingCaps {
	const source = isRecord(value) ? value : {};
	return {
		maxDispenseMs: readNumber(
			source.maxDispenseMs,
			FEEDING_CAPS_MIN.maxDispenseMs,
			FEEDING_CAPS_HARD_MAX.maxDispenseMs,
			FEEDING_CAPS_DEFAULTS.maxDispenseMs,
			true,
		),
		dailyCapFactor: readNumber(
			source.dailyCapFactor,
			FEEDING_CAPS_MIN.dailyCapFactor,
			FEEDING_CAPS_HARD_MAX.dailyCapFactor,
			FEEDING_CAPS_DEFAULTS.dailyCapFactor,
			false,
		),
	};
}

/**
 * True when both values are inside the writable window. Used by the action
 * before saving so a request above a hard maximum is refused outright rather
 * than silently clamped.
 */
export function isWithinFeedingCaps(value: {
	maxDispenseMs: number;
	dailyCapFactor: number;
}): boolean {
	return (
		Number.isInteger(value.maxDispenseMs) &&
		value.maxDispenseMs >= FEEDING_CAPS_MIN.maxDispenseMs &&
		value.maxDispenseMs <= FEEDING_CAPS_HARD_MAX.maxDispenseMs &&
		Number.isFinite(value.dailyCapFactor) &&
		value.dailyCapFactor >= FEEDING_CAPS_MIN.dailyCapFactor &&
		value.dailyCapFactor <= FEEDING_CAPS_HARD_MAX.dailyCapFactor
	);
}

/**
 * Read the active feeding caps. Wrapped in React `cache` so the feed command
 * path reads the row once per request even when several guards ask for it.
 */
export const getFeedingLimits = cache(async (): Promise<FeedingCaps> => {
	try {
		const row = await prisma.platformSetting.findUnique({
			where: { key: FEEDING_CAPS_KEY },
			select: { value: true },
		});
		return normalizeFeedingCaps(row?.value);
	} catch {
		// A missing table/row or a transient read failure must never weaken a
		// guard: the hard-coded maxima remain in force.
		return FEEDING_CAPS_DEFAULTS;
	}
});
