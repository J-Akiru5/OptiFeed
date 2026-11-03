import {
	FIRMWARE_HOPPER_FILTER_FIELDS,
	type FirmwareFieldSpec,
	type FirmwareHopperFilterOverrides,
	firmwareField,
} from "@/lib/firmware/config";
import { z } from "zod";

/**
 * Per-device hopper filter tuning (issue #659).
 *
 * The seven `hopper_*` filter keys guard the ultrasonic reading against field
 * noise. They used to be firmware-only constants (`editable: false`, no
 * overlay), so a bouncing sensor could only be adapted with a new build. This
 * module is the single place that maps the firmware field ids onto the
 * `EnergyDevice` columns, and it derives every bound from `FIRMWARE_FIELDS` -
 * the table `firmware-config.test.ts` pins to `firmware-main/config.h` - so the
 * dashboard envelope cannot drift from the one the firmware enforces.
 *
 * No new table and no second copy of the numbers: a null column means "use the
 * firmware default", and `buildFirmwareConfig` overlays whatever is set.
 */

/**
 * `DeviceStateEvent` type recorded when the filter tuning changes.
 *
 * The writer passes the same string literally, because a `"use server"` module
 * may only export async functions; the settings card reads it back to decide
 * whether the device has echoed a config since the change.
 */
export const HOPPER_FILTER_CHANGED_EVENT = "hopper_filter_changed";

/** The `EnergyDevice` column that stores each firmware field id. */
export const HOPPER_FILTER_COLUMNS = {
	hopper_refill_margin_pct: "hopperRefillMarginPct",
	hopper_reject_below_cm: "hopperRejectBelowCm",
	hopper_reject_above_margin_cm: "hopperRejectAboveMarginCm",
	hopper_ema_alpha: "hopperEmaAlpha",
	hopper_jump_pct: "hopperJumpPct",
	hopper_persist_cycles: "hopperPersistCycles",
	hopper_state_hold_s: "hopperStateHoldS",
} as const;

export type HopperFilterKey = keyof typeof HOPPER_FILTER_COLUMNS;

/** The stored side of one device row: every column nullable. */
export type HopperFilterColumns = Record<
	(typeof HOPPER_FILTER_COLUMNS)[HopperFilterKey],
	number | null
>;

/** The submitted side: every key present, in the firmware envelope. */
export type HopperFilterValues = Record<HopperFilterKey, number>;

function fieldFor(key: HopperFilterKey): FirmwareFieldSpec {
	const field = firmwareField(key);
	if (!field) {
		// Both tables are static and pinned by a test; a missing entry is a
		// programming error, not user input.
		throw new Error(`unknown hopper filter field: ${key}`);
	}
	return field;
}

const HOPPER_FILTER_KEYS = Object.keys(HOPPER_FILTER_COLUMNS) as HopperFilterKey[];

const shape = Object.fromEntries(
	HOPPER_FILTER_KEYS.map((key) => {
		const field = fieldFor(key);
		const number = z
			.number(`${field.id} must be a number`)
			.finite(`${field.id} must be a number`)
			.min(field.min, `${field.id} must be at least ${field.min}`)
			.max(field.max, `${field.id} cannot exceed ${field.max}`);
		return [key, field.integer ? number.int(`${field.id} must be a whole number`) : number];
	}),
) as Record<HopperFilterKey, z.ZodNumber>;

/**
 * The write schema. Every key is required, because the form always submits the
 * full set: a partial update would leave a stale value looking applied, and the
 * firmware validates the config object as a whole. Unknown keys are refused.
 */
export const hopperFilterSchema = z.object(shape).strict();

/** Stored → firmware overrides; a null column is simply not sent. */
export function hopperFilterOverrides(
	columns: Partial<HopperFilterColumns> | null | undefined,
): FirmwareHopperFilterOverrides {
	if (!columns) return {};
	const overrides: FirmwareHopperFilterOverrides = {};
	for (const key of HOPPER_FILTER_KEYS) {
		const value = columns[HOPPER_FILTER_COLUMNS[key]];
		if (typeof value === "number" && Number.isFinite(value)) {
			overrides[key] = value;
		}
	}
	return overrides;
}

/**
 * Stored → the values the form edits, with the firmware default filling a null
 * column. The form therefore always shows (and saves) the effective numbers,
 * which is exactly what the next poll sends.
 */
export function resolveHopperFilterValues(
	columns: Partial<HopperFilterColumns> | null | undefined,
): HopperFilterValues {
	const values = {} as HopperFilterValues;
	for (const key of HOPPER_FILTER_KEYS) {
		const stored = columns?.[HOPPER_FILTER_COLUMNS[key]];
		values[key] =
			typeof stored === "number" && Number.isFinite(stored) ? stored : fieldFor(key).defaultValue;
	}
	return values;
}

/**
 * Which keys still run on the firmware default rather than a stored value, so
 * the card can say so instead of implying an override that was never written.
 */
export function hopperFilterDefaults(columns: Partial<HopperFilterColumns> | null | undefined): {
	usingDefaults: HopperFilterKey[];
} {
	return {
		usingDefaults: HOPPER_FILTER_KEYS.filter((key) => {
			const stored = columns?.[HOPPER_FILTER_COLUMNS[key]];
			return typeof stored !== "number" || !Number.isFinite(stored);
		}),
	};
}

/**
 * The form's field list: the id and the firmware envelope, nothing else.
 *
 * It is passed from the server page as a prop so the client bundle never has to
 * import the 56-entry `FIRMWARE_FIELDS` table for seven numbers. The values are
 * already resolved by `resolveHopperFilterValues`.
 */
export interface HopperFilterFieldSpec {
	id: HopperFilterKey;
	min: number;
	max: number;
}

/** Firmware envelopes in display order, for the form. */
export const HOPPER_FILTER_FORM_FIELDS: readonly HopperFilterFieldSpec[] =
	FIRMWARE_HOPPER_FILTER_FIELDS.filter((field) =>
		HOPPER_FILTER_KEYS.includes(field.id as HopperFilterKey),
	).map((field) => ({
		id: field.id as HopperFilterKey,
		min: field.min,
		max: field.max,
	}));
