#!/usr/bin/env node
/**
 * Render the Mermaid sources in docs/diagrams/ to the committed PNGs.
 *
 * Rendering goes through mermaid.ink, which needs no local toolchain (no
 * headless browser, no puppeteer install). The diagram sources stay the source
 * of truth; the PNGs are a convenience artefact for documents and slide decks.
 *
 * Usage:
 *   node scripts/render-diagrams.mjs            # render every figure
 *   node scripts/render-diagrams.mjs 05         # render one figure by number
 *
 * Requires network access. Any HTTP failure fails the script with a non-zero
 * exit code, so a broken diagram never lands silently.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** Figure number -> { source, output }. */
const FIGURES = {
	"01": {
		source: "docs/diagrams/01-use-case-user.mmd",
		output: "docs/diagrams/figure-3.1-use-case-user.png",
	},
	"02": {
		source: "docs/diagrams/02-use-case-system.mmd",
		output: "docs/diagrams/figure-3.2-use-case-system.png",
	},
	"03": {
		source: "docs/diagrams/03-activity-hardware.mmd",
		output: "docs/diagrams/figure-3.3-activity-hardware.png",
	},
	"04": {
		source: "docs/diagrams/04-sequence.mmd",
		output: "docs/diagrams/figure-3.4-sequence.png",
	},
	"05": {
		source: "docs/diagrams/05-circuit.mmd",
		output: "docs/diagrams/figure-3.5-circuit.png",
	},
};

function toBase64Url(source) {
	return Buffer.from(source, "utf8")
		.toString("base64")
		.replace(/=+$/, "")
		.replace(/\+/g, "-")
		.replace(/\//g, "_");
}

const requested = process.argv.slice(2);
const keys = requested.length > 0 ? requested : Object.keys(FIGURES);

for (const key of keys) {
	const figure = FIGURES[key];
	if (!figure) {
		console.error(`unknown figure "${key}" - expected one of ${Object.keys(FIGURES).join(", ")}`);
		process.exit(1);
	}

	const source = readFileSync(join(root, figure.source), "utf8");
	const url = `https://mermaid.ink/img/${toBase64Url(source)}?type=png`;

	const response = await fetch(url);
	if (!response.ok) {
		throw new Error(`${figure.source}: mermaid.ink returned HTTP ${response.status}`);
	}

	const bytes = Buffer.from(await response.arrayBuffer());
	if (bytes.length < 1000) {
		throw new Error(`${figure.source}: mermaid.ink returned only ${bytes.length} bytes`);
	}

	writeFileSync(join(root, figure.output), bytes);
	console.log(`${figure.output}: ${bytes.length} bytes`);
}
