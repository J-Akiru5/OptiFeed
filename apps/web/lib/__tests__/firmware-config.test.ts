import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
	FIRMWARE_CONFIG_VERSION,
	FIRMWARE_DEFAULTS,
	FIRMWARE_FIELDS,
	FIRMWARE_GATE_FIELDS,
	FIRMWARE_HEARTBEAT_INTERVAL_S,
	buildFirmwareConfig,
	firmwareConfigRev,
	normalizeFirmwareValues,
} from "@/lib/firmware/config";
import {
	CALIBRATION_ACTUAL_GRAMS_MAX,
	CALIBRATION_MAX_DISPENSE_MS,
	CALIBRATION_MAX_GRAMS,
	CALIBRATION_TEST_GRAMS_MAX,
	CALIBRATION_TEST_SECONDS_MAX,
	MAX_DISPENSE_MS,
	MAX_FEED_GRAMS_PER_DAY_PER_DEVICE,
} from "@/lib/limits";
import { describe, expect, it } from "vitest";

/**
 * I-100: the server-side firmware config and its contract with the device.
 *
 * The last block parses `firmware/firmware-main/config.h` and fails if the two
 * field tables drift, so a value can never be enforced on one side only.
 */

const cwd = process.cwd();
const repoRoot = existsSync(join(cwd, "firmware")) ? cwd : join(cwd, "..", "..");
// Strip the macro's backslash line continuations so one regex reads every entry.
const header = readFileSync(join(repoRoot, "firmware/firmware-main/config.h"), "utf8").replace(
	/\\\r?\n/g,
	" ",
);

/** The firmware's own field table, parsed from the authoritative header. */
function firmwareFields() {
	const block = header.slice(header.indexOf("#define FW_CONFIG_FIELDS"));
	const entries = [
		...block.matchAll(
			/X\((\w+),\s*"([^"]+)",\s*(-?[\d.]+)f,\s*(-?[\d.]+)f,\s*(true|false),\s*(-?[\d.]+)f\)/g,
		),
	];
	return entries.map((match) => ({
		name: match[1],
		key: match[2],
		min: Number(match[3]),
		max: Number(match[4]),
		integer: match[5] === "true",
		defaultValue: Number(match[6]),
	}));
}

const DEVICE = {
	gramsPerFeeding: 150,
	buttonFeedGrams: 80,
	gramsPerSecond: 4,
	tempOffsetC: 0,
	hopperFullCm: 5,
	hopperEmptyCm: 30,
	dailyCapG: 2000,
	maxDispenseMs: 300_000,
};

function build(
	overrides: Partial<typeof DEVICE> = {},
	gates = FIRMWARE_DEFAULTS,
	org?: { hopperLowPct?: number | null },
) {
	return buildFirmwareConfig({
		device: { ...DEVICE, ...overrides },
		gates,
		deviceStatus: { weakAfterMin: 5, offlineAfterMin: 15 },
		org,
	});
}

describe("firmware config defaults", () => {
	it("equals the compile-time values firmware 1.6.x shipped with", () => {
		expect(FIRMWARE_DEFAULTS).toMatchObject({
			min_dispense_gap_s: 10,
			max_dispenses_per_hour: 6,
			max_grams_per_day: 5000,
			max_dispense_ms: 300000,
			brownout_hold_s: 60,
			safe_mode_abnormal_threshold: 3,
			grams_per_feeding: 150,
			button_feed_grams: 80,
			grams_per_second: 4,
			heartbeat_interval_s: 5,
			ota_check_interval_s: 1800,
			ota_min_rssi_dbm: -75,
		});
	});

	it("exposes exactly the seven editable gates", () => {
		expect(FIRMWARE_GATE_FIELDS.map((field) => field.id)).toEqual([
			"min_dispense_gap_s",
			"max_dispenses_per_hour",
			"brownout_hold_s",
			"safe_mode_abnormal_window_s",
			"safe_mode_abnormal_threshold",
			"safe_mode_quiet_s",
			"safe_mode_healthy_clear_s",
		]);
	});
});

describe("normalizeFirmwareValues", () => {
	it("drops unknown keys and falls back to defaults", () => {
		const value = normalizeFirmwareValues({ nonsense: 1, min_dispense_gap_s: "20" });
		expect(value.min_dispense_gap_s).toBe(20);
		expect(value).not.toHaveProperty("nonsense");
		expect(value.max_dispenses_per_hour).toBe(6);
	});

	it("clamps an out-of-range stored value into the envelope", () => {
		const value = normalizeFirmwareValues({
			min_dispense_gap_s: 1,
			max_dispenses_per_hour: 99,
			max_grams_per_day: 9000,
		});
		expect(value.min_dispense_gap_s).toBe(10);
		expect(value.max_dispenses_per_hour).toBe(6);
		expect(value.max_grams_per_day).toBe(5000);
	});

	it("repairs inverted hopper geometry and an inverted OTA window", () => {
		const value = normalizeFirmwareValues({
			hopper_full_cm: 30,
			hopper_empty_cm: 10,
			ota_window_start_min: 900,
			ota_window_end_min: 600,
		});
		expect(value.hopper_full_cm).toBe(5);
		expect(value.hopper_empty_cm).toBe(30);
		expect(value.ota_window_start_min).toBe(600);
		expect(value.ota_window_end_min).toBe(900);
	});
});

