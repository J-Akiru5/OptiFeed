import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const messagesDir = join(__dirname, "../../messages");
const locales = ["en", "hil"] as const;

type Tree = { [key: string]: string | Tree };

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

function placeholders(message: string): string[] {
	return [...message.matchAll(/\{(\w+)/g)].map((m) => m[1]).sort();
}

const sections = ["dashboard.adminDeviceLabels"] as const;
// The sticker is a physical label and is English only, so it has no translations.
const STICKER = "dashboard.adminDeviceLabels.sticker.";
const deviceKeys = ["printLabel", "printSelected", "labelColumn", "selectForLabel"];

describe("device label strings exist in every locale", () => {
	const en = flatten(load("en"));

	for (const locale of locales) {
		const messages = flatten(load(locale));

		it(`${locale} has every adminDeviceLabels key from en, with the same placeholders`, () => {
			const enKeys = Object.keys(en).filter(
				(k) => sections.some((s) => k.startsWith(`${s}.`)) && !k.startsWith(STICKER),
			);
			expect(enKeys.length).toBeGreaterThan(10);
			for (const key of enKeys) {
				expect(messages[key], `${locale} is missing ${key}`).toBeTruthy();
				expect(placeholders(messages[key]), `${locale} placeholders differ for ${key}`).toEqual(
					placeholders(en[key]),
				);
			}
		});

		it(`${locale} has the print-label strings in adminDevices`, () => {
			for (const key of deviceKeys) {
				expect(
					messages[`dashboard.adminDevices.${key}`],
					`${locale} is missing ${key}`,
				).toBeTruthy();
			}
		});
	}
});

describe("the sticker text is English only", () => {
	it("has no translated copy outside en", () => {
		const en = flatten(load("en"));
		expect(Object.keys(en).filter((k) => k.startsWith(STICKER)).length).toBeGreaterThan(15);
		for (const locale of locales.filter((l) => l !== "en")) {
			const keys = Object.keys(flatten(load(locale)));
			expect(keys.filter((k) => k.startsWith(STICKER))).toEqual([]);
		}
	});

	it("is always rendered from the en messages, whatever locale the page is in", () => {
		const page = readFileSync(
			join(__dirname, "../../app/[locale]/(print)/admin/devices/labels/page.tsx"),
			"utf8",
		);
		expect(page).toMatch(/locale: "en",\s*namespace: "dashboard\.adminDeviceLabels\.sticker"/);
	});
});
