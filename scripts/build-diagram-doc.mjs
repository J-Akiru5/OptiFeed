#!/usr/bin/env node
/**
 * Build docs/multi-tenancy-system-diagrams.md from the prose template and the
 * Mermaid sources in docs/diagrams/.
 *
 * The template carries `<!--FIG:NN-->` tokens; each token is replaced by a
 * fenced mermaid block containing the matching .mmd file verbatim. The document
 * therefore can never drift from the diagram sources.
 *
 * Usage: node scripts/build-diagram-doc.mjs
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const TEMPLATE = join(root, "scripts/templates/multi-tenancy-system-diagrams.md");
const OUTPUT = join(root, "docs/multi-tenancy-system-diagrams.md");

/** Figure token -> Mermaid source, in document order. */
const FIGURES = [
	["01", "docs/diagrams/01-use-case-user.mmd"],
	["02", "docs/diagrams/02-use-case-system.mmd"],
	["03", "docs/diagrams/03-activity-hardware.mmd"],
	["04", "docs/diagrams/04-sequence.mmd"],
	["05", "docs/diagrams/05-circuit.mmd"],
];

/**
 * Strip the Mermaid YAML frontmatter. The figure title lives in the markdown
 * heading, so the frontmatter would only duplicate it in the rendered block.
 */
function stripFrontmatter(source) {
	return source.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, "").trimEnd();
}

let doc = readFileSync(TEMPLATE, "utf8");

for (const [token, relativePath] of FIGURES) {
	const marker = `<!--FIG:${token}-->`;
	if (!doc.includes(marker)) {
		throw new Error(`template is missing the marker ${marker}`);
	}
	const mermaid = stripFrontmatter(readFileSync(join(root, relativePath), "utf8"));
	doc = doc.replace(marker, ["```mermaid", mermaid, "```"].join("\n"));
}

const leftovers = doc.match(/<!--FIG:\d+-->/g);
if (leftovers) {
	throw new Error(`unreplaced figure markers remain: ${leftovers.join(", ")}`);
}

writeFileSync(OUTPUT, doc, "utf8");
console.log(
	`wrote ${OUTPUT.replace(`${root}/`, "")} (${doc.length} bytes, ${doc.split("\n").length} lines)`,
);
