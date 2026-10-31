/**
 * Firmware 1.7.0 dashboard-driven configuration (I-100).
 *
 * One versioned `config` object rides the existing 5-second feed-command poll
 * response. The firmware validates every field against its own copy of this
 * envelope (`firmware/firmware-main/config.h`) and keeps its last-good copy in
 * NVS when anything is missing, malformed or out of range.
 *
 * This module is deliberately pure (no Prisma, no zod) so both server code and
 * the superadmin form can import the same field table. The reader that loads
 * the stored values lives in `lib/settings/firmware-gates.ts`; the writer is a
 * platform action in `lib/actions/platform/settings.ts`.
 *
 * Envelope rules (also enforced in the firmware):
 * - `min`/`max` per field is the outer bound a dashboard value can never leave;
 * - the daily ceiling (`max_grams_per_day`) is the only gram cap (E38);
 * - there is no per-dose cap: `max_grams_per_dose` is derived by the firmware as
 *   `min(max_grams_per_day, max_dispense_ms / 1000 * grams_per_second)`.
 *
 * `FIRMWARE_FIELDS` must stay in lockstep with `FW_CONFIG_FIELDS` in
 * `firmware/firmware-main/config.h`; `firmware-config-contract.test.ts` parses
 * the header and fails on any drift.
 */

export const FIRMWARE_CONFIG_VERSION = 1;

/** `PlatformSetting` key holding the dashboard-editable values. */
export const FIRMWARE_GATES_SETTING_KEY = "firmware.gates";

export type FirmwareFieldGroup = "gate" | "runtime" | "device" | "diagnostic";

export interface FirmwareFieldSpec {
	/** Stable id used by the form and the stored JSON key (snake_case). */
	id: string;
	/** JSON key the firmware reads. */
	key: string;
	/** Absolute envelope: the firmware refuses anything outside it. */
	min: number;
	max: number;
	/** Whole numbers only (the firmware rejects a fractional value). */
	integer: boolean;
	/** Compile-time value; an untouched setting changes no behaviour. */
	defaultValue: number;
	group: FirmwareFieldGroup;
	/** True when the superadmin config centre exposes an input for it. */
	editable: boolean;
}

/**
 * The field table. Order matters only for readability and for the generated
 * config revision (which hashes the object in insertion order).
 */
