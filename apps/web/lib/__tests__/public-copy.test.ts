import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { NPC_ADDRESS } from "@/lib/legal/config";
import { describe, expect, it } from "vitest";

/**
 * Public copy regressions from the release QA pass (#761).
 *
 * The landing hardware label rendered a literal `?` placeholder, the NPC
 * address carried mojibake around `25th`/`27th`, and an unknown public URL fell
 * through to Next.js's unbranded English 404. The copy checks read the shipped
 * catalogues; the 404 check pins the locale-aware boundary and its way home.
 */

const webRoot = join(__dirname, "../..");
const messagesDir = join(webRoot, "messages");

type Tree = { [key: string]: string | Tree };

function load(locale: "en" | "hil" | "tl"): Tree {
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

const MOJIBAKE = /[\u00C2\u00C3\uFFFD]|â€/;

describe("public copy (#761)", () => {
	it("uses a clean en dash in every locale's feeder model label", () => {
		for (const locale of ["en", "hil", "tl"] as const) {
			const value = flatten(load(locale))["landing.feederModelLabel"];
			expect(value, `${locale} feederModelLabel is missing`).toBeTruthy();
			expect(value).toContain("–");
			expect(value).not.toContain("?");
		}
	});

	it("has no mojibake or replacement characters in any catalogue value", () => {
		for (const locale of ["en", "hil", "tl"] as const) {
			for (const [key, value] of Object.entries(flatten(load(locale)))) {
				expect(MOJIBAKE.test(value), `${locale}.json ${key}: ${value}`).toBe(false);
			}
		}
	});

	it("renders a clean NPC address", () => {
		expect(NPC_ADDRESS).toContain("25th–27th");
		expect(NPC_ADDRESS).not.toContain("?");
		expect(MOJIBAKE.test(NPC_ADDRESS), NPC_ADDRESS).toBe(false);
	});

	it("ships a localized, branded 404 with a way home", () => {
		const notFoundFile = join(webRoot, "app/[locale]/not-found.tsx");
		expect(existsSync(notFoundFile), "app/[locale]/not-found.tsx is missing").toBe(true);

		const source = readFileSync(notFoundFile, "utf8");
		expect(source).toContain('getTranslations("errors")');
		expect(source).toContain('getTranslations("button")');
		expect(source).toContain("notFoundTitle");
		expect(source).toContain("notFoundDesc");
		expect(source).toContain("backToHome");
		// The only destination is the locale home page; the i18n Link adds the
		// current locale itself.
		expect(source).toMatch(/href="\/"/);
	});
});
