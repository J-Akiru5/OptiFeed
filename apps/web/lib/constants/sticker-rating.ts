import {
	HARDWARE_RATING,
	MAINS_FREQUENCY_HZ,
	MAINS_VOLTAGE_V,
	maxPower,
} from "@/lib/constants/hardware-rating";
import { z } from "zod";

/**
 * Sticker rating override (decision E17, issue #197).
 *
 * The power rating comes from `hardware-rating.ts` by default. An admin may
 * correct it for a single print (values carried in the print page URL) or, if
 * they are a platform admin, save a new default for every sticker.
 *
 * Everything in this module is pure and safe for the browser: the reader that
 * touches the database lives in `lib/settings/sticker-rating.ts`.
 */

export const STICKER_RATING_KEY = "sticker.rating";

export const STICKER_VOLTAGE_MIN = 100;
export const STICKER_VOLTAGE_MAX = 260;
export const STICKER_CURRENT_MIN = 0.1;
export const STICKER_CURRENT_MAX = 20;
export const STICKER_POWER_MIN = 1;
export const STICKER_POWER_MAX = 5000;

export const STICKER_FREQUENCIES = [50, 60] as const;
export type StickerFrequency = (typeof STICKER_FREQUENCIES)[number];

export type StickerRatingValues = {
	voltageV: number;
	frequencyHz: StickerFrequency;
	currentA: number;
	powerVA: number;
	measured: boolean;
	measuredAt: string | null;
};

/** Where the numbers on the sheet came from. */
export type StickerRatingSource = "estimated" | "entered" | "measured";

/** `actor` = the person printing now (URL override); `platform` = a saved default. */
export type StickerRatingEnteredBy = "actor" | "platform";

export type ResolvedStickerRating = StickerRatingValues & {
	source: StickerRatingSource;
	enteredBy: StickerRatingEnteredBy | null;
};

/** A partial URL override; absent fields fall through to the next source. */
export type StickerRatingOverride = Partial<StickerRatingValues>;

/** Values accepted from the print page; VA is optional and computed when absent. */
export type StickerRatingInput = Omit<StickerRatingValues, "powerVA"> & { powerVA?: number };

/** The numbers in `hardware-rating.ts`: 220 V, 60 Hz, 1.2 A, 264 VA. */
export const LABEL_STICKER_RATING: StickerRatingValues = {
	voltageV: MAINS_VOLTAGE_V,
	frequencyHz: MAINS_FREQUENCY_HZ,
	currentA: HARDWARE_RATING.maxCurrentA,
	powerVA: Math.round(maxPower()),
	measured: false,
	measuredAt: null,
};

/** Query parameters that carry a per-print override. */
export const STICKER_RATING_PARAM_KEYS = [
	"voltage",
	"hz",
	"amps",
	"va",
	"measured",
	"measuredAt",
] as const;

/** V × A, rounded to a whole volt-ampere. */
export function computePowerVA(voltageV: number, currentA: number): number {
	if (!Number.isFinite(voltageV) || !Number.isFinite(currentA)) {
		return LABEL_STICKER_RATING.powerVA;
	}
	return Math.round(voltageV * currentA);
}

/** True when the stored VA is a hand-entered figure rather than V × A. */
export function isPowerOverridden(
	rating: Pick<StickerRatingValues, "voltageV" | "currentA" | "powerVA">,
): boolean {
	return rating.powerVA !== computePowerVA(rating.voltageV, rating.currentA);
}

/** `YYYY-MM-DD`, and a real calendar date. */
export function isIsoDateString(value: unknown): value is string {
	if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
	const [year, month, day] = value.split("-").map(Number);
	const date = new Date(Date.UTC(year, month - 1, day));
	return (
		date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
	);
}

function roundTenth(value: number): number {
	return Math.round(value * 10) / 10;
}

function numberOf(value: string | string[] | undefined): number | null {
	const raw = Array.isArray(value) ? value[0] : value;
	if (raw === undefined || raw.trim() === "") return null;
	const parsed = Number(raw);
	return Number.isFinite(parsed) ? parsed : null;
}

function booleanOf(value: string | string[] | undefined): boolean | null {
	const raw = (Array.isArray(value) ? value[0] : value)?.trim().toLowerCase();
	if (raw === undefined) return null;
	if (["1", "true", "yes", "on"].includes(raw)) return true;
	if (["0", "false", "no", "off"].includes(raw)) return false;
	return null;
}

function stringOf(value: string | string[] | undefined): string | null {
	const raw = Array.isArray(value) ? value[0] : value;
	return raw === undefined || raw.trim() === "" ? null : raw.trim();
}

/**
 * Read the per-print override from a page's search params.
 *
 * Each field is validated on its own. A missing or invalid field is simply
 * absent, so it falls back to the saved default or the label values.
 */
export function parseStickerRatingParams(
	params: Record<string, string | string[] | undefined>,
): StickerRatingOverride {
	const override: StickerRatingOverride = {};

	const voltage = numberOf(params.voltage);
	if (voltage !== null && voltage >= STICKER_VOLTAGE_MIN && voltage <= STICKER_VOLTAGE_MAX) {
		override.voltageV = roundTenth(voltage);
	}

	const frequency = numberOf(params.hz);
	if (frequency === 50 || frequency === 60) {
		override.frequencyHz = frequency;
	}

	const current = numberOf(params.amps);
	if (current !== null && current >= STICKER_CURRENT_MIN && current <= STICKER_CURRENT_MAX) {
		override.currentA = roundTenth(current);
	}

	const power = numberOf(params.va);
	if (power !== null && power >= STICKER_POWER_MIN && power <= STICKER_POWER_MAX) {
		override.powerVA = Math.round(power);
	}

	const measured = booleanOf(params.measured);
	if (measured !== null) override.measured = measured;

	const measuredAt = stringOf(params.measuredAt);
	if (isIsoDateString(measuredAt)) override.measuredAt = measuredAt;

	return override;
}

