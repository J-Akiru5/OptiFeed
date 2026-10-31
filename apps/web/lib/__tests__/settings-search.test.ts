import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { SEARCH_SETTINGS, settingTargets, settingsFor } from "@/lib/search/settings-catalogue";
import { pondSettingTargets } from "@/lib/settings/pond-fields";
import { describe, expect, it } from "vitest";

/**
 * The settings search catalogue (#370).
 *
 * The issue was concrete: typing "feed ceiling" found nothing. These tests pin
 * the three things that make it work now: the entry exists and is reachable by
 * those words, its deep link points at a control that really exists, and a role
 * only ever sees the settings it may open.
 */

const WEB_ROOT = process.cwd();
const ROOTS = ["app", "components"];

function sourceFiles(dir: string): string[] {
	if (!existsSync(dir)) return [];
	return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
		if (entry.isDirectory()) {
			if (entry.name.startsWith(".") || entry.name === "node_modules") return [];
			return sourceFiles(join(dir, entry.name));
		}
		return /\.(ts|tsx)$/.test(entry.name) ? [join(dir, entry.name)] : [];
	});
}

let anchors: Set<string> | null = null;

function anchorsInSource(): Set<string> {
	if (anchors) return anchors;
	const found = new Set<string>();
	for (const root of ROOTS) {
		for (const file of sourceFiles(join(WEB_ROOT, root))) {
			const text = readFileSync(file, "utf8");
			// Literal anchors, plus the `anchor="..."` prop whose value a wrapper
			// (the org settings Card) forwards to `data-help`.
			for (const match of text.matchAll(/(?:data-help|anchor)="([a-z0-9-]+)"/g)) {
				if (match[1]) found.add(match[1]);
			}
		}
	}
	anchors = found;
	return found;
}

/**
 * The pond fields render their anchor from the shared catalogue
 * (`data-help={spec.target}`), so a literal scan cannot see them. Prove the
 * form really maps that catalogue instead of trusting the list.
 */
let pondFormUsesCatalogue: boolean | null = null;

function formConsumesPondFields(): boolean {
	if (pondFormUsesCatalogue !== null) return pondFormUsesCatalogue;
	const text = readFileSync(join(WEB_ROOT, "components/PondSettingsForm.tsx"), "utf8");
	pondFormUsesCatalogue =
		text.includes("POND_SETTINGS_FIELDS.map") && text.includes("data-help={spec.target}");
	return pondFormUsesCatalogue;
}

function loadMessages(locale: "en" | "hil"): Record<string, unknown> {
	return JSON.parse(readFileSync(join(WEB_ROOT, "messages", `${locale}.json`), "utf8")) as Record<
		string,
		unknown
	>;
}

function resolve(messages: Record<string, unknown>, key: string): string | undefined {
	const value = key.split(".").reduce<unknown>((node, part) => {
		if (typeof node !== "object" || node === null) return undefined;
		return (node as Record<string, unknown>)[part];
	}, messages);
	return typeof value === "string" ? value : undefined;
}

/** The dialog's matcher: translated title + description + synonyms. */
function matches(setting: (typeof SEARCH_SETTINGS)[number], needle: string): boolean {
	const messages = loadMessages("en");
	const haystack = [
		resolve(messages, setting.titleKey) ?? "",
		resolve(messages, setting.descriptionKey) ?? "",
		...setting.keywords,
	]
		.join(" ")
		.toLowerCase();
	return haystack.includes(needle.toLowerCase());
}

describe("settings entries are reachable by the words people use", () => {
	it("finds the daily feed ceiling when the reader types 'feed ceiling'", () => {
		const matchesFor = SEARCH_SETTINGS.filter((setting) => matches(setting, "feed ceiling"));
		expect(matchesFor.map((setting) => setting.id)).toContain("daily-feed-ceiling");
	});

	it("matches the synonym families: ceiling, cap, limit, takda", () => {
		for (const needle of ["ceiling", "cap", "limit", "takda"]) {
			expect(
				SEARCH_SETTINGS.filter((setting) => matches(setting, needle)).map((setting) => setting.id),
				`"${needle}" should find the daily ceiling`,
			).toContain("daily-feed-ceiling");
		}
	});

	it("finds hopper capacity and the low-hopper threshold", () => {
		expect(
			SEARCH_SETTINGS.filter((setting) => matches(setting, "hopper capacity")).map(
				(setting) => setting.id,
			),
		).toContain("hopper-capacity");
		expect(
			SEARCH_SETTINGS.filter((setting) => matches(setting, "low hopper")).map(
				(setting) => setting.id,
			),
		).toContain("org-low-hopper-threshold");
	});

	it("finds the feeding schedule and calibration", () => {
		expect(
			SEARCH_SETTINGS.filter((setting) => matches(setting, "feeding schedule")).map(
				(setting) => setting.id,
			),
		).toContain("feeding-schedule");
		expect(
			SEARCH_SETTINGS.filter((setting) => matches(setting, "calibration")).map(
				(setting) => setting.id,
			),
		).toContain("calibration");
	});
});

