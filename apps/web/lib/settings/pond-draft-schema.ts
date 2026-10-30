import { z } from "zod";
import type { PondSettingsDraft } from "./pond-input";

/**
 * The shape accepted by the database draft actions (I-99).
 *
 * The draft is a browser-supplied JSON blob, so the server validates it before
 * it is stored: known field keys only (zod strips anything else), every value a
 * string, and the whole payload bounded to 8 KB. The values are the same raw
 * strings the form holds — no number is coerced here, because a half-typed
 * value such as "" or "1." must survive a page visit untouched.
 *
 * This module is server-side (it imports zod); the client form never imports
 * it and only talks to it through the server actions.
 */

/** Hard ceiling for one stored draft, in bytes of JSON. */
export const POND_SETTINGS_DRAFT_MAX_BYTES = 8 * 1024;

/** A single raw form value; longer than any real number the form accepts. */
const DRAFT_VALUE_MAX_LENGTH = 64;

const draftValuesSchema = z.object({
	feedingRate: z.string().max(DRAFT_VALUE_MAX_LENGTH),
	feedsPerDay: z.string().max(DRAFT_VALUE_MAX_LENGTH),
	sampleInterval: z.string().max(DRAFT_VALUE_MAX_LENGTH),
	population: z.string().max(DRAFT_VALUE_MAX_LENGTH),
	areaM2: z.string().max(DRAFT_VALUE_MAX_LENGTH),
	averageDepthM: z.string().max(DRAFT_VALUE_MAX_LENGTH),
	feedPricePerKg: z.string().max(DRAFT_VALUE_MAX_LENGTH),
});

export type PondDraftParseResult =
	| { ok: true; values: PondSettingsDraft }
	| { ok: false; error: "draft_too_large" | "draft_invalid" };

/** UTF-8 byte length of a JSON payload, without throwing on a circular value. */
export function jsonByteLength(value: unknown): number {
	try {
		const serialized = JSON.stringify(value);
		return serialized === undefined ? 0 : Buffer.byteLength(serialized, "utf8");
	} catch {
		return Number.POSITIVE_INFINITY;
	}
}

/**
 * Validate an untrusted draft payload.
 *
 * Unknown keys are stripped (a newer form may send a field this build does not
 * know yet), non-string values are rejected, and a payload over the size limit
 * is refused before it reaches jsonb. The size is measured twice: on the input
 * so an oversized blob is never parsed into a row, and on the stripped values
 * so the value actually written is inside the limit too.
 */
export function parsePondSettingsDraftPayload(value: unknown): PondDraftParseResult {
	if (jsonByteLength(value) > POND_SETTINGS_DRAFT_MAX_BYTES) {
		return { ok: false, error: "draft_too_large" };
	}

	const parsed = draftValuesSchema.safeParse(value);
	if (!parsed.success) return { ok: false, error: "draft_invalid" };

	const values: PondSettingsDraft = { ...parsed.data };
	if (jsonByteLength(values) > POND_SETTINGS_DRAFT_MAX_BYTES) {
		return { ok: false, error: "draft_too_large" };
	}

	return { ok: true, values };
}
