import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Static guard for the #711 Phase 2 policy migration.
 *
 * It adds policies for the remaining tenant tables and replaces the two
 * single-org policies with the `app.org_ids` list. It must not change data.
 */

const MIGRATION = "20261104160000_tenant_app_role_phase2";
const WEB_ROOT = join(__dirname, "..", "..");
const MIGRATION_PATH = join(WEB_ROOT, "prisma", "migrations", MIGRATION, "migration.sql");

const sql = readFileSync(MIGRATION_PATH, "utf8");
const executable = sql
	.split("\n")
	.filter((line) => !line.trimStart().startsWith("--"))
	.join("\n")
	.toUpperCase();

describe("tenant app role Phase 2 migration (#711)", () => {
	it("adds policies for the remaining tenant tables", () => {
		for (const table of [
			"BIOMASSLOG",
			"FCRREPORT",
			"FISHSAMPLE",
			"CALIBRATIONRUN",
			"SCHEDULECOMMAND",
			"PONDSETTINGSDRAFT",
			"PONDEVENT",
			"MORTALITYLOG",
			"CROPCYCLE",
			"REMINDERLOG",
			"DEVICECONNECTIVITYDAILY",
			"IMPORTCONFIRMATION",
			"ASSISTANTACTION",
			"BACKGROUNDJOB",
			"JOBARTIFACT",
			"PONDOWNERSHIPHISTORY",
			"DEVICE",
			"FEEDINGEVENT",
			"ORGSETTING",
		]) {
			expect(executable).toContain(`ON "${table}"`);
		}
	});

	it("uses the multi-org setting and replaces the Phase 1 org policies", () => {
		expect(executable).toContain("APP.ORG_IDS");
		expect(executable).toContain('DROP POLICY IF EXISTS TENANT_APP_MEMBERSHIP ON "MEMBERSHIP"');
		expect(executable).toContain('DROP POLICY IF EXISTS TENANT_APP_ORGANIZATION ON "ORGANIZATION"');
	});

	it("contains no data-changing or destructive table statement", () => {
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