describe("buildFirmwareConfig", () => {
	it("sends a versioned object with every field inside its envelope", () => {
		const config = build();
		expect(config.version).toBe(FIRMWARE_CONFIG_VERSION);
		expect(config.rev).toBeGreaterThan(0);
		for (const field of FIRMWARE_FIELDS) {
			expect(config[field.id]).toBeGreaterThanOrEqual(field.min);
			expect(config[field.id]).toBeLessThanOrEqual(field.max);
		}
	});

	it("overlays the device row and the resolved daily ceiling", () => {
		const config = build({
			gramsPerFeeding: 175,
			buttonFeedGrams: 120,
			gramsPerSecond: 6.5,
			hopperFullCm: 6,
			hopperEmptyCm: 28,
			dailyCapG: 2500,
			maxDispenseMs: 120_000,
		});
		expect(config.grams_per_feeding).toBe(175);
		expect(config.button_feed_grams).toBe(120);
		expect(config.grams_per_second).toBe(6.5);
		expect(config.hopper_full_cm).toBe(6);
		expect(config.hopper_empty_cm).toBe(28);
		expect(config.max_grams_per_day).toBe(2500);
		expect(config.max_dispense_ms).toBe(120_000);
	});

	it("clamps a bad device row instead of sending it to the device", () => {
		const config = build({ gramsPerSecond: 5000, dailyCapG: 50_000, maxDispenseMs: 45 });
		expect(config.grams_per_second).toBe(50);
		expect(config.max_grams_per_day).toBe(5000);
		expect(config.max_dispense_ms).toBe(5000);
	});

	it("falls back to the default geometry when the two hopper values are inverted", () => {
		const config = build({ hopperFullCm: 40, hopperEmptyCm: 10 });
		expect(config.hopper_full_cm).toBe(5);
		expect(config.hopper_empty_cm).toBe(30);
	});

	it("is revision-stable and changes when a value changes", () => {
		expect(build().rev).toBe(build().rev);
		expect(build({ gramsPerFeeding: 175 }).rev).not.toBe(build().rev);
	});

	it("carries the I-95 connectivity policy as diagnostics", () => {
		const config = buildFirmwareConfig({
			device: DEVICE,
			gates: FIRMWARE_DEFAULTS,
			deviceStatus: { weakAfterMin: 3, offlineAfterMin: 12 },
		});
		expect(config.weak_after_min).toBe(3);
		expect(config.offline_after_min).toBe(12);
	});

	it("hashes the canonical field order, not the object insertion order", () => {
		const shuffled = Object.fromEntries(
			[...FIRMWARE_FIELDS].reverse().map((field) => [field.id, FIRMWARE_DEFAULTS[field.id]]),
		);
		expect(firmwareConfigRev(shuffled)).toBe(firmwareConfigRev(FIRMWARE_DEFAULTS));
	});
});

describe("buildFirmwareConfig: organization hopper threshold (#456)", () => {
	it("sends the org value and changes the config revision", () => {
		const base = build();
		const config = build({}, FIRMWARE_DEFAULTS, { hopperLowPct: 35 });
		expect(config.hopper_low_pct).toBe(35);
		expect(config.rev).not.toBe(base.rev);
	});

	it("keeps the gate/default value when the org is absent or null", () => {
		const gates = { ...FIRMWARE_DEFAULTS, hopper_low_pct: 42 };
		expect(build({}, gates).hopper_low_pct).toBe(42);
		expect(build({}, gates, {}).hopper_low_pct).toBe(42);
		expect(build({}, gates, { hopperLowPct: null }).hopper_low_pct).toBe(42);
	});

	it("ignores a non-finite org value instead of resetting the field", () => {
		const gates = { ...FIRMWARE_DEFAULTS, hopper_low_pct: 42 };
		expect(build({}, gates, { hopperLowPct: Number.NaN }).hopper_low_pct).toBe(42);
	});

	it("clamps an out-of-envelope org value to the firmware envelope", () => {
		expect(build({}, FIRMWARE_DEFAULTS, { hopperLowPct: 0 }).hopper_low_pct).toBe(1);
		expect(build({}, FIRMWARE_DEFAULTS, { hopperLowPct: 99 }).hopper_low_pct).toBe(90);
	});
});

