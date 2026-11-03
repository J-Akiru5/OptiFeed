import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Migration guard for #727: FeedEvent.eventId is minted per device.
 *
 * No database is reachable here. These assertions pin the Prisma model and the
 * DDL together so the global unique index cannot come back, the compound key
 * cannot silently disappear, and the migration keeps its intended shape: one
 * index replaced, no data deleted.
 */

const WEB_ROOT = join(__dirname, "..", "..");
const SCHEMA_PATH = join(WEB_ROOT, "prisma", "schema.prisma");
const MIGRATION = "20261104100000_feed_event_device_unique";
const MIGRATION_PATH = join(WEB_ROOT, "prisma", "migrations", MIGRATION, "migration.sql");
const OLD_UNIQUE_MIGRATION = "20260711000001_audit_fixes";

const schema = readFileSync(SCHEMA_PATH, "utf8");

function model(name: string): string {
	const start = schema.indexOf(`model ${name} {`);
	expect(start, `${name} model`).toBeGreaterThan(-1);
	const end = schema.indexOf("\n}", start);
	return schema.slice(start, end);
}

/** Executable SQL only: comments may mention the words we forbid. */
function ddl(sql: string): string {
	return sql
		.split("\n")
		.filter((line) => !line.trimStart().startsWith("--"))
		.join("\n");
}

describe("FeedEvent event id uniqueness (#727)", () => {
	it("declares a compound unique on (deviceId, eventId) in the Prisma model", () => {
		const block = model("FeedEvent");

		expect(block).toContain("@@unique([deviceId, eventId])");
		// The global unique was the bug: devices mint ids independently.
		expect(block).not.toMatch(/eventId\s+String\?\s+@unique/);
		// Postgres unique indexes allow multiple NULLs, so optional stays valid.
		expect(block).toMatch(/eventId\s+String\?/);
	});

	it("ships a migration ordered after the one that created the global index", () => {
		expect(existsSync(MIGRATION_PATH), `${MIGRATION} must exist`).toBe(true);
		expect(MIGRATION.localeCompare(OLD_UNIQUE_MIGRATION)).toBeGreaterThan(0);
	});

	it("drops the global index and creates the device-scoped index", () => {
		const sql = ddl(readFileSync(MIGRATION_PATH, "utf8"));

		expect(sql).toContain('DROP INDEX IF EXISTS "FeedEvent_eventId_key";');
		expect(sql).toContain(
			'CREATE UNIQUE INDEX IF NOT EXISTS "FeedEvent_deviceId_eventId_key" ON "FeedEvent"("deviceId", "eventId");',
		);
		expect(sql).not.toContain('"FeedEvent_eventId_key" ON');
	});

	it("relaxes the constraint without deleting data", () => {
		const sql = ddl(readFileSync(MIGRATION_PATH, "utf8")).toUpperCase();

		for (const destructive of [
			"DROP TABLE",
			"DROP COLUMN",
			"TRUNCATE",
			"DELETE FROM",
			"ALTER COLUMN",
		]) {
			expect(sql, `migration must not contain ${destructive}`).not.toContain(destructive);
		}
	});
});
