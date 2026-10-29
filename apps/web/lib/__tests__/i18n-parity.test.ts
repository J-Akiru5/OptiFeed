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
 * Tagalog is deliberately **not** held to the same bar. `tl` is an overlay:
 * `request.ts` merges `tl.json` on top of `en.json`, so a missing Tagalog key
 * falls back to English by design. It is 9% complete (307/3,320 keys) and the
 * owner is deciding between finishing it, declaring it beta and removing it —
 * issue #327. This file records that state instead of pretending it passes a
 * gate that does not exist.
 */

const messagesDir = join(__dirname, "../../messages");

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

/** ICU arguments, ignoring plural braces so `{count, plural, ...}` yields `count`. */
function placeholders(message: string): string[] {
	return [...message.matchAll(/\{(\w+)/g)].map((match) => match[1]).sort();
}

const en = flatten(load("en"));
const hil = flatten(load("hil"));
const tl = flatten(load("tl"));

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

describe("Tagalog is an overlay, reported not gated (#327)", () => {
	it("only carries keys that exist in en, so it can never shadow a missing message", () => {
		const orphans = Object.keys(tl).filter((key) => !(key in en));
		expect(orphans).toEqual([]);
	});

	it("is merged on top of en by the request config", () => {
		const request = readFileSync(join(__dirname, "../../i18n/request.ts"), "utf8");
		expect(request).toMatch(/locale === "tl"/);
		expect(request).toMatch(/mergeMessages\(\s*english\.default/);
		expect(request).toMatch(/tagalog\.default/);
	});

	it("reports its measured completeness so the gap stays visible in CI", () => {
		const translated = Object.keys(tl).filter((key) => key in en).length;
		const percentage = ((translated / enKeys.length) * 100).toFixed(1);
		// Not an assertion on the number: the owner decides whether tl is
		// completed, declared beta or removed (#327). This line is the evidence.
		console.info(
			`[i18n] Tagalog overlay: ${translated}/${enKeys.length} keys (${percentage}%). Missing keys fall back to English by design; see issue #327.`,
		);
		expect(translated).toBeGreaterThan(0);
		expect(translated).toBeLessThanOrEqual(enKeys.length);
	});
});
