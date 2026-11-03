#!/usr/bin/env node
/**
 * Security-override gate.
 *
 * pnpm 10 no longer reads `pnpm.overrides` from package.json; the overrides
 * live in pnpm-workspace.yaml. That move is only useful if the pins stay
 * active, so this check fails when:
 *
 *   1. package.json still declares a `pnpm` field (the ignored location);
 *   2. pnpm-workspace.yaml does not declare the expected security overrides;
 *   3. pnpm-lock.yaml does not record the same overrides (a mismatch makes
 *      `pnpm install --frozen-lockfile` reject the tree);
 *   4. a resolved version of a security-relevant package is below the floor
 *      the override was added for, or outside the major line it replaces.
 *
 * The lockfile is parsed directly: it is the only resolution record that
 * exists before `node_modules`, and reading it keeps the check fast and
 * install-free. No new dependency is used.
 *
 * Exit codes: 0 pass, 1 a pin regressed, 2 the check could not read its input.
 *
 * Usage:
 *   node scripts/security/check-overrides.mjs
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const MANIFEST_PATH = join(repoRoot, "package.json");
const WORKSPACE_PATH = join(repoRoot, "pnpm-workspace.yaml");
const LOCKFILE_PATH = join(repoRoot, "pnpm-lock.yaml");

/**
 * The overrides this repository depends on for security fixes. Keys and values
 * are exactly what pnpm-workspace.yaml and pnpm-lock.yaml must contain.
 */
const EXPECTED_OVERRIDES = new Map([
	["baseline-browser-mapping", "^2.11.0"],
	["browserslist", "^4.28.7"],
	["dompurify", "^3.4.17"],
	["proxy-addr", "^2.0.8"],
	["source-map-js", "^1.2.2"],
	["exceljs>uuid", "11.1.1"],
	["uuid@^8.3.0", "11.1.1"],
	["minimatch@^3.0.4", "3.1.5"],
	["minimatch@^3.1.0", "3.1.5"],
]);

/**
 * What "still pinned" means for each package. `floor` is the lowest secure
 * version; `exactForMajor` pins a major line that the override replaces
 * wholesale (minimatch 3.x -> 3.1.5).
 */
const TARGETS = [
	{ name: "dompurify", floor: "3.4.17" },
	{ name: "minimatch", floor: "3.1.5", exactForMajor: { 3: "3.1.5" } },
	{ name: "uuid", floor: "11.1.1", required: true },
	{ name: "browserslist", floor: "4.28.7" },
	{ name: "proxy-addr", floor: "2.0.8" },
	{ name: "source-map-js", floor: "1.2.2" },
	{ name: "baseline-browser-mapping", floor: "2.11.0" },
];

function fail(message) {
	console.error(`check-overrides: ${message}`);
	process.exit(2);
}

function readText(path, label) {
	if (!existsSync(path)) fail(`${label} not found at ${path}`);
	try {
		return readFileSync(path, "utf8");
	} catch (error) {
		fail(`could not read ${label}: ${error.message}`);
	}
}

