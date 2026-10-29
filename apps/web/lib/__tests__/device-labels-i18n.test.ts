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
// The sticker sheet is a physical label printed in English (see the last test),
// but its strings live in the catalogue like every other key, so the catalogue
// itself must stay in parity across locales (ISO 25010 W9, issue #327).
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

describe("the printed sticker is English whatever the locale", () => {
	it("carries the sticker keys in every locale instead of leaving a gap", () => {
		const en = flatten(load("en"));
		const enKeys = Object.keys(en)
			.filter((key) => key.startsWith(STICKER))
			.sort();
		expect(enKeys.length).toBeGreaterThan(15);

		for (const locale of locales) {
			const keys = Object.keys(flatten(load(locale)))
				.filter((key) => key.startsWith(STICKER))
				.sort();
			expect(keys, `${locale} is missing sticker keys`).toEqual(enKeys);
		}
	});

	it("is always rendered from the en messages, whatever locale the page is in", () => {
		const page = readFileSync(
			join(__dirname, "../../components/admin/device-label-sheet.tsx"),
			"utf8",
		);
		expect(page).toMatch(/locale: "en",\s*namespace: "dashboard\.adminDeviceLabels\.sticker"/);
	});
});