export const FIRMWARE_FIELDS: readonly FirmwareFieldSpec[] = [
	// Feed safety gates - editable in Superadmin -> Settings -> Feed safety gates.
	{
		id: "min_dispense_gap_s",
		key: "min_dispense_gap_s",
		min: 10,
		max: 3600,
		integer: true,
		defaultValue: 10,
		group: "gate",
		editable: true,
	},
	{
		id: "max_dispenses_per_hour",
		key: "max_dispenses_per_hour",
		min: 1,
		max: 6,
		integer: true,
		defaultValue: 6,
		group: "gate",
		editable: true,
	},
	{
		id: "max_grams_per_day",
		key: "max_grams_per_day",
		min: 0,
		max: 5000,
		integer: false,
		defaultValue: 5000,
		group: "device",
		editable: false,
	},
	{
		id: "max_dispense_ms",
		key: "max_dispense_ms",
		min: 5000,
		max: 300000,
		integer: true,
		defaultValue: 300000,
		group: "device",
		editable: false,
	},
	{
		id: "calibration_max_grams",
		key: "calibration_max_grams",
		min: 100,
		max: 5000,
		integer: false,
		defaultValue: 5000,
		group: "runtime",
		editable: false,
	},
	{
		id: "calibration_max_dispense_ms",
		key: "calibration_max_dispense_ms",
		min: 10000,
		max: 600000,
		integer: true,
		defaultValue: 600000,
		group: "runtime",
		editable: false,
	},
	{
		id: "brownout_hold_s",
		key: "brownout_hold_s",
		min: 10,
		max: 3600,
		integer: true,
		defaultValue: 60,
		group: "gate",
		editable: true,
	},
	{
		id: "safe_mode_abnormal_window_s",
		key: "safe_mode_abnormal_window_s",
		min: 60,
		max: 86400,
		integer: true,
		defaultValue: 600,
		group: "gate",
		editable: true,
	},
	{
		id: "safe_mode_abnormal_threshold",
		key: "safe_mode_abnormal_threshold",
		min: 2,
		max: 10,
		integer: true,
		defaultValue: 3,
		group: "gate",
		editable: true,
	},
	{
		id: "safe_mode_quiet_s",
		key: "safe_mode_quiet_s",
		min: 60,
		max: 86400,
		integer: true,
		defaultValue: 1800,
		group: "gate",
		editable: true,
	},
	{
		id: "safe_mode_healthy_clear_s",
		key: "safe_mode_healthy_clear_s",
		min: 60,
		max: 86400,
		integer: true,
		defaultValue: 600,
		group: "gate",
		editable: true,
	},

	// Per-device feeding values - read from EnergyDevice on every poll.
	{
		id: "grams_per_feeding",
		key: "grams_per_feeding",
		min: 1,
		max: 5000,
		integer: false,
		defaultValue: 150,
		group: "device",
		editable: false,
	},
	{
		id: "button_feed_grams",
		key: "button_feed_grams",
		min: 1,
		max: 500,
		integer: false,
		defaultValue: 80,
		group: "device",
		editable: false,
	},
	{
		id: "grams_per_second",
		key: "grams_per_second",
		min: 0.5,
		max: 50,
		integer: false,
		defaultValue: 4,
		group: "device",
		editable: false,
	},
	{
		id: "temp_offset_c",
		key: "temp_offset_c",
		min: -20,
		max: 20,
		integer: false,
		defaultValue: 0,
		group: "device",
		editable: false,
	},
	{
		id: "hopper_full_cm",
		key: "hopper_full_cm",
		min: 0.1,
		max: 200,
		integer: false,
		defaultValue: 5,
		group: "device",
		editable: false,
	},
	{
		id: "hopper_empty_cm",
		key: "hopper_empty_cm",
		min: 0.1,
		max: 500,
		integer: false,
		defaultValue: 30,
		group: "device",
		editable: false,
	},
	{
		id: "hopper_low_pct",
		key: "hopper_low_pct",
		min: 1,
		max: 90,
		integer: false,
		defaultValue: 20,
		group: "device",
		editable: false,
	},
	{
		id: "hopper_refill_margin_pct",
		key: "hopper_refill_margin_pct",
		min: 0,
		max: 50,
		integer: false,
		defaultValue: 10,
		group: "device",
		editable: false,
	},

	// Hopper filter tuning (guards the reading against field noise).
	{
		id: "hopper_reject_below_cm",
		key: "hopper_reject_below_cm",
		min: 0,
		max: 50,
		integer: false,
		defaultValue: 2,
		group: "runtime",
		editable: false,
	},
	{
		id: "hopper_reject_above_margin_cm",
		key: "hopper_reject_above_margin_cm",
		min: 0,
		max: 100,
		integer: false,
		defaultValue: 10,
		group: "runtime",
		editable: false,
	},
	{
		id: "hopper_ema_alpha",
		key: "hopper_ema_alpha",
		min: 0.05,
		max: 1,
		integer: false,
		defaultValue: 0.35,
		group: "runtime",
		editable: false,
	},
	{
		id: "hopper_jump_pct",
		key: "hopper_jump_pct",
		min: 1,
		max: 100,
		integer: false,
		defaultValue: 15,
		group: "runtime",
		editable: false,
	},
	{
		id: "hopper_persist_cycles",
		key: "hopper_persist_cycles",
		min: 1,
		max: 20,
		integer: true,
		defaultValue: 3,
		group: "runtime",
		editable: false,
	},
	{
		id: "hopper_state_hold_s",
		key: "hopper_state_hold_s",
		min: 0,
		max: 86400,
		integer: true,
		defaultValue: 600,
		group: "runtime",
		editable: false,
	},

	// Button guard (debounce, boot grace, quiet window, cooldown, noise guard).
	{
		id: "button_debounce_ms",
		key: "button_debounce_ms",
		min: 10,
		max: 2000,
		integer: true,
		defaultValue: 250,
		group: "runtime",
		editable: false,
	},
	{
		id: "button_startup_grace_ms",
		key: "button_startup_grace_ms",
		min: 0,
		max: 60000,
		integer: true,
		defaultValue: 5000,
		group: "runtime",
		editable: false,
	},
	{
		id: "button_quiet_after_dispense_ms",
		key: "button_quiet_after_dispense_ms",
		min: 0,
		max: 60000,
		integer: true,
		defaultValue: 2000,
		group: "runtime",
		editable: false,
	},
	{
		id: "button_cooldown_ms",
		key: "button_cooldown_ms",
		min: 0,
		max: 3600000,
		integer: true,
		defaultValue: 30000,
		group: "runtime",
		editable: false,
	},
	{
		id: "button_log_interval_ms",
		key: "button_log_interval_ms",
		min: 1000,
		max: 600000,
		integer: true,
		defaultValue: 10000,
		group: "runtime",
		editable: false,
	},
	{
		id: "button_noise_window_ms",
		key: "button_noise_window_ms",
		min: 1000,
		max: 3600000,
		integer: true,
		defaultValue: 60000,
		group: "runtime",
		editable: false,
	},
	{
		id: "button_noise_max",
		key: "button_noise_max",
		min: 1,
		max: 50,
		integer: true,
		defaultValue: 5,
		group: "runtime",
		editable: false,
	},
	{
		id: "button_disable_ms",
		key: "button_disable_ms",
		min: 1000,
		max: 86400000,
		integer: true,
		defaultValue: 600000,
		group: "runtime",
		editable: false,
	},

	// Polling and the I-95 connectivity diagnostic (the server still classifies).
	{
		id: "heartbeat_interval_s",
		key: "heartbeat_interval_s",
		min: 2,
		max: 300,
		integer: true,
		defaultValue: 5,
		group: "runtime",
		editable: false,
	},
	{
		id: "weak_after_min",
		key: "weak_after_min",
		min: 1,
		max: 60,
		integer: true,
		defaultValue: 4,
		group: "diagnostic",
		editable: false,
	},
	{
		id: "offline_after_min",
		key: "offline_after_min",
		min: 5,
		max: 180,
		integer: true,
		defaultValue: 5,
		group: "diagnostic",
		editable: false,
	},

	// OTA pre-flight and timeouts (guards stay mandatory; only their values move).
	{
		id: "ota_check_interval_s",
		key: "ota_check_interval_s",
		min: 300,
		max: 86400,
		integer: true,
		defaultValue: 1800,
		group: "runtime",
		editable: false,
	},
	{
		id: "ota_min_uptime_s",
		key: "ota_min_uptime_s",
		min: 60,
		max: 86400,
		integer: true,
		defaultValue: 600,
		group: "runtime",
		editable: false,
	},
	{
		id: "ota_min_rssi_dbm",
		key: "ota_min_rssi_dbm",
		min: -100,
		max: -30,
		integer: true,
		defaultValue: -75,
		group: "runtime",
		editable: false,
	},
	{
		id: "ota_feed_guard_min",
		key: "ota_feed_guard_min",
		min: 5,
		max: 240,
		integer: true,
		defaultValue: 20,
		group: "runtime",
		editable: false,
	},
	{
		id: "ota_window_start_min",
		key: "ota_window_start_min",
		min: 0,
		max: 1440,
		integer: true,
		defaultValue: 600,
		group: "runtime",
		editable: false,
	},
	{
		id: "ota_window_end_min",
		key: "ota_window_end_min",
		min: 0,
		max: 1440,
		integer: true,
		defaultValue: 900,
		group: "runtime",
		editable: false,
	},
	{
		id: "ota_min_free_heap_bytes",
		key: "ota_min_free_heap_bytes",
		min: 20000,
		max: 200000,
		integer: true,
		defaultValue: 60000,
		group: "runtime",
		editable: false,
	},
	{
		id: "ota_no_data_timeout_ms",
		key: "ota_no_data_timeout_ms",
		min: 10000,
		max: 600000,
		integer: true,
		defaultValue: 60000,
		group: "runtime",
		editable: false,
	},
	{
		id: "ota_download_timeout_ms",
		key: "ota_download_timeout_ms",
		min: 60000,
		max: 3600000,
		integer: true,
		defaultValue: 900000,
		group: "runtime",
		editable: false,
	},
	{
		id: "ota_health_check_timeout_ms",
		key: "ota_health_check_timeout_ms",
		min: 60000,
		max: 1800000,
		integer: true,
		defaultValue: 300000,
		group: "runtime",
		editable: false,
	},
] as const;

