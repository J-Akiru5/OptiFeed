import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
	FIRMWARE_CONFIG_VERSION,
	FIRMWARE_DEFAULTS,
	FIRMWARE_FIELDS,
	FIRMWARE_GATE_FIELDS,
	buildFirmwareConfig,
	firmwareConfigRev,
	normalizeFirmwareValues,
} from "@/lib/firmware/config";
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

function build(overrides: Partial<typeof DEVICE> = {}, gates = FIRMWARE_DEFAULTS) {
	return buildFirmwareConfig({
		device: { ...DEVICE, ...overrides },
		gates,
		deviceStatus: { weakAfterMin: 5, offlineAfterMin: 15 },
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

describe("contract with firmware/firmware-main/config.h", () => {
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
