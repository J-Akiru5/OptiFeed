#!/usr/bin/env node
/**
 * Supply-chain audit gate.
 *
 * Runs `pnpm audit --prod` and fails when a `critical` or `high` advisory is
 * not covered by a written, unexpired entry in `security/audit-allowlist.json`.
 *
 * Production dependencies only. A finding that is reachable only from
 * `devDependencies` (test runners, code generators, CLI tools) is not shipped,
 * so it does not belong in this gate; run `pnpm audit` without `--prod` to see
 * the full development tree.
 *
 * Allowlist rules enforced here:
 *   - every entry needs `id`, `package`, `reason` and `expires` (YYYY-MM-DD);
 *   - `reason` must be a real explanation, not a placeholder;
 *   - `expires` may be at most 90 days away and must not already have passed;
 *   - an entry that matches no current finding is reported as stale.
 *
 * Exit codes: 0 pass, 1 gate failure, 2 the audit could not be run.
 *
 * Usage:
 *   node scripts/security/audit-gate.mjs            # run the audit
 *   node scripts/security/audit-gate.mjs --from f   # parse a saved audit JSON
 */

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const ALLOWLIST_PATH = join(repoRoot, "security/audit-allowlist.json");
const MAX_ALLOWLIST_DAYS = 90;
const BLOCKING_SEVERITIES = new Set(["critical", "high"]);
const SEVERITY_ORDER = ["critical", "high", "moderate", "low", "info"];

const fromFlag = process.argv.indexOf("--from");
const auditFile = fromFlag === -1 ? null : process.argv[fromFlag + 1];

function fail(message) {
	console.error(`audit-gate: ${message}`);
	process.exit(2);
}

function todayUtc() {
	const now = new Date();
	return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
}

function parseDate(value) {
	if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
	const parsed = new Date(`${value}T00:00:00Z`);
	return Number.isNaN(parsed.getTime()) ? null : parsed.getTime();
}

function daysBetween(fromMs, toMs) {
	return Math.round((toMs - fromMs) / 86_400_000);
}

/* ------------------------------------------------------------------ audit */

function runAudit() {
	if (auditFile) {
		const path = resolve(process.cwd(), auditFile);
		if (!existsSync(path)) fail(`--from file not found: ${path}`);
		return readFileSync(path, "utf8");
	}

	const args = ["audit", "--prod", "--json"];
	// `.cmd` shims cannot be spawned without a shell on Windows; a shell needs a
	// single command string there to avoid DEP0190.
	const result =
		process.platform === "win32"
			? spawnSync("pnpm audit --prod --json", {
					cwd: repoRoot,
					encoding: "utf8",
					shell: true,
					maxBuffer: 64 * 1024 * 1024,
				})
			: spawnSync("pnpm", args, {
					cwd: repoRoot,
					encoding: "utf8",
					maxBuffer: 64 * 1024 * 1024,
				});

	const stdout = result.stdout ?? "";
	const stderr = result.stderr ?? "";
	if (!stdout.trim()) {
		fail(
			`pnpm audit produced no output (exit ${result.status}); a registry or network ` +
				`failure must fail the gate, not pass it.\n${stderr.trim()}`,
		);
	}
	return stdout;
}

function extractJson(raw) {
	const start = raw.indexOf("{");
	const end = raw.lastIndexOf("}");
	if (start === -1 || end === -1 || end < start) fail("pnpm audit did not return JSON");
	try {
		return JSON.parse(raw.slice(start, end + 1));
	} catch (error) {
		fail(`could not parse the audit JSON: ${error.message}`);
	}
}

/** One row per advisory + affected package, with every dependency path that reaches it. */
function toFindings(audit) {
	const advisories = audit.advisories ?? {};
	const rows = [];

	for (const [key, advisory] of Object.entries(advisories)) {
		const id = Number(advisory.id ?? key);
		const findings =
			Array.isArray(advisory.findings) && advisory.findings.length > 0
				? advisory.findings
				: [{ version: "unknown", paths: [] }];

		for (const finding of findings) {
			rows.push({
				id,
				package: advisory.module_name ?? "(unknown)",
				severity: String(advisory.severity ?? "unknown").toLowerCase(),
				title: advisory.title ?? "",
				vulnerableRange: advisory.vulnerable_versions ?? "",
				patchedRange: advisory.patched_versions ?? "",
				installed: finding.version ?? "unknown",
				paths: Array.isArray(finding.paths) ? finding.paths : [],
			});
		}
	}

	return rows.sort(
		(a, b) =>
			SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity) ||
			a.package.localeCompare(b.package),
	);
}

/* -------------------------------------------------------------- allowlist */

function loadAllowlist(problems) {
	if (!existsSync(ALLOWLIST_PATH)) {
		problems.push(`allowlist missing at ${ALLOWLIST_PATH.replace(repoRoot, ".")}`);
		return [];
	}

	let parsed;
	try {
		parsed = JSON.parse(readFileSync(ALLOWLIST_PATH, "utf8"));
	} catch (error) {
		problems.push(`allowlist is not valid JSON: ${error.message}`);
		return [];
	}

	const entries = Array.isArray(parsed) ? parsed : (parsed.entries ?? []);
	const today = todayUtc();
	const valid = [];

	for (const [index, entry] of entries.entries()) {
		const label = `allowlist entry ${index + 1}`;
		const id = Number(entry?.id);
		if (!Number.isInteger(id)) {
			problems.push(`${label}: "id" must be an advisory id number`);
			continue;
		}
		if (typeof entry.package !== "string" || entry.package.trim() === "") {
			problems.push(`${label}: "package" is required`);
			continue;
		}
		if (typeof entry.reason !== "string" || entry.reason.trim().length < 20) {
			problems.push(`${label} (${entry.package}): "reason" must explain why this is safe`);
			continue;
		}
		const expiresAt = parseDate(entry.expires);
		if (expiresAt === null) {
			problems.push(`${label} (${entry.package}): "expires" must be a YYYY-MM-DD date`);
			continue;
		}
		if (expiresAt < today) {
			problems.push(`${label} (${entry.package}): expired on ${entry.expires}; patch or remove it`);
			continue;
		}
		const horizon = daysBetween(today, expiresAt);
		if (horizon > MAX_ALLOWLIST_DAYS) {
			problems.push(
				`${label} (${entry.package}): expires ${entry.expires}, ${horizon} days away; ` +
					`the maximum is ${MAX_ALLOWLIST_DAYS} days`,
			);
			continue;
		}

		valid.push({
			...entry,
			id,
			package: entry.package.trim(),
			expires: entry.expires,
			daysLeft: horizon,
		});
	}

	return valid;
}

