#!/usr/bin/env node
/**
 * Guard the Prisma migration ledger against duplicate timestamp prefixes.
 *
 * `AGENTS.md` §6 calls a duplicate 14-digit prefix a **hard reject**, and it has
 * already happened once: `20261104130000_cron_heartbeat` and
 * `20261104130000_notification_realtime_publication` both reached production,
 * because Prisma sorts by name and will happily run both. Renaming an applied
 * migration afterwards desynchronises `_prisma_migrations`, so the only safe
 * place to catch the next one is before it merges.
 *
 * The check is static and narrow:
 *
 * 1. Every directory in `apps/web/prisma/migrations` that starts with 14 digits
 *    is part of the ledger.
 * 2. Two directories sharing those 14 digits is a failure.
 * 3. The already-applied collision is recorded in KNOWN_COLLISIONS so the check
 *    can be adopted without rewriting production history. Entries there are
 *    reported as accepted, and `--strict` fails on them too, so the exception
 *    cannot quietly become permanent.
 *
 * Usage:
 *   node scripts/ops/migration-ledger.mjs [--repo <dir>] [--strict]
 */

import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

/**
 * Collisions that are already applied to production and cannot be renamed
 * without desynchronising `_prisma_migrations`. Each one needs a reason.
 * Remove an entry only in a migration that reconciles the database state.
 */
const KNOWN_COLLISIONS = [
	{
		prefix: "20261104130000",
		migrations: [
			"20261104130000_cron_heartbeat",
			"20261104130000_notification_realtime_publication",
		],
		reason:
			"Both were applied to production on 2026-11-03 before any check existed. Prisma sorted by name and ran both; renaming either one now would make Prisma see a missing migration plus a new one and try to re-run it. Fix forward only.",
	},
];

const PREFIX = /^(\d{14})_/;

export function scanLedger(migrationsDir) {
	const entries = readdirSync(migrationsDir).filter((name) => {
		if (!PREFIX.test(name)) return false;
		try {
			return statSync(join(migrationsDir, name)).isDirectory();
		} catch {
			return false;
		}
	});

	const byPrefix = new Map();
	for (const name of entries.sort()) {
		const match = PREFIX.exec(name);
		if (!match) continue;
		const [, prefix] = match;
		const bucket = byPrefix.get(prefix);
		if (bucket) bucket.push(name);
		else byPrefix.set(prefix, [name]);
	}
	return byPrefix;
}

export function findProblems(byPrefix) {
	return [...byPrefix.entries()].filter(([, names]) => names.length > 1);
}

export function classify(problems, known = KNOWN_COLLISIONS) {
	const knownByPrefix = new Map(known.map((entry) => [entry.prefix, entry]));
	return problems.map(([prefix, migrations]) => {
		const accepted = knownByPrefix.get(prefix);
		const sameSet =
			accepted !== undefined &&
			accepted.migrations.length === migrations.length &&
			accepted.migrations.every((name) => migrations.includes(name));
		return { prefix, migrations, accepted: sameSet, reason: sameSet ? accepted.reason : null };
	});
}

function main(argv) {
	const repoIndex = argv.indexOf("--repo");
	const repo = repoIndex === -1 ? process.cwd() : argv[repoIndex + 1];
	const strict = argv.includes("--strict");
	const migrationsDir = join(repo, "apps", "web", "prisma", "migrations");

	const byPrefix = scanLedger(migrationsDir);
	const results = classify(findProblems(byPrefix));

	if (results.length === 0) {
		console.log(`migration-ledger: OK (${byPrefix.size} prefixes, no duplicates)`);
		return 0;
	}

	for (const result of results) {
		const label = result.accepted ? "accepted" : "DUPLICATE";
		console.error(`migration-ledger: ${label} prefix ${result.prefix}`);
		for (const name of result.migrations) console.error(`  - ${name}`);
		if (result.accepted) console.error(`  reason: ${result.reason}`);
	}

	const rejected = strict ? results : results.filter((result) => !result.accepted);
	if (rejected.length === 0) {
		console.log(
			`migration-ledger: OK (${results.length} known collision(s) accepted; run --strict to reject)`,
		);
		return 0;
	}

	console.error(
		`migration-ledger: ${rejected.length} duplicate prefix(es). A duplicate 14-digit prefix is a hard reject (AGENTS.md §6). Rename the new migration before it is applied.`,
	);
	return 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	process.exit(main(process.argv.slice(2)));
}
