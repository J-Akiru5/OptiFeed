import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The #585 migration contract.
 *
 * No database is reachable here. These assertions pin the one-time cleanup
 * (newest open row kept, older duplicates resolved with a keeper pointer), the
 * partial unique index that prevents the race, and the no-delete guarantee.
 */

const WEB_ROOT = join(__dirname, "..", "..");
const sql = readFileSync(
	join(
		WEB_ROOT,
		"prisma",
		"migrations",
		"20261103080000_add_notification_episode_unique",
		"migration.sql",
	),
	"utf8",
);

const ddl = sql
	.split("\n")
	.filter((line) => !line.trimStart().startsWith("--"))
	.join("\n");

const verify = readFileSync(
	join(WEB_ROOT, "..", "..", "scripts", "ops", "verify-notification-episodes.sql"),
	"utf8",
);

describe("Notification episode migration (#585)", () => {
	it("folds older open duplicates into the newest keeper", () => {
		expect(ddl).toContain('first_value("id") OVER');
		expect(ddl).toContain('PARTITION BY "episodeKey"');
		expect(ddl).toContain("row_number() OVER");
		expect(ddl).toContain('UPDATE "Notification" AS n');
		expect(ddl).toContain('"supersededById" = ranked.keeper_id');
		expect(ddl).toContain("ranked.rn > 1");
	});

	it("resolves legacy pondId:category open rows that no runtime key can match", () => {
		expect(ddl).toContain('LOCK TABLE "Notification" IN SHARE ROW EXCLUSIVE MODE');
		expect(ddl).toContain(`"episodeKey" NOT LIKE 'pellet:%'`);
		expect(ddl).toContain(`"episodeKey" NOT LIKE 'pellet-days:%'`);
		expect(ddl).toContain(`"episodeKey" NOT LIKE 'offline:%'`);
		expect(ddl).toContain(`"episodeKey" NOT LIKE 'cold-water:%'`);
	});

	it("resolves the folded rows without deleting history", () => {
		expect(ddl).toContain('"autoCleared" = true');
		expect(ddl).toContain('"resolvedAt" = now()');
		expect(ddl).not.toMatch(/\bDELETE\s+FROM\b/i);
		expect(ddl).not.toMatch(/\bDROP\s+(TABLE|COLUMN|CONSTRAINT|INDEX|TYPE)\b/i);
		expect(ddl).not.toMatch(/\bTRUNCATE\b/i);
	});

	it("adds the partial unique index on open episodeKey rows", () => {
		expect(ddl).toContain('CREATE UNIQUE INDEX IF NOT EXISTS "Notification_episodeKey_open_key"');
		expect(ddl).toContain('ON "Notification" ("episodeKey")');
		expect(ddl).toContain('WHERE "resolvedAt" IS NULL AND "autoCleared" = false');
	});

	it("ships the post-migration verification query", () => {
		expect(verify).toContain("HAVING count(*) > 1");
		expect(verify).toContain('"legacyOpenRows"');
	});
});
