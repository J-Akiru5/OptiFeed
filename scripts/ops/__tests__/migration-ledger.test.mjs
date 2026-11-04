/**
 * Prove both directions of the migration-ledger check against throwaway
 * directories: unique prefixes pass, a duplicate fails, the recorded
 * production collision is accepted but `--strict` rejects it, and a new
 * collision that reuses a known prefix with different directories is still a
 * failure rather than being waved through by the allowlist.
 *
 * Run: node --test scripts/ops/__tests__/migration-ledger.test.mjs
 */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const CHECK = fileURLToPath(new URL("../migration-ledger.mjs", import.meta.url));
const roots = [];

function repoWith(migrations) {
	const root = mkdtempSync(join(tmpdir(), "optifeed-migration-ledger-"));
	roots.push(root);
	const dir = join(root, "apps", "web", "prisma", "migrations");
	mkdirSync(dir, { recursive: true });
	for (const name of migrations) mkdirSync(join(dir, name), { recursive: true });
	return root;
}

function run(repo, extra = []) {
	try {
		const stdout = execFileSync(process.execPath, [CHECK, "--repo", repo, ...extra], {
			encoding: "utf8",
			stdio: ["ignore", "pipe", "pipe"],
		});
		return { status: 0, output: stdout };
	} catch (error) {
		return { status: error.status ?? 1, output: `${error.stdout ?? ""}${error.stderr ?? ""}` };
	}
}

after(() => {
	for (const root of roots) rmSync(root, { recursive: true, force: true });
});

describe("migration ledger", () => {
	it("passes when every 14-digit prefix is unique", () => {
		const repo = repoWith(["20261104100000_a", "20261104110000_b", "20261104120000_c"]);
		const result = run(repo);
		assert.equal(result.status, 0);
		assert.match(result.output, /migration-ledger: OK \(3 prefixes/);
	});

	it("fails when two migrations share a prefix", () => {
		const repo = repoWith(["20261104130000_a", "20261104130000_b"]);
		const result = run(repo);
		assert.equal(result.status, 1);
		assert.match(result.output, /DUPLICATE prefix 20261104130000/);
		assert.match(result.output, /hard reject/);
	});

	it("ignores entries that are not 14-digit prefixed directories", () => {
		const repo = repoWith(["20261104100000_a", "migration_lock.toml.backup"]);
		const result = run(repo);
		assert.equal(result.status, 0);
	});

	it("accepts the recorded production collision without --strict", () => {
		const repo = repoWith([
			"20261104130000_cron_heartbeat",
			"20261104130000_notification_realtime_publication",
		]);
		const result = run(repo);
		assert.equal(result.status, 0);
		assert.match(result.output, /accepted/);
		assert.match(result.output, /Known collision|known collision/);
	});

	it("rejects the recorded production collision under --strict", () => {
		const repo = repoWith([
			"20261104130000_cron_heartbeat",
			"20261104130000_notification_realtime_publication",
		]);
		const result = run(repo, ["--strict"]);
		assert.equal(result.status, 1);
	});

	it("fails when a known prefix is reused by different migrations", () => {
		const repo = repoWith([
			"20261104130000_cron_heartbeat",
			"20261104130000_notification_realtime_publication",
			"20261104130000_something_new",
		]);
		const result = run(repo);
		assert.equal(result.status, 1);
		assert.match(result.output, /DUPLICATE prefix 20261104130000/);
	});
});
