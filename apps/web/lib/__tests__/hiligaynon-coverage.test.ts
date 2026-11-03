import { readFileSync } from "node:fs";
import { join } from "node:path";
import { isBetaLocale } from "@/lib/i18n/locales";
import { describe, expect, it } from "vitest";

/**
 * #762 — Hiligaynon shipped as a complete locale while 141 of the 220 landing
 * values were byte-identical English. The locale is now labelled Beta; this
 * gate stops the untranslated debt from growing while the copy is reviewed.
 *
 * The ceiling is a ratchet: lower it as translations land, never raise it
 * without a reviewed plan.
 */

const MAX_IDENTICAL_LANDING_KEYS = 141;

const messagesDir = join(__dirname, "../../messages");

type Tree = { [key: string]: string | Tree };

function flatten(tree: Tree, prefix = "", out: Record<string, string> = {}) {
	for (const [key, value] of Object.entries(tree)) {
		const path = prefix ? `${prefix}.${key}` : key;
		if (typeof value === "string") out[path] = value;
		else flatten(value, path, out);
	}
	return out;
}

const en = flatten(JSON.parse(readFileSync(join(messagesDir, "en.json"), "utf8")) as Tree);
const hil = flatten(JSON.parse(readFileSync(join(messagesDir, "hil.json"), "utf8")) as Tree);
const landingKeys = Object.keys(en).filter((key) => key.startsWith("landing."));
const identical = landingKeys.filter((key) => hil[key] === en[key]);

describe("Hiligaynon landing coverage (#762)", () => {
	it("does not add untranslated landing strings beyond the recorded ceiling", () => {
		expect(landingKeys.length).toBeGreaterThan(0);
		expect(
			identical.length,
			`untranslated landing keys: ${identical.slice(0, 10).join(", ")}${identical.length > 10 ? "…" : ""}`,
		).toBeLessThanOrEqual(MAX_IDENTICAL_LANDING_KEYS);
	});

	it("marks Hiligaynon as a partial locale in the switcher metadata", () => {
		expect(isBetaLocale("hil")).toBe(true);
		expect(isBetaLocale("tl")).toBe(true);
		expect(isBetaLocale("en")).toBe(false);
	});
});