function unquote(value) {
	return value.replace(/^['"]/, "").replace(/['"]$/, "");
}

/**
 * Read a two-space-indented map that sits directly under a top-level key.
 * Both pnpm-workspace.yaml and pnpm-lock.yaml use this shape for `overrides`.
 */
function readTopLevelMap(text, key) {
	const entries = new Map();
	let inSection = false;

	for (const line of text.split(/\r?\n/)) {
		if (/^\S/.test(line)) {
			inSection = new RegExp(`^${key}:\\s*(?:#.*)?$`).test(line);
			continue;
		}
		if (!inSection || line.trim() === "" || line.trimStart().startsWith("#")) continue;

		const match = /^\s+([^:#]+):\s*(.*?)\s*(?:#.*)?$/.exec(line);
		if (!match) continue;

		const name = unquote(match[1].trim());
		const value = unquote(match[2].trim());
		if (name && value) entries.set(name, value);
	}

	return entries;
}

/** Collect every package@version pair recorded in the lockfile. */
function readResolvedVersions(text) {
	const versions = new Map();
	let inPackages = false;

	for (const line of text.split(/\r?\n/)) {
		if (/^\S/.test(line)) {
			inPackages = line === "packages:" || line === "snapshots:";
			continue;
		}
		if (!inPackages) continue;

		// Keys look like `dompurify@3.4.17:`, `'@scope/name@1.0.0':` or
		// `next@16.4.2(react@19.2.4):`; the peer suffix is not part of the version.
		const match = /^ {2}'?((?:@[^/']+\/)?[^@']+)@([^:'(]+)(?:\([^']*\))?'?:$/.exec(line);
		if (!match) continue;

		const name = match[1];
		const version = match[2];
		if (!versions.has(name)) versions.set(name, new Set());
		versions.get(name).add(version);
	}

	return versions;
}

function parseVersion(value) {
	const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(value);
	if (!match) return null;
	return {
		major: Number(match[1]),
		minor: Number(match[2]),
		patch: Number(match[3]),
		prerelease: match[4] ?? null,
	};
}

/** SemVer precedence, including prerelease ordering. */
function compareVersions(left, right) {
	for (const part of ["major", "minor", "patch"]) {
		const difference = left[part] - right[part];
		if (difference !== 0) return difference < 0 ? -1 : 1;
	}

	if (left.prerelease === right.prerelease) return 0;
	if (left.prerelease === null) return 1;
	if (right.prerelease === null) return -1;

	const leftParts = left.prerelease.split(".");
	const rightParts = right.prerelease.split(".");
	const length = Math.max(leftParts.length, rightParts.length);

	for (let index = 0; index < length; index += 1) {
		const leftPart = leftParts[index];
		const rightPart = rightParts[index];
		if (leftPart === undefined) return -1;
		if (rightPart === undefined) return 1;

		const leftNumeric = /^\d+$/.test(leftPart);
		const rightNumeric = /^\d+$/.test(rightPart);
		if (leftNumeric && rightNumeric) {
			const difference = Number(leftPart) - Number(rightPart);
			if (difference !== 0) return difference < 0 ? -1 : 1;
		} else if (leftNumeric) {
			return -1;
		} else if (rightNumeric) {
			return 1;
		} else if (leftPart !== rightPart) {
			return leftPart < rightPart ? -1 : 1;
		}
	}

	return 0;
}

function sortVersions(versions) {
	return versions.sort((left, right) => {
		const leftParsed = parseVersion(left);
		const rightParsed = parseVersion(right);
		if (!leftParsed || !rightParsed) return left.localeCompare(right);
		return compareVersions(leftParsed, rightParsed);
	});
}

function describeTarget(target) {
	const parts = [];
	if (target.floor) parts.push(`>= ${target.floor}`);
	if (target.exactForMajor) {
		for (const [major, version] of Object.entries(target.exactForMajor)) {
			parts.push(`major ${major} = ${version}`);
		}
	}
	if (target.required) parts.push("must stay installed");
	return parts.join(", ");
}

function compareOverrides(label, actual, problems) {
	for (const [key, value] of EXPECTED_OVERRIDES) {
		const found = actual.get(key);
		if (found === undefined) {
			problems.push(`${label} is missing the override "${key}: ${value}"`);
		} else if (found !== value) {
			problems.push(`${label} has "${key}: ${found}", expected "${key}: ${value}"`);
		}
	}
}

function appendStepSummary(markdown) {
	const path = process.env.GITHUB_STEP_SUMMARY;
	if (!path) return;
	try {
		writeFileSync(path, markdown, { flag: "a" });
	} catch {
		// A summary failure must never change the gate result.
	}
}

/* -------------------------------------------------------------------- main */

const manifestText = readText(MANIFEST_PATH, "package.json");
const workspaceText = readText(WORKSPACE_PATH, "pnpm-workspace.yaml");
const lockfileText = readText(LOCKFILE_PATH, "pnpm-lock.yaml");

let manifest;
try {
	manifest = JSON.parse(manifestText);
} catch (error) {
	fail(`package.json is not valid JSON: ${error.message}`);
}

const problems = [];

if (Object.hasOwn(manifest, "pnpm")) {
	problems.push(
		"package.json still declares a `pnpm` field; pnpm 10 ignores it. " +
			"Move dependency overrides to pnpm-workspace.yaml.",
	);
}

compareOverrides("pnpm-workspace.yaml", readTopLevelMap(workspaceText, "overrides"), problems);
compareOverrides("pnpm-lock.yaml", readTopLevelMap(lockfileText, "overrides"), problems);

const resolved = readResolvedVersions(lockfileText);
const rows = [];

for (const target of TARGETS) {
	const versions = sortVersions([...(resolved.get(target.name) ?? [])]);
	const rule = describeTarget(target);

	if (versions.length === 0) {
		if (target.required) {
			problems.push(
				`no resolved ${target.name}; the override no longer has a target. Remove the override and this check together.`,
			);
		}
		rows.push({ name: target.name, versions: "(not installed)", rule, state: "OK" });
		continue;
	}

	let state = "OK";
	for (const version of versions) {
		const parsed = parseVersion(version);
		if (!parsed) {
			problems.push(`${target.name}@${version}: unparseable version in pnpm-lock.yaml`);
			state = "FAIL";
			continue;
		}

		if (target.exactForMajor?.[parsed.major] !== undefined) {
			const pinned = target.exactForMajor[parsed.major];
			if (version !== pinned) {
				problems.push(
					`${target.name}@${version} does not match the ${pinned} pin for major ${parsed.major}`,
				);
				state = "FAIL";
			}
		}

		if (target.floor) {
			const floor = parseVersion(target.floor);
			if (compareVersions(parsed, floor) < 0) {
				problems.push(`${target.name}@${version} is below the ${target.floor} floor`);
				state = "FAIL";
			}
		}
	}

	rows.push({ name: target.name, versions: versions.join(", "), rule, state });
}

const nameWidth = Math.max(...rows.map((row) => row.name.length));
const versionWidth = Math.max(...rows.map((row) => row.versions.length));
const ruleWidth = Math.max(...rows.map((row) => row.rule.length));

const lines = ["Security overrides (pnpm 10 settings)", "-----------------------------------"];
for (const row of rows) {
	lines.push(
		`  ${row.name.padEnd(nameWidth)}  ${row.versions.padEnd(versionWidth)}  ` +
			`${row.rule.padEnd(ruleWidth)}  ${row.state}`,
	);
}
console.log(lines.join("\n"));

if (problems.length > 0) {
	for (const problem of problems) console.log(`::error::${problem}`);
	console.log(`\nResult: FAIL - ${problems.length} override problem(s).`);
	appendStepSummary(
		`## Security overrides: FAIL\n\n${problems.map((problem) => `- ${problem}`).join("\n")}\n`,
	);
	process.exit(1);
}

console.log(
	`\nResult: PASS - ${EXPECTED_OVERRIDES.size} overrides declared and the security pins hold.`,
);
appendStepSummary(
	`## Security overrides: PASS\n\n${EXPECTED_OVERRIDES.size} overrides declared; resolved security versions are within their floors.\n`,
);