/**
 * Resolution order (decision E17): URL override → saved default → the label
 * constants. Fields resolve individually, so a hand-written URL with only
 * `voltage` still uses the saved current.
 */
export function resolveStickerRating(
	input: {
		override?: StickerRatingOverride | null;
		saved?: StickerRatingValues | null;
	} = {},
): ResolvedStickerRating {
	const override = input.override ?? {};
	const saved = input.saved ?? null;
	const overridden = Object.keys(override).length > 0;

	const voltageV = override.voltageV ?? saved?.voltageV ?? LABEL_STICKER_RATING.voltageV;
	const frequencyHz =
		override.frequencyHz ?? saved?.frequencyHz ?? LABEL_STICKER_RATING.frequencyHz;
	const currentA = override.currentA ?? saved?.currentA ?? LABEL_STICKER_RATING.currentA;
	// Power follows an explicit VA. A URL that changes V or A without a VA must
	// recompute it rather than keep a stale figure from the saved default.
	const powerVA =
		override.powerVA ??
		(override.voltageV !== undefined || override.currentA !== undefined
			? computePowerVA(voltageV, currentA)
			: (saved?.powerVA ?? computePowerVA(voltageV, currentA)));
	const measured = override.measured ?? saved?.measured ?? false;
	const measuredAt = measured ? (override.measuredAt ?? saved?.measuredAt ?? null) : null;

	const source: StickerRatingSource = measured
		? "measured"
		: overridden || saved !== null
			? "entered"
			: "estimated";
	const enteredBy = source === "entered" ? (overridden ? "actor" : "platform") : null;

	return {
		voltageV,
		frequencyHz,
		currentA,
		powerVA,
		measured,
		measuredAt,
		source,
		enteredBy,
	};
}

const storedRatingSchema = z.object({
	voltageV: z.number().min(STICKER_VOLTAGE_MIN).max(STICKER_VOLTAGE_MAX),
	frequencyHz: z.union([z.literal(50), z.literal(60)]),
	currentA: z.number().min(STICKER_CURRENT_MIN).max(STICKER_CURRENT_MAX),
	powerVA: z.number().min(STICKER_POWER_MIN).max(STICKER_POWER_MAX).optional(),
	measured: z.boolean().optional(),
	measuredAt: z.string().nullable().optional(),
});

/**
 * Turn a stored `PlatformSetting.value` (or an action input) into rating
 * values. Returns null when the value is not a valid rating, so readers fall
 * back to the label constants instead of printing nonsense.
 */
export function normalizeStickerRating(value: unknown): StickerRatingValues | null {
	const parsed = storedRatingSchema.safeParse(value);
	if (!parsed.success) return null;

	const measured = parsed.data.measured ?? false;
	return {
		voltageV: parsed.data.voltageV,
		frequencyHz: parsed.data.frequencyHz,
		currentA: parsed.data.currentA,
		powerVA:
			parsed.data.powerVA !== undefined
				? Math.round(parsed.data.powerVA)
				: computePowerVA(parsed.data.voltageV, parsed.data.currentA),
		measured,
		measuredAt: measured && isIsoDateString(parsed.data.measuredAt) ? parsed.data.measuredAt : null,
	};
}

/**
 * Input schema for the platform action that saves a default. A measured
 * rating must say when it was measured; the print UI defaults the date to
 * today when the box is ticked.
 */
export const stickerRatingInputSchema = z
	.object({
		voltageV: z.number().min(STICKER_VOLTAGE_MIN).max(STICKER_VOLTAGE_MAX),
		frequencyHz: z.union([z.literal(50), z.literal(60)]),
		currentA: z.number().min(STICKER_CURRENT_MIN).max(STICKER_CURRENT_MAX),
		powerVA: z.number().min(STICKER_POWER_MIN).max(STICKER_POWER_MAX).optional(),
		measured: z.boolean(),
		measuredAt: z.string().nullable().optional(),
	})
	.superRefine((value, ctx) => {
		if (value.measured && !isIsoDateString(value.measuredAt)) {
			ctx.addIssue({
				code: "custom",
				path: ["measuredAt"],
				message: "A measurement date is required when the rating was measured.",
			});
		}
	});

/** Write the six override fields into a URL, preserving unrelated params. */
export function applyStickerRatingParams(
	params: URLSearchParams,
	values: StickerRatingValues,
): void {
	params.set("voltage", String(values.voltageV));
	params.set("hz", String(values.frequencyHz));
	params.set("amps", String(values.currentA));
	params.set("va", String(values.powerVA));
	params.set("measured", values.measured ? "1" : "0");
	if (values.measured && values.measuredAt) params.set("measuredAt", values.measuredAt);
	else params.delete("measuredAt");
}

/** Remove every rating override from a URL's params. */
export function clearStickerRatingParams(params: URLSearchParams): void {
	for (const key of STICKER_RATING_PARAM_KEYS) params.delete(key);
}
