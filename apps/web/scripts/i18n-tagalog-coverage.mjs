#!/usr/bin/env node
/**
 * Tagalog coverage report (#457).
 *
 * Prints one line summarising how much of the Tagalog catalogue is
 * human-reviewed versus still a machine draft, then exits 0 — always. This is a
 * report, not a gate: the locale ships key-complete with an English fallback,
 * and blocking CI on translation progress would only encourage fake reviews.
 *
 * Numbers are derived at read time from the catalogues themselves, so they
 * never go stale:
 *   - `en.json` key count is the target,
 *   - `tl.json` keys missing from `en.json` are reported separately (a tl-only
 *     key is dead weight, but not something this report fails on),
 *   - `tl.draft-keys.json` is the review queue; reviewed = present-in-en − draft.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const messagesDir = join(dirname(fileURLToPath(import.meta.url)), "..", "messages");

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

try {
	const en = flatten(readJson("en.json"));
	const tl = flatten(readJson("tl.json"));
	const drafts = readJson("tl.draft-keys.json");

	const enKeys = new Set(Object.keys(en));
	const draftKeys = new Set(Array.isArray(drafts.draftKeys) ? drafts.draftKeys : []);

	const translated = Object.keys(tl).filter((key) => enKeys.has(key));
	const reviewed = translated.filter((key) => !draftKeys.has(key)).length;
	const translatedPct = ((translated.length / enKeys.size) * 100).toFixed(1);
	const reviewedPct = ((reviewed / enKeys.size) * 100).toFixed(1);
	const tlOnly = Object.keys(tl).filter((key) => !enKeys.has(key)).length;

	const parts = [
		`Tagalog (tl) coverage: ${reviewed}/${enKeys.size} keys reviewed (${reviewedPct}%)`,
		`${translated.length} translated (${translatedPct}%), ${draftKeys.size} machine drafts pending human review`,
	];
	if (tlOnly > 0) parts.push(`${tlOnly} tl-only keys not in en`);

	console.log(parts.join(" — "));
} catch (error) {
	// A missing or malformed catalogue is worth knowing about, but this report
	// must never break the build; parity tests own the hard failures.
	console.log(
		`Tagalog (tl) coverage: unavailable (${error instanceof Error ? error.message : String(error)})`,
	);
}

process.exit(0);
