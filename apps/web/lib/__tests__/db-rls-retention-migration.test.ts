import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The #593 migration contract.
 *
 * No database is reachable here. These assertions pin the containment shape:
 * every app table that lacked RLS gets it, the one public-API grant is removed,
 * and the three list indexes are additive. They do not prove a query plan or
 * that RLS is enforced for a non-owner role in production.
 */

const WEB_ROOT = join(__dirname, "..", "..");
const MIGRATION = "20261103100000_db_rls_index_retention";
const sql = readFileSync(
	join(WEB_ROOT, "prisma", "migrations", MIGRATION, "migration.sql"),
	"utf8",
);

const ddl = sql
	.split("\n")
	.filter((line) => !line.trimStart().startsWith("--"))
	.join("\n");

/** Public app tables that had RLS disabled in the 2026-11-02 audit. */
const RLS_TABLES = [
	"AiProviderConfig",
	"BackgroundJob",
	"CropCycle",
	"Device",
	"ErrorEvent",
	"FeedingEvent",
	"ImpersonationSession",
	"IssueReport",
	"JobArtifact",
	"Membership",
	"MembershipPermission",
	"MortalityLog",
	"Organization",
	"PlatformAdmin",
	"PlatformAuditLog",
	"PondEvent",
	"ReminderLog",
	"login_lockout",
	"rate_limit_bucket",
] as const;

describe("RLS, index and retention migration (#593)", () => {
	it("enables RLS on every audited app table", () => {
		for (const table of RLS_TABLES) {
			expect(ddl, table).toContain(`ALTER TABLE "${table}" ENABLE ROW LEVEL SECURITY;`);
		}
		expect(new Set(RLS_TABLES).size).toBe(19);
	});

	it("does not touch Prisma's migration bookkeeping or force RLS on the owner", () => {
		expect(ddl).not.toContain("_prisma_migrations");
		expect(ddl).not.toMatch(/\bFORCE\s+ROW\s+LEVEL\s+SECURITY\b/i);
		expect(ddl).not.toMatch(/\bDISABLE\s+ROW\s+LEVEL\s+SECURITY\b/i);
	});

	it("makes PondOwnershipHistory explicitly service-role-only", () => {
		expect(ddl).toContain(
			'REVOKE ALL PRIVILEGES ON TABLE "PondOwnershipHistory" FROM anon, authenticated;',
		);
		// RLS stays enabled for the table; only the grants are removed.
		expect(ddl).not.toContain('ALTER TABLE "PondOwnershipHistory"');
	});

	it("adds the three list indexes additively", () => {
		expect(ddl).toContain(
			'CREATE INDEX IF NOT EXISTS "Notification_pondId_createdAt_idx"\nON "Notification" ("pondId", "createdAt");',
		);
		expect(ddl).toContain(
			'CREATE INDEX IF NOT EXISTS "Notification_farmId_createdAt_idx"\nON "Notification" ("farmId", "createdAt");',
		);
		expect(ddl).toContain(
			'CREATE INDEX IF NOT EXISTS "PlatformAuditLog_createdAt_idx"\nON "PlatformAuditLog" ("createdAt");',
		);
	});

	it("does not duplicate the FeedEvent request-id index shipped in #589", () => {
		expect(ddl).not.toContain('"FeedEvent" ("feedRequestId")');
		expect(ddl).not.toContain("FeedEvent_feed_dispensed_request_key");
	});

	it("contains no destructive or data-rewriting statement", () => {
		expect(ddl).not.toMatch(/\bDROP\s+(TABLE|COLUMN|CONSTRAINT|INDEX|TYPE|POLICY)\b/i);
		expect(ddl).not.toMatch(/\bTRUNCATE\b/i);
		expect(ddl).not.toMatch(/\bDELETE\s+FROM\b/i);
		expect(ddl).not.toMatch(/\bALTER\s+COLUMN\b/i);
	});

	it("declares the indexes in the Prisma schema as well", () => {
		const schema = readFileSync(join(WEB_ROOT, "prisma", "schema.prisma"), "utf8");
		const notification = schema.slice(
			schema.indexOf("model Notification {"),
			schema.indexOf("model EnergyDevice {"),
		);
		const audit = schema.slice(
			schema.indexOf("model PlatformAuditLog {"),
			schema.indexOf("model ", schema.indexOf("model PlatformAuditLog {") + 1),
		);

		expect(notification).toContain("@@index([pondId, createdAt])");
		expect(notification).toContain("@@index([farmId, createdAt])");
		expect(audit).toContain("@@index([createdAt])");
	});
});
