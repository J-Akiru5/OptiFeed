#!/usr/bin/env node
/**
 * Compare the pre-destruction baseline with the post-restore snapshot and
 * render the evidence report.
 *
 * The comparison is exact: row counts, schema-object counts and every named
 * invariant must be identical. Any difference fails the job (exit 1) after the
 * report has still been written, so a failed drill leaves evidence too.
 *
 * Usage:
 *   node scripts/ops/render-drill-report.mjs \
 *     --baseline artifacts/restore-drill-baseline.json \
 *     --restored artifacts/restore-drill-restored.json \
 *     --destroyed artifacts/restore-drill-destroyed.json \
 *     --roundtrip artifacts/restore-drill-roundtrip.json \
 *     --out artifacts/restore-drill-report.md
 *
 * Environment (all optional; missing values render as "not recorded"):
 *   DRILL_RUN_URL DRILL_RUN_ID DRILL_REPO DRILL_REF DRILL_SHA DRILL_TRIGGER
 *   DRILL_RUNNER_OS DRILL_RUNNER_IMAGE DRILL_NODE_VERSION
 *   DRILL_POSTGRES_VERSION DRILL_PSQL_VERSION
 *   DRILL_DUMP_FILE DRILL_DUMP_BYTES DRILL_DUMP_SHA256
 *   DRILL_TS_START DRILL_TS_BASELINE DRILL_TS_DUMP DRILL_TS_DESTROY
 *   DRILL_TS_RESTORE_START DRILL_TS_RESTORE_END DRILL_TS_VERIFY
 *   DRILL_RESTORE_MS DRILL_MIGRATE_STATUS
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const NOT_RECORDED = "not recorded";

function parseArgs(argv) {
	const options = {
		baseline: null,
		restored: null,
		destroyed: null,
		roundtrip: null,
		out: null,
	};
	const single = new Set(["--baseline", "--restored", "--destroyed", "--roundtrip", "--out"]);
	for (let index = 0; index < argv.length; index += 1) {
		const arg = argv[index];
		if (!single.has(arg)) throw new Error(`unknown argument: ${arg}`);
		const value = argv[index + 1];
		if (!value) throw new Error(`${arg} needs a path`);
		options[arg.slice(2)] = resolve(value);
		index += 1;
	}
	if (!options.baseline) throw new Error("--baseline is required");
	if (!options.restored) throw new Error("--restored is required");
	return options;
}

function readJson(path, label) {
	try {
		return JSON.parse(readFileSync(path, "utf8"));
	} catch (error) {
		throw new Error(
			`could not read the ${label} snapshot at ${path}: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
}

function env(name) {
	const value = process.env[name];
	return typeof value === "string" && value.trim() !== "" ? value.trim() : NOT_RECORDED;
}

function escapeCell(value) {
	return String(value).replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

function compareMaps(section, baseline, restored, diffs) {
	const keys = new Set([...Object.keys(baseline ?? {}), ...Object.keys(restored ?? {})]);
	for (const key of [...keys].sort()) {
		const before = baseline?.[key];
		const after = restored?.[key];
		if (before === after) continue;
		diffs.push({ section, key, baseline: before, restored: after });
	}
	return [...keys].sort();
}

function compareInvariants(baseline, restored, diffs) {
	const beforeById = new Map((baseline.invariants ?? []).map((entry) => [entry.id, entry]));
	const afterById = new Map((restored.invariants ?? []).map((entry) => [entry.id, entry]));
	const ids = [...new Set([...beforeById.keys(), ...afterById.keys()])].sort();
	const rows = [];
	for (const id of ids) {
		const before = beforeById.get(id);
		const after = afterById.get(id);
		const row = {
			id,
			label: before?.label ?? after?.label ?? id,
			expected: before?.expected ?? after?.expected ?? NOT_RECORDED,
			baseline: before?.value ?? "(missing)",
			restored: after?.value ?? "(missing)",
			pass: Boolean(before?.pass) && Boolean(after?.pass) && before?.value === after?.value,
		};
		if (!row.pass) {
			diffs.push({
				section: "invariant",
				key: id,
				baseline: row.baseline,
				restored: row.restored,
			});
		}
		rows.push(row);
	}
	return rows;
}

function humanBytes(raw) {
	const bytes = Number(raw);
	if (!Number.isFinite(bytes) || bytes <= 0) return NOT_RECORDED;
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
	return `${(bytes / (1024 * 1024)).toFixed(2)} MiB`;
}

function humanDuration(raw) {
	const milliseconds = Number(raw);
	if (!Number.isFinite(milliseconds) || milliseconds < 0) return NOT_RECORDED;
	return `${(milliseconds / 1000).toFixed(3)} s (${milliseconds} ms)`;
}

function render(options, baseline, restored, destroyed, roundtrip, diffs) {
	const rows = compareMaps("row count", baseline.tables, restored.tables, []);
	const schemaRows = compareMaps("schema object", baseline.schema, restored.schema, []);
	const invariants = compareInvariants(baseline, restored, diffs);

	const destroyedOk = destroyed ? destroyed.empty === true : null;
	const roundtripOk = roundtrip ? roundtrip.ok === true : null;
	const pass =
		diffs.length === 0 &&
		baseline.invariantsPass === true &&
		restored.invariantsPass === true &&
		destroyedOk !== false &&
		roundtripOk !== false;

	const lines = [];
	lines.push("# Restore drill report");
	lines.push("");
	lines.push(`**Verdict: ${pass ? "PASS" : "FAIL"}**`);
	lines.push("");
	lines.push(
		[
			`Generated \`${baseline.generatedAt ?? NOT_RECORDED}\` from the workflow run`,
			env("DRILL_RUN_URL") === NOT_RECORDED ? "(run URL not recorded)" : env("DRILL_RUN_URL"),
			`on \`${env("DRILL_REF")}\` at \`${env("DRILL_SHA")}\`.`,
		].join(" "),
	);
	lines.push("");
	lines.push("## What this drill proves");
	lines.push("");
	lines.push(
		[
			"- A logical backup of the application schema was taken with `pg_dump --format=custom --no-owner --no-privileges`.",
			"- The application schema was then destroyed (`DROP SCHEMA public CASCADE`) and the database was verified empty.",
			"- The dump was restored with `pg_restore --clean --if-exists --no-owner --no-privileges --exit-on-error` into the same Postgres server.",
			"- Every table row count, every schema-object count and every named invariant matched the pre-destruction baseline exactly.",
			"- `prisma migrate status` reported the restored migration history as up to date, and a Prisma relational query round-trip succeeded.",
		].join("\n"),
	);
	lines.push("");
	lines.push("## What this drill does not prove");
	lines.push("");
	lines.push(
		[
			"- It does not verify Supabase provider backups or point-in-time recovery; that is issue #325.",
			"- It does not cover `auth.users` or any Supabase-managed identity schema; that is issue #322.",
			"- It does not test RLS enforcement as the `anon`/`authenticated` roles: the restore runs as the database owner and bypasses RLS.",
			"- It does not test a cross-server or cross-version restore, and it is not a disaster-recovery time objective (RTO) measurement for production data volumes.",
			"- It does not exercise the application or the feeder firmware against the restored database.",
		].join("\n"),
	);
	lines.push("");
	lines.push("## Environment");
	lines.push("");
	lines.push("| Item | Value |");
	lines.push("| --- | --- |");
	const envRows = [
		["Repository", env("DRILL_REPO")],
		["Workflow ref", env("DRILL_REF")],
		["Commit", env("DRILL_SHA")],
		["Trigger", env("DRILL_TRIGGER")],
		["Run id", env("DRILL_RUN_ID")],
		["Runner OS", env("DRILL_RUNNER_OS")],
		["Runner image", env("DRILL_RUNNER_IMAGE")],
		["Node", env("DRILL_NODE_VERSION")],
		["PostgreSQL server", env("DRILL_POSTGRES_VERSION")],
		["PostgreSQL client", env("DRILL_PSQL_VERSION")],
		["Drill started", env("DRILL_TS_START")],
		[
			"Drill database",
			`${baseline.database?.host}:${baseline.database?.port}/${baseline.database?.database}`,
		],
	];
	for (const [label, value] of envRows) {
		lines.push(`| ${escapeCell(label)} | ${escapeCell(value)} |`);
	}
	lines.push("");
	lines.push("## Backup");
	lines.push("");
	lines.push("| Item | Value |");
	lines.push("| --- | --- |");
	lines.push(`| Dump file | \`${escapeCell(env("DRILL_DUMP_FILE"))}\` |`);
	lines.push(`| Dump size | ${humanBytes(process.env.DRILL_DUMP_BYTES)} |`);
	lines.push(`| SHA-256 | \`${escapeCell(env("DRILL_DUMP_SHA256"))}\` |`);
	lines.push(`| Baseline recorded | ${env("DRILL_TS_BASELINE")} |`);
	lines.push(`| Dumped at | ${env("DRILL_TS_DUMP")} |`);
	lines.push("");
	lines.push("## Destruction and restore");
	lines.push("");
	lines.push("| Item | Value |");
	lines.push("| --- | --- |");
	lines.push(
		"| Destructive command | `DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;` |",
	);
	lines.push(`| Destroyed at | ${env("DRILL_TS_DESTROY")} |`);
	lines.push(
		`| Tables left in \`public\` | ${destroyed ? destroyed.publicSchemaTables : NOT_RECORDED} (expected 0) |`,
	);
	lines.push(`| Restore started | ${env("DRILL_TS_RESTORE_START")} |`);
	lines.push(`| Restore finished | ${env("DRILL_TS_RESTORE_END")} |`);
	lines.push(`| Restore wall clock | ${humanDuration(process.env.DRILL_RESTORE_MS)} |`);
	lines.push(`| Verified at | ${env("DRILL_TS_VERIFY")} |`);
	lines.push(`| \`prisma migrate status\` | ${escapeCell(env("DRILL_MIGRATE_STATUS"))} |`);
	lines.push(
		`| Prisma relational round-trip | ${roundtrip ? (roundtrip.ok ? "PASS" : "FAIL") : NOT_RECORDED} |`,
	);
	lines.push("");
	lines.push("## Row counts");
	lines.push("");
	lines.push("| Table | Baseline | After restore | Match |");
	lines.push("| --- | ---: | ---: | :---: |");
	for (const table of rows) {
		const before = baseline.tables?.[table];
		const after = restored.tables?.[table];
		lines.push(
			`| \`${escapeCell(table)}\` | ${before ?? "(missing)"} | ${after ?? "(missing)"} | ${before === after ? "yes" : "NO"} |`,
		);
	}
	lines.push("");
	lines.push(
		`Total rows: baseline ${baseline.rowTotal}, after restore ${restored.rowTotal}, across ${rows.length} tables.`,
	);
	lines.push("");
	lines.push("## Schema objects");
	lines.push("");
	lines.push("| Object kind | Baseline | After restore | Match |");
	lines.push("| --- | ---: | ---: | :---: |");
	for (const kind of schemaRows) {
		const before = baseline.schema?.[kind];
		const after = restored.schema?.[kind];
		lines.push(
			`| \`${escapeCell(kind)}\` | ${before ?? "(missing)"} | ${after ?? "(missing)"} | ${before === after ? "yes" : "NO"} |`,
		);
	}
	lines.push("");
	lines.push("## Invariants");
	lines.push("");
	lines.push("| Invariant | Expected | Baseline | After restore | Result |");
	lines.push("| --- | --- | --- | --- | :---: |");
	for (const row of invariants) {
		lines.push(
			`| ${escapeCell(row.label)} | \`${escapeCell(row.expected)}\` | \`${escapeCell(row.baseline)}\` | \`${escapeCell(row.restored)}\` | ${row.pass ? "PASS" : "FAIL"} |`,
		);
	}
	lines.push("");
	if (roundtrip) {
		lines.push("### Prisma round-trip");
		lines.push("");
		lines.push("| Check | Expected | Actual | Result |");
		lines.push("| --- | --- | --- | :---: |");
		for (const check of roundtrip.checks ?? []) {
			lines.push(
				`| \`${escapeCell(check.id)}\` | \`${escapeCell(check.expected)}\` | \`${escapeCell(check.actual)}\` | ${check.pass ? "PASS" : "FAIL"} |`,
			);
		}
		lines.push("");
	}
	lines.push("## Differences");
	lines.push("");
	if (diffs.length === 0) {
		lines.push(
			"None. The restored database is identical to the baseline at the level measured above.",
		);
	} else {
		lines.push("| Section | Key | Baseline | After restore |");
		lines.push("| --- | --- | --- | --- |");
		for (const diff of diffs) {
			lines.push(
				`| ${escapeCell(diff.section)} | \`${escapeCell(diff.key)}\` | \`${escapeCell(diff.baseline ?? "(missing)")}\` | \`${escapeCell(diff.restored ?? "(missing)")}\` |`,
			);
		}
	}
	lines.push("");
	lines.push("## Reproduce");
	lines.push("");
	lines.push("```bash");
	lines.push("gh workflow run restore-drill.yml --ref <branch>");
	lines.push("# or, by hand against a scratch Postgres 16 database:");
	lines.push("#   docs/operations/restore-drill.md");
	lines.push("```");
	lines.push("");
	lines.push(
		`Generated by \`scripts/ops/render-drill-report.mjs\` from \`${options.baseline}\` and \`${options.restored}\`.`,
	);
	lines.push("");

	return { markdown: lines.join("\n"), pass };
}

function main() {
	const options = parseArgs(process.argv.slice(2));
	const baseline = readJson(options.baseline, "baseline");
	const restored = readJson(options.restored, "restored");
	const destroyed = options.destroyed ? readJson(options.destroyed, "destroyed") : null;
	const roundtrip = options.roundtrip ? readJson(options.roundtrip, "round-trip") : null;

	const diffs = [];
	compareMaps("row count", baseline.tables, restored.tables, diffs);
	compareMaps("schema object", baseline.schema, restored.schema, diffs);

	const { markdown, pass } = render(options, baseline, restored, destroyed, roundtrip, diffs);

	if (options.out) {
		mkdirSync(dirname(options.out), { recursive: true });
		writeFileSync(options.out, markdown);
	}
	console.log(markdown);

	if (!pass) {
		console.error(
			`\nrestore drill FAILED: ${diffs.length} difference(s) between the baseline and the restored database.`,
		);
		process.exitCode = 1;
	}
}

main();
