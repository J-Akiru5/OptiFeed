import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * #903 cleanup script guard.
 *
 * The script at `scripts/ops/hopper-alert-cleanup.sql` is a production data
 * operation that the owner runs by hand after a backup; it is never executed by
 * the test suite against a real database. What these tests can do is
 * (a) pin the properties that make it safe — tenant scope, one transaction, no
 * deletes, the documented resolution reason — and (b) execute its *selection*
 * statements verbatim against a SQLite fixture with a three-row chain. The
 * markers `-- >>> selection:...` exist for (b); the blocks between them stay
 * portable SQL on purpose.
 *
 * SQLite is not PostgreSQL, so this does not prove the production query plan or
 * the UPDATE. It does prove the ranking rule: the newest *open* row is kept and
 * every older unresolved member of the same `episodeKey` in the same tenant is
 * selected, while closed rows, other tenants, non-pellet rows and chains with
 * no open row are left alone.
 *
 * `node:sqlite` is loaded through `createRequire` so this file compiles against
 * a `@types/node` that predates the module while still running the statements
 * on the Node that CI uses (22.13+ has it unflagged).
 */

interface SqliteStatement {
	all(): unknown[];
	get(): unknown;
	run(...values: unknown[]): unknown;
}

interface SqliteDatabase {
	exec(sql: string): void;
	prepare(sql: string): SqliteStatement;
}

const require = createRequire(import.meta.url);
const { DatabaseSync } = require("node:sqlite") as {
	DatabaseSync: new (path: string) => SqliteDatabase;
};

const WEB_ROOT = join(__dirname, "..", "..");
const REPO_ROOT = join(WEB_ROOT, "..", "..");
const SCRIPT = readFileSync(join(REPO_ROOT, "scripts", "ops", "hopper-alert-cleanup.sql"), "utf8");

/** Executable SQL only: comments are allowed to mention forbidden words. */
function executable(sql: string): string {
	return sql
		.split("\n")
		.filter((line) => !line.trimStart().startsWith("--"))
		.join("\n");
}

function selectionBlock(name: string): string {
	const start = SCRIPT.indexOf(`-- >>> selection:${name}`);
	const end = SCRIPT.indexOf(`-- <<< selection:${name}`);
	expect(start, `selection:${name} start marker`).toBeGreaterThan(-1);
	expect(end, `selection:${name} end marker`).toBeGreaterThan(start);
	return SCRIPT.slice(start, end);
}

const DDL = executable(SCRIPT);