describe("buildFirmwareConfig: per-device hopper filter (#659)", () => {
	const filters = {
		hopper_refill_margin_pct: 15,
		hopper_reject_below_cm: 3,
		hopper_reject_above_margin_cm: 12,
		hopper_ema_alpha: 0.2,
		hopper_jump_pct: 25,
		hopper_persist_cycles: 5,
		hopper_state_hold_s: 120,
	};

	it("overlays the device's filter values onto the config", () => {
		const config = buildFirmwareConfig({
			device: { ...DEVICE, hopperFilter: filters },
			gates: FIRMWARE_DEFAULTS,
		});
		for (const [key, value] of Object.entries(filters)) {
			expect(config[key], key).toBe(value);
		}
		expect(config.rev).not.toBe(build().rev);
	});

	it("keeps the compile-time value when a column is null", () => {
		const config = buildFirmwareConfig({
			device: { ...DEVICE, hopperFilter: { hopper_ema_alpha: null } },
			gates: FIRMWARE_DEFAULTS,
		});
		expect(config.hopper_ema_alpha).toBe(FIRMWARE_DEFAULTS.hopper_ema_alpha);
	});

	it("clamps a bad stored value instead of sending it to the device", () => {
		const config = buildFirmwareConfig({
			device: {
				...DEVICE,
				hopperFilter: { hopper_ema_alpha: 0, hopper_persist_cycles: 99 },
			},
			gates: FIRMWARE_DEFAULTS,
		});
		expect(config.hopper_ema_alpha).toBe(0.05);
		expect(config.hopper_persist_cycles).toBe(20);
	});

	it("leaves every filter at its default when the device has none", () => {
		const config = build();
		expect(config.hopper_ema_alpha).toBe(0.35);
		expect(config.hopper_state_hold_s).toBe(600);
	});
});

describe("contract with firmware/firmware-main/config.h", () => {
	it("parses a field table with the same size", () => {
		expect(firmwareFields()).toHaveLength(FIRMWARE_FIELDS.length);
	});

	it("declares identical keys, envelopes, integer flags and defaults", () => {
		const fields = firmwareFields();
		for (let index = 0; index < fields.length; index += 1) {
			const firmware = fields[index];
			const server = FIRMWARE_FIELDS[index];
			expect(server.key).toBe(firmware.key);
			expect(server.min).toBe(firmware.min);
			expect(server.max).toBe(firmware.max);
			expect(server.integer).toBe(firmware.integer);
			expect(server.defaultValue).toBe(firmware.defaultValue);
			expect(server.id).toBe(firmware.key);
		}
	});
});

/**
 * #662: the calibration caps and the heartbeat cadence were copied into the
 * app as independent literals, so a firmware change could leave them behind.
 * These assertions read the header, not `config.ts`, so they fail on the drift
 * the field-table test above cannot see.
 */
describe("app-side mirrors of the firmware tuning limits (#662)", () => {
	function firmwareFieldByKey(key: string) {
		const field = firmwareFields().find((entry) => entry.key === key);
		if (!field) throw new Error(`config.h has no field "${key}"`);
		return field;
	}

	it("takes every relay and calibration cap from the header's envelope", () => {
		expect(MAX_FEED_GRAMS_PER_DAY_PER_DEVICE).toBe(firmwareFieldByKey("max_grams_per_day").max);
		expect(MAX_DISPENSE_MS).toBe(firmwareFieldByKey("max_dispense_ms").max);
		expect(CALIBRATION_MAX_GRAMS).toBe(firmwareFieldByKey("calibration_max_grams").max);
		expect(CALIBRATION_MAX_DISPENSE_MS).toBe(firmwareFieldByKey("calibration_max_dispense_ms").max);
	});

	it("derives the calibration test window instead of restating it", () => {
		// The 600 s test window is the relay ceiling, not a second opinion.
		expect(CALIBRATION_TEST_SECONDS_MAX * 1000).toBe(CALIBRATION_MAX_DISPENSE_MS);
		expect(CALIBRATION_TEST_GRAMS_MAX).toBe(CALIBRATION_MAX_GRAMS);
		expect(CALIBRATION_ACTUAL_GRAMS_MAX).toBe(CALIBRATION_MAX_GRAMS);
	});

	it("sizes the connectivity gap from the header's heartbeat default", () => {
		// `heartbeat_interval_s` is firmware-only; the app mirrors its default.
		expect(FIRMWARE_HEARTBEAT_INTERVAL_S).toBe(
			firmwareFieldByKey("heartbeat_interval_s").defaultValue,
		);
		expect(firmwareFieldByKey("heartbeat_interval_s").max).toBeGreaterThanOrEqual(
			FIRMWARE_HEARTBEAT_INTERVAL_S,
		);
	});
});
