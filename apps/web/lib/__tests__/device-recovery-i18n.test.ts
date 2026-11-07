import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The M2 recovery copy is part of the feature, not decoration: an operator in
 * the field reads it while a feeder is locked. Every state, cause, verification
 * check and clear mechanism must exist in `en`, `tl` and `hil`, and the copy
 * must never turn a panic into a power-supply instruction.
 */

type Tree = { [key: string]: string | Tree };

const messagesDir = join(__dirname, "../../messages");

function load(locale: string): Tree {
	return JSON.parse(readFileSync(join(messagesDir, `${locale}.json`), "utf8"));
}

function flatten(tree: Tree, prefix = ""): Record<string, string> {
	const out: Record<string, string> = {};
	for (const [key, value] of Object.entries(tree)) {
		const path = prefix ? `${prefix}.${key}` : key;
		if (typeof value === "string") out[path] = value;
		else Object.assign(out, flatten(value, path));
	}
	return out;
}

const locales = ["en", "tl", "hil"] as const;
const catalogues = Object.fromEntries(
	locales.map((locale) => [locale, flatten(load(locale))]),
) as Record<(typeof locales)[number], Record<string, string>>;

const RECOVERY_KEYS = [
	"title",
	"desc",
	"stateLabel",
	"stateHealthy",
	"stateSafeMode",
	"stateRecovering",
	"stateOffline",
	"stateFault",
	"stateMaintenance",
	"unavailableTitle",
	"unavailableBody",
	"causeTitle",
	"causeNone",
	"causePower",
	"causeController",
	"causeWatchdog",
	"causeSoftware",
	"causeExternal",
	"causePowerOn",
	"causeDeepSleep",
	"causeSdio",
	"causeUnknown",
	"uptimeLabel",
	"uptimeValue",
	"uptimeHours",
	"abnormalLabel",
	"safeModeLabel",
	"on",
	"off",
	"quietTitle",
	"quietRemaining",
	"quietDone",
	"quietUnknown",
	"repeatTitle",
	"repeatBody",
	"safeToRecover",
	"notSafeToRecover",
	"clearTitle",
	"clearQuiet",
	"clearQuietBody",
	"clearHold",
	"clearHoldBody",
	"clearHoldUnknown",
	"verifyTitle",
	"verifyHeartbeat",
	"verifyConnectivity",
	"verifySensors",
	"verifyFirmware",
	"checkPass",
	"checkFail",
	"checkUnknown",
	"calibrationTitle",
	"calibrationAllowed",
	"calibrationSafeMode",
	"calibrationRecovering",
	"calibrationFault",
	"calibrationOffline",
	"calibrationMaintenance",
].map((key) => `dashboard.appSettings.recovery.${key}`);

const CALIBRATION_KEYS = [
	"dashboard.appSettings.calibration.guided.blockedSafeMode",
	"dashboard.appSettings.calibration.guided.blockedRecovering",
	"dashboard.appSettings.calibration.guided.blockedFault",
];

describe("recovery copy in every locale", () => {
	it("ships every recovery key in en, tl and hil", () => {
		for (const locale of locales) {
			for (const key of [...RECOVERY_KEYS, ...CALIBRATION_KEYS]) {
				expect(catalogues[locale][key], `${key} missing from ${locale}`).toBeTruthy();
			}
		}
	});

	it("translates the six health states, not just the English ones", () => {
		const states = [
			"stateHealthy",
			"stateSafeMode",
			"stateRecovering",
			"stateOffline",
			"stateFault",
			"stateMaintenance",
		];
		for (const locale of locales) {
			for (const state of states) {
				expect(
					catalogues[locale][`dashboard.appSettings.recovery.${state}`],
					`${state} missing from ${locale}`,
				).toBeTruthy();
			}
		}
	});

	it("keeps the same ICU placeholders in every locale", () => {
		const withPlaceholders = RECOVERY_KEYS.filter((key) =>
			/\{\w+\s*[,}]/.test(catalogues.en[key] ?? ""),
		);
		expect(withPlaceholders.length).toBeGreaterThan(0);
		for (const key of withPlaceholders) {
			const expected = [...(catalogues.en[key] ?? "").matchAll(/\{(\w+)\s*[,}]/g)]
				.map((match) => match[1])
				.sort();
			for (const locale of ["tl", "hil"] as const) {
				const actual = [...(catalogues[locale][key] ?? "").matchAll(/\{(\w+)\s*[,}]/g)]
					.map((match) => match[1])
					.sort();
				expect(actual, `${key} placeholders differ in ${locale}`).toEqual(expected);
			}
		}
	});
});

describe("a panic is never a power-supply instruction", () => {
	it("names the controller crash and denies the supply fault", () => {
		const copy = catalogues.en["dashboard.appSettings.recovery.causeController"];
		expect(copy).toContain("ESP_RST_PANIC");
		expect(copy).toContain("not a power-supply fault");
		expect(copy).not.toMatch(/check the power|replace the (power supply|PSU)/i);
	});

	it("turns only a brownout into a power-supply check", () => {
		const copy = catalogues.en["dashboard.appSettings.recovery.causePower"];
		expect(copy).toContain("ESP_RST_BROWNOUT");
		expect(copy).toMatch(/power adapter|cable|battery/i);
	});

	it("keeps the same distinction in tl and hil", () => {
		for (const locale of ["tl", "hil"] as const) {
			const panic = catalogues[locale]["dashboard.appSettings.recovery.causeController"];
			expect(panic).toContain("ESP_RST_PANIC");
			expect(panic).not.toMatch(/check the power|replace the (power supply|PSU)/i);
			const power = catalogues[locale]["dashboard.appSettings.recovery.causePower"];
			expect(power).toContain("ESP_RST_BROWNOUT");
		}
	});
});
