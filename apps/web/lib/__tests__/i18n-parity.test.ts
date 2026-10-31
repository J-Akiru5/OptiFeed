import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Locale catalogue parity (ISO 25010 usability / W9).
 *
 * `en` and `hil` are **standalone** catalogues: `i18n/request.ts` loads
 * `messages/<locale>.json` directly for both, with no English fallback. A key
 * that exists only in `en` therefore reaches a Hiligaynon reader as the raw
 * dotted key (`dashboard.adminDeviceLabels.sticker.subtitle`) or, where
 * next-intl throws on a missing message, as a crash. Parity is not cosmetic —
 * it is the difference between a translated screen and a broken one.
 *
 * Tagalog (`tl`) is an overlay merged over `en` at request time, but it is now
 * complete (#327, I-104): the same key set, placeholders, plural branches and
 * rich-text tags as English. It is still allowed to fall back to English for a
 * key added after this test was last updated; `tagalog-locale.test.ts` covers
 * that runtime fallback. Machine-drafted keys are tracked in
 * `messages/tl.draft-keys.json` until a human clears them.
 */

const messagesDir = join(__dirname, "../../messages");

type Tree = { [key: string]: string | Tree };

type DraftManifest = {
	locale: string;
	method: string;
	generatedAt: string;
	reviewedBaseline: number;
	draftKeys: string[];
};

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

/** ICU arguments, ignoring plural branch braces like `=0 {No …}`. */
function placeholders(message: string): string[] {
	return [...message.matchAll(/\{(\w+)\s*[,}]/g)].map((match) => match[1]).sort();
}

/** ICU plural categories and explicit selectors present in a message. */
function pluralBranches(message: string): string[] {
	return [...message.matchAll(/\b(zero|one|two|few|many|other|=\d+)\s*\{/g)]
		.map((match) => match[1])
		.sort();
}

/** Rich-text tags such as `<bold>`, `</bold>`, `<highlight>`, `<br />`. */
function richTextTags(message: string): string[] {
	return [...message.matchAll(/<[^>]+>/g)].map((match) => match[0]).sort();
}

const en = flatten(load("en"));
const hil = flatten(load("hil"));
const tl = flatten(load("tl"));
const drafts: DraftManifest = JSON.parse(
	readFileSync(join(messagesDir, "tl.draft-keys.json"), "utf8"),
);

const enKeys = Object.keys(en).sort();

describe("en ↔ hil key parity", () => {
	it("has exactly the same key set in both standalone catalogues", () => {
		const hilKeys = Object.keys(hil).sort();

		// Reported separately so a failure names the missing keys instead of
		// dumping two 3,000-entry arrays at the reader.
		const missingInHil = enKeys.filter((key) => !(key in hil));
		const extraInHil = hilKeys.filter((key) => !(key in en));

		expect(missingInHil, `keys missing from hil: ${missingInHil.join(", ")}`).toEqual([]);
		expect(extraInHil, `keys only in hil: ${extraInHil.join(", ")}`).toEqual([]);
		expect(hilKeys).toEqual(enKeys);
	});

	it("uses the same ICU placeholders for every key", () => {
		for (const key of enKeys) {
			expect(placeholders(hil[key] ?? ""), `placeholders differ for ${key}`).toEqual(
				placeholders(en[key]),
			);
		}
	});

	it("has no blank Hiligaynon string standing in for a translation", () => {
		const blanks = Object.entries(hil)
			.filter(([, value]) => value.trim().length === 0)
			.map(([key]) => key);
		expect(blanks).toEqual([]);
	});
});

describe("en ↔ tl key parity (#327)", () => {
	it("has exactly the same key set in both catalogues", () => {
		const tlKeys = Object.keys(tl).sort();
		const missingInTl = enKeys.filter((key) => !(key in tl));
		const extraInTl = tlKeys.filter((key) => !(key in en));

		expect(missingInTl, `keys missing from tl: ${missingInTl.join(", ")}`).toEqual([]);
		expect(extraInTl, `keys only in tl: ${extraInTl.join(", ")}`).toEqual([]);
		expect(tlKeys).toEqual(enKeys);
	});

	it("uses the same ICU placeholders for every key", () => {
		for (const key of enKeys) {
			expect(placeholders(tl[key] ?? ""), `placeholders differ for ${key}`).toEqual(
				placeholders(en[key]),
			);
		}
	});

	it("keeps both ICU plural branches for every plural message", () => {
		const pluralKeys = enKeys.filter((key) => en[key].includes("plural"));
		expect(pluralKeys.length).toBeGreaterThan(0);

		for (const key of pluralKeys) {
			expect(pluralBranches(tl[key] ?? ""), `plural branches differ for ${key}`).toEqual(
				pluralBranches(en[key]),
			);
		}
	});

	it("keeps every rich-text tag in the same order", () => {
		for (const key of enKeys) {
			expect(richTextTags(tl[key] ?? ""), `rich-text tags differ for ${key}`).toEqual(
				richTextTags(en[key]),
			);
		}
	});

	it("has no blank Tagalog string standing in for a translation", () => {
		const blanks = Object.entries(tl)
			.filter(([, value]) => value.trim().length === 0)
			.map(([key]) => key);
		expect(blanks).toEqual([]);
	});

	it("supplies every CLDR plural category Tagalog selects", () => {
		// Tagalog has two cardinal categories, `one` and `other`; `one` covers
		// 0-3, 5, 7, 8, 10, 11… and `other` covers 4, 6, 9, 14, 16, 19…
		const required = new Intl.PluralRules("tl").resolvedOptions().pluralCategories;
		expect(required).toEqual(["one", "other"]);

		for (const key of enKeys.filter((key) => en[key].includes("plural"))) {
			const branches = new Set(pluralBranches(tl[key] ?? ""));
			for (const category of required) {
				expect(branches.has(category), `${key} is missing the ${category} branch`).toBe(true);
			}
		}
	});
});

describe("Tagalog draft review queue (#327)", () => {
	it("lists every machine-drafted key exactly once", () => {
		expect(drafts.locale).toBe("tl");
		expect(Array.isArray(drafts.draftKeys)).toBe(true);
		expect(new Set(drafts.draftKeys).size).toBe(drafts.draftKeys.length);
		expect([...drafts.draftKeys].sort()).toEqual(drafts.draftKeys);
	});

	it("marks only keys that exist in both catalogues", () => {
		const unknown = drafts.draftKeys.filter((key) => !(key in en) || !(key in tl));
		expect(unknown, `draft keys missing from en/tl: ${unknown.join(", ")}`).toEqual([]);
	});

	it("keeps the human-reviewed core out of the draft queue", () => {
		// The 331 keys shipped before the machine pass are human-reviewed and
		// must never be re-flagged; everything else is waiting for review.
		// `reviewedBaseline` is a floor, so clearing a key only means removing
		// it from `draftKeys` — the count below does not need editing.
		const draftSet = new Set(drafts.draftKeys);
		const reviewed = Object.keys(tl).filter((key) => !draftSet.has(key));
		expect(reviewed.length).toBeGreaterThanOrEqual(drafts.reviewedBaseline);
		expect(drafts.reviewedBaseline).toBe(331);
	});
});
