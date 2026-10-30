#!/usr/bin/env node
/**
 * Print GitHub Release notes for one version, taken from CHANGELOG.md.
 *
 * Usage: node scripts/release-notes.mjs 1.23.0
 *
 * The notes are the changelog section for that version, verbatim, so the
 * release body and the repository can never disagree.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const version = process.argv[2];

if (!version || !/^\d+\.\d+\.\d+$/.test(version)) {
	console.error("usage: node scripts/release-notes.mjs <major.minor.patch>");
	process.exit(1);
}

const changelogPath = fileURLToPath(new URL("../CHANGELOG.md", import.meta.url));
const lines = readFileSync(changelogPath, "utf8").split(/\r?\n/);

const start = lines.findIndex((line) => line.startsWith(`## [${version}]`));
if (start === -1) {
	console.error(`release-notes: CHANGELOG.md has no '## [${version}]' section`);
	process.exit(1);
}

let end = lines.length;
for (let i = start + 1; i < lines.length; i += 1) {
	if (lines[i].startsWith("## [")) {
		end = i;
		break;
	}
}

const body = lines.slice(start, end).join("\n").trim();
const repo = process.env.GITHUB_REPOSITORY;
const history = repo
	? `Full history: [\`CHANGELOG.md\`](https://github.com/${repo}/blob/main/CHANGELOG.md).`
	: "Full history: `CHANGELOG.md`.";

process.stdout.write(`# OptiFeed v${version}\n\n${body}\n\n---\n\n${history}\n`);
