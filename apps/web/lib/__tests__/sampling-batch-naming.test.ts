import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadMessages } from "./helpers/messages";

/**
 * #200 / E19: the biomass-domain entity is a "sampling batch" in every
 * user-facing string.
 *
 * Machine identifiers are deliberately unchanged: the `batchLabel` column, the
 * `/dashboard/log-sample/batches` route, the `batchLabel` CSV export header and
 * the `data-help="biomass-batches"` anchor. This guard covers message *values*
 * and the two surfaces that still hard-code their copy (the log form and the
 * offline shell).
 */

/** A "batch"/"batches" that is not preceded by "sampling". */
const BARE_BATCH = /(?<!sampling )\bbatch(?:es)?\b/i;

/**
 * Values where "batch" legitimately means something else (a bulk export, an
 * ORM batch, …). Empty today; a future exception must name the message key and
 * the test below keeps the list honest.
 */
const ALLOWED_KEYS = new Set<string>([]);

/** The keys that carry the entity's own label, in English. */
const EXPECTED_ENGLISH: Record<string, string> = {
	"dashboard.logSample.batchLabel": "Sampling batch",
	"dashboard.logSample.savedBatches": "Saved sampling batches",
	"dashboard.logSample.batchesLabel": "Saved sampling batches",
	"dashboard.logSample.unlabeled": "No sampling batch",
	"dashboard.logSample.noBatchesTitle": "No saved sampling batches yet",
	"dashboard.growth.batchCol": "Sampling batch",
	"dashboard.growth.batchFilterLabel": "Filter by sampling batch",
	"dashboard.growth.allBatches": "All sampling batches",
};

function bareBatchOffenders(locale: "en" | "hil"): string[] {
	const messages = loadMessages(locale);
	return Object.entries(messages)
		.filter(([key, value]) => !ALLOWED_KEYS.has(key) && BARE_BATCH.test(value.trim()) === true)
		.map(([key, value]) => `${key}: ${value}`);
}

describe("sampling batch naming (#200)", () => {
	it("keeps English message values free of a bare Batch/Batches", () => {
		expect(bareBatchOffenders("en")).toEqual([]);
	});

	it("uses the agreed Hiligaynon draft term and no bare Batch/Batches", () => {
		expect(bareBatchOffenders("hil")).toEqual([]);

		const hil = loadMessages("hil");
		for (const key of Object.keys(EXPECTED_ENGLISH)) {
			expect(hil[key]?.toLowerCase(), `hil.${key} should contain the draft term`).toContain(
				"sampling batch",
			);
		}
	});

	it("labels the entity consistently in English", () => {
		const en = loadMessages("en");
		for (const [key, value] of Object.entries(EXPECTED_ENGLISH)) {
			expect(en[key], `en is missing ${key}`).toBe(value);
		}
	});

	it("keeps the allow-list free of stale or missing keys", () => {
		const en = loadMessages("en");
		for (const key of ALLOWED_KEYS) {
			expect(en[key], `allow-listed key ${key} no longer exists`).toBeTruthy();
		}
	});

	it("removes the hard-coded Batch copy from the log form and offline shell", () => {
		const webRoot = join(__dirname, "../..");
		const files: Array<[string, string[]]> = [
			[
				join(webRoot, "components/LogSampleForm.tsx"),
				["Batch (optional)", "e.g. Batch", "(no batch)"],
			],
			[join(webRoot, "public/offline.html"), ["<th>Batch</th>", ">Batch label<"]],
		];

		for (const [file, retired] of files) {
			const content = readFileSync(file, "utf8");
			for (const literal of retired) {
				expect(content.includes(literal), `${file} still contains "${literal}"`).toBe(false);
			}
		}
	});
});