describe("hopper alert cleanup script (#903)", () => {
	it("refuses to run without an explicit tenant", () => {
		expect(SCRIPT).toContain("\\if :{?tenant_owner}");
		expect(SCRIPT).toContain("Refusing to run unscoped");
		// A selector that matches no pond is a typo, not a no-op worth committing.
		expect(SCRIPT).toContain("matched no Pond row");
	});

	it("is one transaction with a lock, and never deletes history", () => {
		expect(DDL.match(/\bBEGIN;/g)).toHaveLength(1);
		expect(DDL.match(/\bCOMMIT;/g)).toHaveLength(1);
		expect(DDL).toContain("pg_advisory_xact_lock");

		for (const destructive of ["DELETE FROM", "TRUNCATE", "DROP TABLE", "ALTER TABLE"]) {
			expect(DDL.toUpperCase(), `script must not contain ${destructive}`).not.toContain(
				destructive,
			);
		}
	});

	it("closes duplicates with the documented audit values", () => {
		expect(DDL).toContain('"resolvedAt" = NOW()');
		expect(DDL).toContain('"autoCleared" = TRUE');
		expect(SCRIPT).toContain("'duplicate-heartbeat-episode'");
		// No supersede link: these rows are duplicates that were never closed, not
		// history folded into another episode.
		expect(DDL).not.toContain('"supersededById" =');
	});

	it("prints counts before and after, scoped to the tenant ponds", () => {
		expect(SCRIPT).toContain("'before'");
		expect(SCRIPT).toContain("'after'");
		for (const block of [selectionBlock("keeper"), selectionBlock("target")]) {
			expect(block).toContain('n."pondId" IN (SELECT id FROM cleanup_903_pond)');
		}
		expect(DDL).toContain('n."pondId" IN (SELECT id FROM cleanup_903_pond)');
	});

	it("selects the older unresolved members of a three-row chain and keeps the open one", () => {
		const db = new DatabaseSync(":memory:");
		db.exec(`
			CREATE TABLE "Notification" (
				id text PRIMARY KEY,
				category text NOT NULL,
				"pondId" text NOT NULL,
				"episodeKey" text,
				"createdAt" text NOT NULL,
				"resolvedAt" text,
				"autoCleared" integer NOT NULL DEFAULT 0,
				"supersededById" text
			);
			CREATE TABLE cleanup_903_pond (id text PRIMARY KEY);
			CREATE TABLE cleanup_903_keeper (
				"episodeKey" text PRIMARY KEY,
				keeper_id text NOT NULL
			);
			CREATE TABLE cleanup_903_target (
				id text PRIMARY KEY,
				"episodeKey" text NOT NULL
			);
			INSERT INTO cleanup_903_pond (id) VALUES ('pond-demo');
		`);

		const insert = db.prepare(`
			INSERT INTO "Notification"
				(id, category, "pondId", "episodeKey", "createdAt", "resolvedAt", "autoCleared", "supersededById")
			VALUES (?, ?, ?, ?, ?, ?, ?, ?)
		`);
		const row = (
			id: string,
			pondId: string,
			episodeKey: string,
			createdAt: string,
			options: {
				category?: string;
				resolvedAt?: string | null;
				supersededById?: string | null;
			} = {},
		) =>
			insert.run(
				id,
				options.category ?? "pellet",
				pondId,
				episodeKey,
				createdAt,
				options.resolvedAt ?? null,
				options.resolvedAt ? 1 : 0,
				options.supersededById ?? null,
			);

		// The chain of three: two unresolved members pointing at the newest open
		// row, plus an older member that is already closed.
		row("n-closed", "pond-demo", "pellet-days:dev-1", "2026-11-06T09:00:00.000Z", {
			resolvedAt: "2026-11-06T09:30:00.000Z",
		});
		row("n-oldest", "pond-demo", "pellet-days:dev-1", "2026-11-06T10:00:00.000Z", {
			supersededById: "n-keeper",
		});
		row("n-middle", "pond-demo", "pellet-days:dev-1", "2026-11-06T11:00:00.000Z", {
			supersededById: "n-keeper",
		});
		row("n-keeper", "pond-demo", "pellet-days:dev-1", "2026-11-06T12:00:00.000Z");

		// A second tenant on the same database must never be touched.
		row("n-other-keeper", "pond-other", "pellet-days:dev-9", "2026-11-06T12:00:00.000Z");
		row("n-other-dupe", "pond-other", "pellet-days:dev-9", "2026-11-06T10:00:00.000Z", {
			supersededById: "n-other-keeper",
		});

		// A chain with no open row has no episode to keep: left alone. Both rows
		// are unresolved but carry a supersede link, so neither is "open".
		row("n-orphan-1", "pond-demo", "pellet-days:dev-orphan", "2026-11-06T13:00:00.000Z", {
			supersededById: "n-gone",
		});
		row("n-orphan-2", "pond-demo", "pellet-days:dev-orphan", "2026-11-06T14:00:00.000Z", {
			supersededById: "n-gone",
		});

		// A healthy single open row is not a duplicate.
		row("n-single", "pond-demo", "pellet-days:dev-single", "2026-11-06T12:00:00.000Z");

		// Another category that reuses an episodeKey shape is out of scope.
		row("n-system", "pond-demo", "pellet-days:dev-1", "2026-11-06T08:00:00.000Z", {
			category: "system",
		});

		db.exec(selectionBlock("keeper"));
		db.exec(selectionBlock("target"));

		const selected = db
			.prepare("SELECT id FROM cleanup_903_target ORDER BY id")
			.all()
			.map((result) => (result as { id: string }).id);

		expect(selected).toEqual(["n-middle", "n-oldest"]);
	});

	it("selects nothing a second time once the duplicates are closed", () => {
		const db = new DatabaseSync(":memory:");
		db.exec(`
			CREATE TABLE "Notification" (
				id text PRIMARY KEY,
				category text NOT NULL,
				"pondId" text NOT NULL,
				"episodeKey" text,
				"createdAt" text NOT NULL,
				"resolvedAt" text,
				"autoCleared" integer NOT NULL DEFAULT 0,
				"supersededById" text
			);
			CREATE TABLE cleanup_903_pond (id text PRIMARY KEY);
			CREATE TABLE cleanup_903_keeper (
				"episodeKey" text PRIMARY KEY,
				keeper_id text NOT NULL
			);
			CREATE TABLE cleanup_903_target (
				id text PRIMARY KEY,
				"episodeKey" text NOT NULL
			);
			INSERT INTO cleanup_903_pond (id) VALUES ('pond-demo');
			INSERT INTO "Notification"
				(id, category, "pondId", "episodeKey", "createdAt", "resolvedAt", "autoCleared", "supersededById")
			VALUES
				('n-old', 'pellet', 'pond-demo', 'pellet-days:dev-1', '2026-11-06T10:00:00.000Z', NULL, 0, 'n-new'),
				('n-new', 'pellet', 'pond-demo', 'pellet-days:dev-1', '2026-11-06T11:00:00.000Z', NULL, 0, NULL);
		`);

		db.exec(selectionBlock("keeper"));
		db.exec(selectionBlock("target"));
		const firstPass = db.prepare("SELECT count(*) AS n FROM cleanup_903_target").get() as {
			n: number;
		};
		expect(firstPass.n).toBe(1);

		// Apply the script's close, then re-run the selection exactly as a second
		// invocation would (the script is idempotent by construction).
		db.exec(`
			UPDATE "Notification"
			SET "resolvedAt" = '2026-11-07T00:00:00.000Z', "autoCleared" = 1
			WHERE id IN (SELECT id FROM cleanup_903_target);
			DELETE FROM cleanup_903_target;
			DELETE FROM cleanup_903_keeper;
		`);
		db.exec(selectionBlock("keeper"));
		db.exec(selectionBlock("target"));

		const secondPass = db.prepare("SELECT count(*) AS n FROM cleanup_903_target").get() as {
			n: number;
		};
		expect(secondPass.n).toBe(0);
	});
});
