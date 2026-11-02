import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The M3C.6 migration contract (issue #479).
 *
 * No database is reachable here. These assertions pin what the additive
 * migration and the Prisma schema must contain: the unique condition key, the
 * three requested indexes, RLS on both tables, and no destructive statement.
 */

const WEB_ROOT = join(__dirname, "..", "..");
const schema = readFileSync(join(WEB_ROOT, "prisma", "schema.prisma"), "utf8");
const sql = readFileSync(
	join(WEB_ROOT, "prisma", "migrations", "20261102160000_add_platform_incidents", "migration.sql"),
	"utf8",
);

const ddl = sql
	.split("\n")
	.filter((line) => !line.trimStart().startsWith("--"))
	.join("\n");

describe("PlatformIncident migration", () => {
	it("declares the unique dedupe key and the three requested indexes in the schema", () => {
		const start = schema.indexOf("model PlatformIncident {");
		const end = schema.indexOf("model PlatformIncidentEvent {");
		expect(start).toBeGreaterThan(-1);
		expect(end).toBeGreaterThan(start);
		const model = schema.slice(start, end);
		expect(model).toContain("dedupeKey      String                   @unique");
		expect(model).toContain("@@index([status, severity, openedAt])");
		expect(model).toContain("@@index([orgId, openedAt])");
		expect(schema.slice(end, schema.indexOf("model ImpersonationSession {")).trim()).toContain(
			"@@index([incidentId, createdAt])",
		);
	});

	it("creates the tables, the unique key and every index additively", () => {
		expect(ddl).toContain('CREATE TABLE IF NOT EXISTS "PlatformIncident"');
		expect(ddl).toContain('CREATE TABLE IF NOT EXISTS "PlatformIncidentEvent"');
		expect(ddl).toContain(
			'CREATE UNIQUE INDEX IF NOT EXISTS "PlatformIncident_dedupeKey_key" ON "PlatformIncident"("dedupeKey")',
		);
		expect(ddl).toContain(
			'CREATE INDEX IF NOT EXISTS "PlatformIncident_status_severity_openedAt_idx" ON "PlatformIncident"("status", "severity", "openedAt")',
		);
		expect(ddl).toContain(
			'CREATE INDEX IF NOT EXISTS "PlatformIncident_orgId_openedAt_idx" ON "PlatformIncident"("orgId", "openedAt")',
		);
		expect(ddl).toContain(
			'CREATE INDEX IF NOT EXISTS "PlatformIncidentEvent_incidentId_createdAt_idx" ON "PlatformIncidentEvent"("incidentId", "createdAt")',
		);
	});

	it("enables deny-by-default RLS on both tables, matching the platform pattern", () => {
		expect(ddl).toContain('ALTER TABLE "PlatformIncident" ENABLE ROW LEVEL SECURITY');
		expect(ddl).toContain('ALTER TABLE "PlatformIncidentEvent" ENABLE ROW LEVEL SECURITY');
		expect(ddl).not.toMatch(/FORCE ROW LEVEL SECURITY/i);
	});

	it("contains no destructive statement", () => {
		expect(ddl).not.toMatch(/\bDROP\s+(TABLE|COLUMN|CONSTRAINT|INDEX|TYPE)\b/i);
		expect(ddl).not.toMatch(/\bTRUNCATE\b/i);
		expect(ddl).not.toMatch(/\bDELETE\s+FROM\b/i);
	});
});
