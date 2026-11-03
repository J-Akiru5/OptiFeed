import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The #589 migration contract.
 *
 * No database is reachable here. These assertions pin the partial unique index
 * that closes the concurrent feed_dispensed race, and keep the migration
 * additive.
 */

const WEB_ROOT = join(__dirname, "..", "..");
const sql = readFileSync(
	join(
		WEB_ROOT,
		"prisma",
		"migrations",
		"20261103090000_add_feed_event_request_unique",
		"migration.sql",
	),
	"utf8",
);

const ddl = sql
	.split("\n")
	.filter((line) => !line.trimStart().startsWith("--"))
	.join("\n");

describe("FeedEvent request-id unique index (#589)", () => {
	it("creates the partial unique index on feedRequestId for feed_dispensed rows", () => {
		expect(ddl).toContain(
			'CREATE UNIQUE INDEX IF NOT EXISTS "FeedEvent_feed_dispensed_request_key"',
		);
		expect(ddl).toContain('ON "FeedEvent" ("feedRequestId")');
		expect(ddl).toContain(`WHERE "eventType" = 'feed_dispensed' AND "feedRequestId" IS NOT NULL`);
		expect(ddl).toContain('LOCK TABLE "FeedEvent" IN SHARE ROW EXCLUSIVE MODE');
	});

	it("does not constrain rows without a request id", () => {
		// The WHERE clause is the whole guard: no predicate on source or grams.
		expect(ddl).not.toContain('"source"');
		expect(ddl).toContain('"feedRequestId" IS NOT NULL');
	});

	it("contains no destructive statement", () => {
		expect(ddl).not.toMatch(/\bDROP\s+(TABLE|COLUMN|CONSTRAINT|INDEX|TYPE)\b/i);
		expect(ddl).not.toMatch(/\bTRUNCATE\b/i);
		expect(ddl).not.toMatch(/\bDELETE\s+FROM\b/i);
	});
});
