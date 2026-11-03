#!/usr/bin/env node
/**
 * Hiligaynon landing coverage (#762).
 *
 * `hil.json` is key-complete but 141 of the 220 `landing.*` values were still
 * byte-identical English when this check was added, including whole sections and
 * the `/hil/privacy` heading. The locale therefore carries a Beta badge.
 *
 * This gate does not demand a finished translation — it stops the debt from
 * growing while the copy is reviewed: the identical count may stay at or below
 * the recorded ceiling and must only move down. `hiligaynon-coverage.test.ts`
 * enforces the same ceiling in CI; this script is the local report.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const messagesDir = join(dirname(fileURLToPath(import.meta.url)), "..", "messages");

/** Lower this as translations land; never raise it. */
const MAX_IDENTICAL_LANDING_KEYS = 141;

function readJson(name) {
	return JSON.parse(readFileSync(join(messagesDir, name), "utf8"));
}

function flatten(tree, prefix = "", out = {}) {
	for (const [key, value] of Object.entries(tree)) {
		const path = prefix ? `${prefix}.${key}` : key;
		if (typeof value === "string") out[path] = value;
		else if (value && typeof value === "object") flatten(value, path, out);
	}
	return out;
}

const en = flatten(readJson("en.json"));
const hil = flatten(readJson("hil.json"));
const landingKeys = Object.keys(en).filter((key) => key.startsWith("landing."));
const identical = landingKeys.filter((key) => hil[key] === en[key]);
const translated = landingKeys.length - identical.length;
const pct = ((translated / landingKeys.length) * 100).toFixed(1);

const summary = `Hiligaynon (hil) landing coverage: ${translated}/${landingKeys.length} translated (${pct}%); ${identical.length} still identical to English (ceiling ${MAX_IDENTICAL_LANDING_KEYS})`;

if (identical.length > MAX_IDENTICAL_LANDING_KEYS) {
	console.error(
		`${summary}\nNew untranslated landing strings were added. Translate them or raise the ceiling only with a reviewed plan.`,
	);
	process.exit(1);
}

console.log(summary);
