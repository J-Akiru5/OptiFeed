import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Static guard for the #711 Phase 1 migration.
 *
 * The migration is intentionally inert until the app role switch: it creates
 * `optifeed_app`, grants privileges and adds policies that apply only to that
 * role. It must never contain data-changing or destructive statements.
 */

const MIGRATION = "20261104150000_tenant_app_role_phase1";
const WEB_ROOT = join(__dirname, "..", "..");
const MIGRATION_PATH = join(WEB_ROOT, "prisma", "migrations", MIGRATION, "migration.sql");

const sql = readFileSync(MIGRATION_PATH, "utf8");
const executable = sql
	.split("\n")
	.filter((line) => !line.trimStart().startsWith("--"))
	.join("\n")
	.toUpperCase();

describe("tenant app role migration (#711)", () => {
	it("creates a dedicated NOBYPASSRLS role without a password", () => {
		expect(executable).toContain("CREATE ROLE OPTIFEED_APP");
		expect(executable).toContain("NOBYPASSRLS");
		expect(executable).not.toMatch(/CREATE ROLE OPTIFEED_APP[\s\S]*?PASSWORD/);
	});

	it("grants the app role access to public tables and sequences", () => {
		expect(executable).toContain("GRANT USAGE ON SCHEMA PUBLIC TO OPTIFEED_APP");
		expect(executable).toContain("GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES");
		expect(executable).toContain("GRANT USAGE, SELECT ON ALL SEQUENCES");
	});

	it("creates the core tenant policies for the app role only", () => {
		for (const table of [
			"FARM",
			"POND",
			"USER",
			"MEMBERSHIP",
			"ORGANIZATION",
			"ENERGYDEVICE",
			"FEEDEVENT",
			"NOTIFICATION",
			"FEEDREQUEST",
			"WATERTEMPLOG",
			"FEEDLEVELLOG",
			"DEVICESTATEEVENT",
		]) {
			expect(executable).toContain(`ON "${table}"`);
			expect(executable).toContain("TO OPTIFEED_APP");
		}
		expect(executable).toContain("APP.FARM_IDS");
		expect(executable).toContain("APP.POND_IDS");
	});

	it("contains no data-changing or destructive statement", () => {
		for (const forbidden of [
			"DELETE FROM",
			"TRUNCATE",
			"DROP TABLE",
			"DROP COLUMN",
			"ALTER COLUMN",
			"INSERT INTO",
			'UPDATE "',
			"UPDATE PUBLIC.",
		]) {
			expect(executable, `migration must not contain ${forbidden}`).not.toContain(forbidden);
		}
	});
});
