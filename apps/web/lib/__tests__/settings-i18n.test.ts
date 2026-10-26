import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Guards the farmer settings copy (T-09d).
 *
 * The settings pages and the forms they render must take every user-visible
 * string from the message catalogue, and the Hiligaynon draft must keep the
 * same keys and placeholders as English. The last block also fails if a
 * retired English literal, a raw browser date/time format, or an unlabelled
 * navigation arrow creeps back in.
 */

const messagesDir = join(__dirname, "../../messages");
const webRoot = join(__dirname, "../..");

type Tree = { [key: string]: string | Tree };

function flatten(tree: Tree, prefix = ""): Record<string, string> {
	const out: Record<string, string> = {};
	for (const [key, value] of Object.entries(tree)) {
		const path = prefix ? `${prefix}.${key}` : key;
		if (typeof value === "string") out[path] = value;
		else Object.assign(out, flatten(value, path));
	}
	return out;
}

function load(locale: string): Tree {
	return JSON.parse(readFileSync(join(messagesDir, `${locale}.json`), "utf8"));
}

function placeholders(message: string): string[] {
	return [...message.matchAll(/\{(\w+)/g)].map((match) => match[1]).sort();
}

const NAMESPACES = [
	"dashboard.settings",
	"dashboard.profileSettings",
	"dashboard.appSettings",
	"dashboard.importExport",
	"dashboard.dataSettings",
];

/** Keys the settings pages and forms rely on; a rename without a message fails. */
const REQUIRED = [
	"dashboard.settings.title",
	"dashboard.settings.cardsLabel",
	"dashboard.settings.openCard",
	"dashboard.settings.noPondsHint",
	"dashboard.settings.errorLoadDesc",
	"dashboard.settings.saving",
	"dashboard.settings.saveError",
	"dashboard.settings.sampleIntervalLabel",
	"dashboard.settings.populationLabel",
	"dashboard.settings.signOutButton",
	"dashboard.profileSettings.notificationsSaved",
	"dashboard.profileSettings.notificationsSaveError",
	"dashboard.appSettings.noDeviceDesc",
	"dashboard.appSettings.currentLevelLabel",
	"dashboard.appSettings.currentLevelValue",
	"dashboard.appSettings.offlineFor",
	"dashboard.appSettings.durationHoursMinutes",
	"dashboard.appSettings.durationMinutes",
	"dashboard.appSettings.saving",
	"dashboard.appSettings.calibrationSaveError",
	"dashboard.appSettings.temperatureCalibration",
	"dashboard.appSettings.temperatureCalibrationDesc",
	"dashboard.appSettings.tempOffsetLabel",
	"dashboard.appSettings.tempOffsetHelp",
	"dashboard.appSettings.rawReading",
	"dashboard.appSettings.calibrated",
	"dashboard.appSettings.noTemperatureReading",
	"dashboard.appSettings.temperatureSaved",
	"dashboard.importExport.close",
	"dashboard.importExport.exportNotReady",
	"dashboard.importExport.exportDownloadFailed",
	"dashboard.importExport.rowError",
	"dashboard.importExport.previewTableLabel",
	"dashboard.importExport.types.biomass_logs",
];

const en = flatten(load("en"));
const hil = flatten(load("hil"));

describe("settings strings exist in every locale", () => {
	it("covers all settings namespaces", () => {
		for (const namespace of NAMESPACES) {
			expect(
				Object.keys(en).filter((key) => key.startsWith(`${namespace}.`)).length,
				`no messages under ${namespace}`,
			).toBeGreaterThan(0);
		}
	});

	it("has the keys the settings pages and forms render", () => {
		for (const key of REQUIRED) {
			expect(en[key], `en is missing ${key}`).toBeTruthy();
		}
	});

	it("keeps Hiligaynon in step with English for the settings namespaces", () => {
		for (const namespace of NAMESPACES) {
			const englishKeys = Object.keys(en).filter((key) => key.startsWith(`${namespace}.`));
			for (const key of englishKeys) {
				expect(hil[key], `hil is missing ${key}`).toBeTruthy();
				expect(placeholders(hil[key]), `hil placeholders differ for ${key}`).toEqual(
					placeholders(en[key]),
				);
			}
		}
	});
});

function walk(dir: string, out: string[] = []): string[] {
	for (const entry of readdirSync(dir)) {
		const full = join(dir, entry);
		if (statSync(full).isDirectory()) walk(full, out);
		else if (/\.(tsx|ts)$/.test(entry)) out.push(full);
	}
	return out;
}

const settingsFiles = [
	...walk(join(webRoot, "app/[locale]/(dashboard)/dashboard/settings")),
	...walk(join(webRoot, "app/[locale]/(dashboard)/dashboard/app-settings")),
	...walk(join(webRoot, "app/[locale]/(dashboard)/dashboard/profile-settings")),
	join(webRoot, "components/farm-rename-form.tsx"),
	join(webRoot, "components/DataImportExport.tsx"),
	join(webRoot, "components/DurationCalibrationForm.tsx"),
	join(webRoot, "components/HopperCalibrationForm.tsx"),
	join(webRoot, "components/TemperatureCalibrationForm.tsx"),
	join(webRoot, "components/PondSettingsForm.tsx"),
	join(webRoot, "components/change-password-form.tsx"),
	join(webRoot, "components/notification-prefs-form.tsx"),
	join(webRoot, "components/LogoutButton.tsx"),
	join(webRoot, "components/LiveClock.tsx"),
].filter((file) => !file.includes(".test."));

/** Copy that used to be hard-coded on these pages and must stay translated. */
const RETIRED_LITERALS = [
	"Current level:",
	"Temperature Calibration",
	"Apply an offset to correct",
	"Current offset:",
	"Full Distance (cm)",
	"Empty Distance (cm)",
	"Hopper Capacity (grams)",
	"Sample Interval (days)",
	"Population (fish)",
	"Calibration saved!",
	"Temperature calibration saved!",
	"Notification preferences saved",
	"Failed to save preferences",
	"Failed to save calibration",
	"Navigate",
	"Sign Out",
	"Saving...",
];

describe("the settings pages read their copy from the catalogue", () => {
	it("scans the settings files", () => {
		expect(settingsFiles.length).toBeGreaterThan(10);
	});

	it("no longer hard-codes retired English copy", () => {
		for (const file of settingsFiles) {
			const content = readFileSync(file, "utf8");
			for (const literal of RETIRED_LITERALS) {
				expect(content.includes(literal), `${file} still contains "${literal}"`).toBe(false);
			}
		}
	});

	it("never formats time with the browser locale", () => {
		for (const file of settingsFiles) {
			const content = readFileSync(file, "utf8");
			expect(content.includes("toLocaleTimeString("), `${file} uses toLocaleTimeString`).toBe(
				false,
			);
			expect(content.includes("toLocaleString("), `${file} uses toLocaleString`).toBe(false);
			expect(content.includes("toLocaleDateString("), `${file} uses toLocaleDateString`).toBe(
				false,
			);
		}
	});

	it("keeps LiveClock on the shared date helper", () => {
		const clock = readFileSync(join(webRoot, "components/LiveClock.tsx"), "utf8");
		expect(clock).toContain("formatDateTimeLocal(");
		expect(clock).toContain('useTranslations("dates")');
	});
});