function findEntry(allowlist, finding) {
	return allowlist.find((entry) => entry.id === finding.id && entry.package === finding.package);
}

/* ------------------------------------------------------------------ report */

function severityLine(rows, severity) {
	const ofSeverity = rows.filter((row) => row.severity === severity);
	const blocked = ofSeverity.filter((row) => row.allowedBy === null).length;
	const allowed = ofSeverity.length - blocked;
	const suffix = allowed > 0 ? ` (${allowed} allowlisted)` : "";
	return `${severity.padEnd(9)} ${String(ofSeverity.length).padStart(3)}${suffix}`;
}

function shortPaths(paths, limit = 3) {
	if (paths.length === 0) return ["(no path reported)"];
	const shown = paths.slice(0, limit);
	if (paths.length > limit) shown.push(`…and ${paths.length - limit} more path(s)`);
	return shown;
}

function reportFindings(rows) {
	const blocking = rows.filter((row) => BLOCKING_SEVERITIES.has(row.severity));
	const violating = blocking.filter((row) => row.allowedBy === null);

	for (const row of violating) {
		console.log("");
		console.log(
			`${row.severity.toUpperCase()}  ${row.package}@${row.installed}  (advisory ${row.id})`,
		);
		console.log(`  ${row.title}`);
		console.log(`  vulnerable ${row.vulnerableRange} — patched ${row.patchedRange}`);
		for (const path of shortPaths(row.paths)) console.log(`  ${path}`);
	}

	return violating;
}

function summarize(rows, allowlist, stale) {
	const counts = {};
	for (const severity of SEVERITY_ORDER) counts[severity] = 0;
	for (const row of rows) counts[row.severity] = (counts[row.severity] ?? 0) + 1;

	const lines = [];
	lines.push("Supply-chain audit gate — production dependencies");
	lines.push("-----------------------------------------------");
	lines.push(`Findings : ${rows.length} advisory/package pair(s)`);
	for (const severity of SEVERITY_ORDER) {
		if (severity === "info") continue;
		lines.push(`  ${severityLine(rows, severity)}`);
	}
	lines.push(`Allowlist: ${allowlist.length} active entr${allowlist.length === 1 ? "y" : "ies"}`);

	if (allowlist.length > 0) {
		for (const entry of allowlist) {
			const used = rows.find((row) => findEntry([entry], row));
			const state = used ? "allows" : "stale";
			lines.push(
				`  [${state}] ${entry.package} (advisory ${entry.id}) expires ${entry.expires} ` +
					`(${entry.daysLeft} day(s) left)`,
			);
		}
	}
	if (stale.length > 0) {
		const verb = stale.length === 1 ? "entry matches" : "entries match";
		lines.push(
			`  ${stale.length} ${verb} no current finding — remove it so the allowlist stays honest.`,
		);
	}

	return { lines, counts };
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

const problems = [];
const allowlist = loadAllowlist(problems);
const rows = toFindings(extractJson(runAudit()));

for (const row of rows) row.allowedBy = findEntry(allowlist, row) ?? null;

const blocking = rows.filter((row) => BLOCKING_SEVERITIES.has(row.severity));
const violating = blocking.filter((row) => row.allowedBy === null);
const stale = allowlist.filter((entry) => !rows.some((row) => findEntry([entry], row)));
const { lines, counts } = summarize(rows, allowlist, stale);

console.log(lines.join("\n"));

if (violating.length > 0) {
	console.log("");
	console.log("Blocking findings — patch them or add a justified, expiring allowlist entry:");
	reportFindings(rows);
}

for (const problem of problems) console.log(`::error::${problem}`);

if (violating.length > 0) {
	console.log(`\nResult: FAIL — ${violating.length} unallowlisted critical/high finding(s).`);
	appendStepSummary(
		`## Supply-chain audit: FAIL\n\n${violating.length} unallowlisted critical/high ` +
			`finding(s)\n\n${lines.join("\n")}\n`,
	);
	for (const row of violating) {
		console.log(`::error title=${row.severity} ${row.package}::advisory ${row.id}: ${row.title}`);
	}
	process.exit(1);
}

if (problems.length > 0) {
	console.log(`\nResult: FAIL — ${problems.length} allowlist problem(s).`);
	appendStepSummary(`## Supply-chain audit: FAIL\n\n${problems.join("\n")}\n`);
	process.exit(1);
}

const allowlisted = blocking.filter((row) => row.allowedBy !== null).length;
const allowlistNote =
	allowlisted > 0 ? `; ${allowlisted} covered by an expiring allowlist entry` : "";
const criticalNote = counts.critical > 0 ? `; ${counts.critical} critical allowlisted` : "";
console.log(
	`\nResult: PASS — no unallowlisted critical/high findings${allowlistNote}${criticalNote}.`,
);
appendStepSummary(`## Supply-chain audit: PASS\n\n${lines.join("\n")}\n`);