export type FirmwareValues = Record<string, number>;

const FIELD_BY_ID = new Map(FIRMWARE_FIELDS.map((field) => [field.id, field]));

export function firmwareField(id: string): FirmwareFieldSpec | undefined {
	return FIELD_BY_ID.get(id);
}

/** The compile-time defaults, exactly as firmware 1.6.x behaved. */
export const FIRMWARE_DEFAULTS: FirmwareValues = Object.fromEntries(
	FIRMWARE_FIELDS.map((field) => [field.id, field.defaultValue]),
);

/** Editable gate fields, in display order. */
export const FIRMWARE_GATE_FIELDS = FIRMWARE_FIELDS.filter((field) => field.editable);

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Clamp one value into its envelope; a non-number falls back to the default. */
export function clampFirmwareValue(field: FirmwareFieldSpec, value: unknown): number {
	const candidate =
		typeof value === "string" && value.trim() !== "" ? Number(value) : (value as number);
	if (typeof candidate !== "number" || !Number.isFinite(candidate)) return field.defaultValue;
	const rounded = field.integer ? Math.round(candidate) : candidate;
	return Math.min(Math.max(rounded, field.min), field.max);
}

/** True when the value is inside the envelope (and whole when it must be). */
export function isWithinFirmwareField(field: FirmwareFieldSpec, value: unknown): boolean {
	if (typeof value !== "number" || !Number.isFinite(value)) return false;
	if (field.integer && !Number.isInteger(value)) return false;
	return value >= field.min && value <= field.max;
}