describe("settings deep links point at real controls", () => {
	it("uses a route plus a hash that names a control on that route", () => {
		for (const setting of SEARCH_SETTINGS) {
			expect(setting.href.startsWith(`${setting.route}#`), setting.id).toBe(true);
			expect(setting.href.slice(setting.route.length + 1).length).toBeGreaterThan(0);
		}
	});

	it("points every target at a data-help anchor that exists in app/ or components/", () => {
		const found = anchorsInSource();
		const dynamic = new Set(pondSettingTargets());
		for (const target of settingTargets()) {
			const present = found.has(target) || (dynamic.has(target) && formConsumesPondFields());
			expect(present, `no data-help="${target}" anywhere in app/ or components/`).toBe(true);
		}
	});

	it("keeps ids unique and the target list complete", () => {
		const ids = SEARCH_SETTINGS.map((setting) => setting.id);
		expect(new Set(ids).size).toBe(ids.length);
		expect(settingTargets().length).toBe(SEARCH_SETTINGS.length);
	});

	it("has copy for every title and description in both locales", () => {
		for (const locale of ["en", "hil"] as const) {
			const messages = loadMessages(locale);
			for (const setting of SEARCH_SETTINGS) {
				const title = resolve(messages, setting.titleKey);
				const description = resolve(messages, setting.descriptionKey);
				expect(title, `${locale}: ${setting.titleKey} is missing`).toBeTruthy();
				expect(description, `${locale}: ${setting.descriptionKey} is missing`).toBeTruthy();
			}
		}
	});
});

describe("settings are role-aware", () => {
	it("gives a farmer the pond and hardware settings only", () => {
		const ids = settingsFor("farmer", new Set(), "farmer").map((row) => row.id);
		expect(ids).toContain("settings:daily-feed-ceiling");
		expect(ids).toContain("settings:pond-feeding-rate");
		expect(ids.some((id) => id.startsWith("settings:org-"))).toBe(false);
		expect(ids.some((id) => id.startsWith("settings:platform-"))).toBe(false);
	});

	it("gives a tenant admin the organization settings too", () => {
		const ids = settingsFor("tenantAdmin", new Set(["manage_farms_ponds"]), "admin").map(
			(row) => row.id,
		);
		expect(ids).toContain("settings:org-low-hopper-threshold");
		expect(ids).toContain("settings:org-device-registration");
		expect(ids.some((id) => id.startsWith("settings:platform-"))).toBe(false);
	});

	it("hides organization settings without the permission", () => {
		const ids = settingsFor("tenantAdmin", new Set(), "admin").map((row) => row.id);
		expect(ids.some((id) => id.startsWith("settings:org-"))).toBe(false);
	});

	it("gives a platform admin the platform configuration only", () => {
		const ids = settingsFor("platform", new Set(), "platform").map((row) => row.id);
		expect(ids).toContain("settings:platform-safety-caps");
		expect(ids).toContain("settings:platform-page-size");
		expect(ids.some((id) => id.startsWith("settings:org-"))).toBe(false);
		expect(ids).not.toContain("settings:daily-feed-ceiling");
	});

	it("carries the row shape the dialog needs to reveal the control", () => {
		const [row] = settingsFor("farmer", new Set(), "farmer").filter(
			(candidate) => candidate.id === "settings:daily-feed-ceiling",
		);
		expect(row).toMatchObject({
			group: "settings",
			titleKey: "search.settings.dailyFeedCeiling.title",
			descriptionKey: "search.settings.dailyFeedCeiling.description",
			href: "/dashboard/settings/hardware#daily-ceiling",
			settingTarget: "device-daily-ceiling",
			settingRoute: "/dashboard/settings/hardware",
		});
		expect(row?.keywords).toContain("takda");
	});
});
