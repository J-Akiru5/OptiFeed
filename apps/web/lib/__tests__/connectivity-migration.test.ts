import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ default: {} }));

import { findBackupTable } from "@/lib/backup/tables";

/**
 * Migration guard for the connectivity history table (#479, M3C.10; O24).
 *
 * No database is reachable here: this pins the DDL and the Prisma model, so a
 * later edit cannot silently drop the unique key, the day index, the
 * deny-by-default RLS or the additive-only promise, and the migration cannot
 * start colliding with the incident migration that lands at 16:00.
 */

const WEB_ROOT = join(__dirname, "..", "..");
const MIGRATION = "20261102180000_add_device_connectivity_daily";
const INCIDENT_MIGRATION = "20261102160000_add_platform_incidents";

const schema = readFileSync(join(WEB_ROOT, "prisma", "schema.prisma"), "utf8");
const migrationPath = join(WEB_ROOT, "prisma", "migrations", MIGRATION, "migration.sql");

function model(name: string): string {
	const start = schema.indexOf(`model ${name} {`);
	expect(start, `${name} model`).toBeGreaterThan(-1);
	const end = schema.indexOf("\n}", start);
	return schema.slice(start, end);
}

/** Executable SQL only: comments are allowed to mention the words we forbid. */
function ddl(sql: string): string {
	return sql
		.split("\n")
		.filter((line) => !line.trimStart().startsWith("--"))
		.join("\n");
}

describe("DeviceConnectivityDaily migration", () => {
	it("exists with the later timestamp, so it orders after the incident migration", () => {
		expect(existsSync(migrationPath), `${MIGRATION} must exist`).toBe(true);
		expect(MIGRATION.localeCompare(INCIDENT_MIGRATION)).toBeGreaterThan(0);
	});

	it("is additive only: one table, its indexes and its foreign key", () => {
		const sql = ddl(readFileSync(migrationPath, "utf8"));

		for (const destructive of ["DROP TABLE", "DROP COLUMN", "TRUNCATE", "DELETE FROM"]) {
			expect(sql.toUpperCase(), `migration must not contain ${destructive}`).not.toContain(
				destructive,
			);
		}
		// Every ALTER TABLE in this file targets the new table only.
		const altered = [...sql.matchAll(/ALTER TABLE "([^"]+)"/g)].map((match) => match[1]);
		expect(new Set(altered)).toEqual(new Set(["DeviceConnectivityDaily"]));
	});

	it("stores a UTC DATE day and a unique (deviceId, day), with a day index", () => {
		const sql = readFileSync(migrationPath, "utf8");

		expect(sql).toContain('"day" DATE NOT NULL');
		expect(sql).toContain(
			'CREATE UNIQUE INDEX IF NOT EXISTS "DeviceConnectivityDaily_deviceId_day_key" ON "DeviceConnectivityDaily"("deviceId", "day")',
		);
		expect(sql).toContain(
			'CREATE INDEX IF NOT EXISTS "DeviceConnectivityDaily_day_idx" ON "DeviceConnectivityDaily"("day")',
		);
	});

	it("declares the same shape in the Prisma model", () => {
		const block = model("DeviceConnectivityDaily");

		expect(block).toContain("day            DateTime @db.Date");
		expect(block).toContain("@@unique([deviceId, day])");
		expect(block).toContain("@@index([day])");
		expect(block).toContain("onDelete: Cascade");
		expect(block).toContain("device EnergyDevice @relation");
		// The unique index is also the (deviceId, day) read path; no duplicate.
		expect(block).not.toContain("@@index([deviceId, day])");
	});

	it("enables deny-by-default RLS without FORCE", () => {
		const sql = readFileSync(migrationPath, "utf8");
		expect(sql).toContain('ALTER TABLE "DeviceConnectivityDaily" ENABLE ROW LEVEL SECURITY');
		expect(sql).not.toMatch(/FORCE ROW LEVEL SECURITY/i);
		expect(sql).not.toMatch(/CREATE POLICY/i);
	});

	it("is in the export allow-list with its DATE column declared", () => {
		const table = findBackupTable("DeviceConnectivityDaily");
		expect(table).toBeDefined();
		expect(table?.columns).toContain("day");
		expect(table?.dateColumns).toEqual(["day"]);
		// A tenant export keeps only its own ponds' devices.
		expect(table?.tenantWhere({ pondIds: [], orgIds: [], farmIds: [] } as never)).toEqual({
			device: { pondId: { in: [] } },
		});
	});
});