/**
 * Coerce a stored `firmware.gates` object into usable values.
 *
 * Unknown keys are dropped, out-of-range numbers clamp to the envelope and a
 * missing/!number falls back to the default, so a hand-edited row can never
 * raise a guard. `hopper_full_cm >= hopper_empty_cm` is repaired to the default
 * geometry because an inverted pair would break the percentage conversion.
 */
export function normalizeFirmwareValues(value: unknown): FirmwareValues {
	const source = isRecord(value) ? value : {};
	const out: FirmwareValues = { ...FIRMWARE_DEFAULTS };
	for (const field of FIRMWARE_FIELDS) {
		if (source[field.id] !== undefined) {
			out[field.id] = clampFirmwareValue(field, source[field.id]);
		}
	}
	if (!(out.hopper_full_cm < out.hopper_empty_cm)) {
		out.hopper_full_cm = firmwareField("hopper_full_cm")?.defaultValue ?? 5;
		out.hopper_empty_cm = firmwareField("hopper_empty_cm")?.defaultValue ?? 30;
	}
	if (!(out.ota_window_start_min < out.ota_window_end_min)) {
		out.ota_window_start_min = firmwareField("ota_window_start_min")?.defaultValue ?? 600;
		out.ota_window_end_min = firmwareField("ota_window_end_min")?.defaultValue ?? 900;
	}
	return out;
}

export interface FirmwareConfig extends Record<string, number> {
	version: number;
	rev: number;
}

export interface DeviceConfigInput {
	gramsPerFeeding: number | null | undefined;
	buttonFeedGrams: number | null | undefined;
	gramsPerSecond: number | null | undefined;
	tempOffsetC: number | null | undefined;
	hopperFullCm: number | null | undefined;
	hopperEmptyCm: number | null | undefined;
	/** Resolved daily ceiling (`resolveDailyCapG`), already factor/hopper capped. */
	dailyCapG: number;
	/** Platform relay-time cap (`feeding.limits.maxDispenseMs`). */
	maxDispenseMs: number;
}

export interface BuildFirmwareConfigInput {
	device: DeviceConfigInput;
	/** Normalized stored values (`getFirmwareGates`). */
	gates: FirmwareValues;
	/** I-95 device connectivity policy (informational, echoed in `diag`). */
	deviceStatus?: { weakAfterMin?: number | null; offlineAfterMin?: number | null };
}

/**
 * Build the `config` object for one device.
 *
 * Device values and the resolved daily ceiling are overlaid on the stored gate
 * values, then every field is clamped into the envelope one last time. The
 * result is what the firmware validates, so a bad device row cannot raise a
 * bound; the firmware would reject it and keep last-good either way.
 */
export function buildFirmwareConfig(input: BuildFirmwareConfigInput): FirmwareConfig {
	const values: FirmwareValues = { ...input.gates };

	const set = (id: string, value: number | null | undefined) => {
		const field = firmwareField(id);
		if (!field) return;
		values[id] = value === null || value === undefined ? field.defaultValue : value;
	};

	set("grams_per_feeding", input.device.gramsPerFeeding);
	set("button_feed_grams", input.device.buttonFeedGrams);
	set("grams_per_second", input.device.gramsPerSecond);
	set("temp_offset_c", input.device.tempOffsetC);
	set("hopper_full_cm", input.device.hopperFullCm);
	set("hopper_empty_cm", input.device.hopperEmptyCm);
	set("max_grams_per_day", input.device.dailyCapG);
	set("max_dispense_ms", input.device.maxDispenseMs);
	set("weak_after_min", input.deviceStatus?.weakAfterMin);
	set("offline_after_min", input.deviceStatus?.offlineAfterMin);

	if (!(values.hopper_full_cm < values.hopper_empty_cm)) {
		values.hopper_full_cm = firmwareField("hopper_full_cm")?.defaultValue ?? 5;
		values.hopper_empty_cm = firmwareField("hopper_empty_cm")?.defaultValue ?? 30;
	}

	const normalized = normalizeFirmwareValues(values);
	const config = {
		version: FIRMWARE_CONFIG_VERSION,
		rev: 0,
		...normalized,
	};
	config.rev = firmwareConfigRev(config);
	return config as FirmwareConfig;
}

/** FNV-1a over the canonical field order: stable across processes and deploys. */
export function firmwareConfigRev(values: FirmwareValues): number {
	let hash = 0x811c9dc5;
	const text = FIRMWARE_FIELDS.map((field) => `${field.id}=${values[field.id]}`).join("&");
	for (let i = 0; i < text.length; i += 1) {
		hash ^= text.charCodeAt(i);
		hash = Math.imul(hash, 0x01000193) >>> 0;
	}
	// ArduinoJson parses `rev` as uint32; keep it inside a signed 32-bit range so
	// a JavaScript consumer and the device agree (it is only an echo).
	return hash & 0x7fffffff;
}

/** Digits used per unit in human text (grams, seconds) - no thousands separator. */
export function formatFirmwareValue(value: number): string {
	return Number.isInteger(value) ? String(value) : String(Math.round(value * 100) / 100);
}
