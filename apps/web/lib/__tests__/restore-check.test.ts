import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ default: {} }));

import { BACKUP_TABLES, writtenColumns } from "@/lib/backup/tables";

/**
 * `scripts/ops/restore-check.mjs` is the operator's read-only dry run. These
 * tests keep its allow-list identical to the application's and prove that it
 * catches the failures it exists for.
 */

// biome-ignore lint/suspicious/noExplicitAny: the .mjs module has no types.
type CheckerModule = any;

const SCRIPT = join(__dirname, "../../../../scripts/ops/restore-check.mjs");
const checker: CheckerModule = await import(pathToFileURL(SCRIPT).href);

function wrap(payload: string): string {
	const digest = createHash("sha256").update(payload, "utf8").digest("hex");
	return `${payload}\n${checker.TRAILER_MARKER}\n-- SHA-256 (of every byte before this marker): ${digest}\n-- Payload bytes: ${Buffer.byteLength(payload, "utf8")}\n`;
}

describe("restore-check allow-list", () => {
	it("lists exactly the application's export tables", () => {
		const scripted = [...checker.EXPORT_TABLES].sort();
		const application = BACKUP_TABLES.map((table) => table.name).sort();
		expect(scripted).toEqual(application);
	});

	it("declares a primary key for every table", () => {
		expect(Object.keys(checker.PRIMARY_KEYS).sort()).toEqual([...checker.EXPORT_TABLES].sort());
		expect(
			Object.keys(checker.FOREIGN_KEYS).every((name) => checker.EXPORT_TABLES.includes(name)),
		).toBe(true);
	});

	it("redacts exactly the columns the application placeholds", () => {
		const expected: Record<string, string[]> = {};
		for (const table of BACKUP_TABLES) {
			const placeholders = (table.placeholders ?? []).map((entry) => entry.column);
			if (placeholders.length > 0) expected[table.name] = placeholders;
		}
		expect(checker.REDACTED_COLUMNS).toEqual(expected);
	});

	it("keeps every credential column on the forbidden list", () => {
		for (const table of BACKUP_TABLES) {
			const written = writtenColumns(table);
			for (const column of checker.FORBIDDEN_COLUMNS) {
				if (written.includes(column)) {
					const redacted = (checker.REDACTED_COLUMNS[table.name] ?? []).includes(column);
					expect(redacted && table.name === "EnergyDevice" && column === "token").toBe(true);
				}
			}
		}
	});
});

describe("checkExport", () => {
	const userRow = `INSERT INTO "User" ("id", "supabaseId", "farmId", "email", "role") VALUES ('user-1', '11111111-1111-1111-1111-111111111111', 'cict-farm', 'owner@example.com', 'OWNER');`;
	const identity = `-- identity: ${JSON.stringify({
		id: "user-1",
		supabaseId: "11111111-1111-1111-1111-111111111111",
		farmId: "cict-farm",
		email: "owner@example.com",
		role: "OWNER",
		displayName: null,
		memberships: [],
	})}`;

	it("accepts a complete, consistent file", () => {
		const result = checker.checkExport(
			wrap(
				[
					"-- PakaonAI SQL export, format v1",
					"BEGIN;",
					userRow,
					"-- identity manifest",
					identity,
					"COMMIT;",
					"",
				].join("\n"),
			),
		);
		expect(result.failures).toEqual([]);
		expect(result.ok).toBe(true);
		expect(result.totalRows).toBe(1);
		expect(result.identities).toBe(1);
	});

	it("rejects a checksum that does not match the payload", () => {
		const text = wrap(
			"-- PakaonAI SQL export, format v1\nBEGIN;\n-- Requested by: owner\nCOMMIT;\n",
		);
		const result = checker.checkExport(text.replace("owner", "attacker"));
		expect(result.ok).toBe(false);
		expect(result.failures.join(" ")).toContain("checksum mismatch");
	});

	it("rejects a table outside the allow-list", () => {
		const result = checker.checkExport(
			wrap(
				'-- PakaonAI SQL export, format v1\nBEGIN;\nINSERT INTO "Secret" ("id") VALUES (\'x\');\nCOMMIT;\n',
			),
		);
		expect(result.ok).toBe(false);
		expect(result.failures.join(" ")).toContain("not on the export allow-list");
	});

	it("rejects a credential column", () => {
		const result = checker.checkExport(
			wrap(
				`-- PakaonAI SQL export, format v1\nBEGIN;\nINSERT INTO "EnergyDevice" ("id", "tokenHash") VALUES ('d1', 'abc');\nCOMMIT;\n`,
			),
		);
		expect(result.ok).toBe(false);
		expect(result.failures.join(" ")).toContain("credential column tokenHash");
	});

	it("rejects a real device token in the placeholder column", () => {
		const result = checker.checkExport(
			wrap(
				`-- PakaonAI SQL export, format v1\nBEGIN;\nINSERT INTO "EnergyDevice" ("id", "token") VALUES ('d1', 'abcdef0123456789');\nCOMMIT;\n`,
			),
		);
		expect(result.ok).toBe(false);
		expect(result.failures.join(" ")).toContain("must be a redacted placeholder");
	});

	it("accepts the redacted device token placeholder", () => {
		const result = checker.checkExport(
			wrap(
				`-- PakaonAI SQL export, format v1\nBEGIN;\nINSERT INTO "EnergyDevice" ("id", "token", "pondId") VALUES ('d1', 'redacted:d1', NULL);\nCOMMIT;\n`,
			),
		);
		expect(result.failures).toEqual([]);
	});

	it("rejects a table that omits one of its foreign keys", () => {
		const result = checker.checkExport(
			wrap(
				`-- PakaonAI SQL export, format v1\nBEGIN;\nINSERT INTO "EnergyDevice" ("id", "token") VALUES ('d1', 'redacted:d1');\nCOMMIT;\n`,
			),
		);
		expect(result.ok).toBe(false);
		expect(result.failures.join(" ")).toContain("does not export its foreign key pondId");
	});

	it("rejects a dangling foreign key", () => {
		const result = checker.checkExport(
			wrap(
				`-- PakaonAI SQL export, format v1\nBEGIN;\nINSERT INTO "FishSample" ("id", "biomassLogId") VALUES ('s1', 'missing-log');\nCOMMIT;\n`,
			),
		);
		expect(result.ok).toBe(false);
		expect(result.failures.join(" ")).toContain("no BiomassLog.id in the file");
	});

	it("rejects a User row with no identity entry (issue #322)", () => {
		const result = checker.checkExport(
			wrap(`-- PakaonAI SQL export, format v1\nBEGIN;\n${userRow}\nCOMMIT;\n`),
		);
		expect(result.ok).toBe(false);
		expect(result.failures.join(" ")).toContain("no auth identity manifest");
	});

	it("rejects a duplicate primary key", () => {
		const result = checker.checkExport(
			wrap(
				`-- PakaonAI SQL export, format v1\nBEGIN;\n${userRow}\n${userRow}\n${identity}\nCOMMIT;\n`,
			),
		);
		expect(result.ok).toBe(false);
		expect(result.failures.join(" ")).toContain("duplicate id user-1");
	});

	it("warns, but does not fail, when a pre-flight count differs", () => {
		const result = checker.checkExport(
			wrap(
				`-- PakaonAI SQL export, format v1\nBEGIN;\n-- Table: "User" (2 rows)\n${userRow}\n${identity}\nCOMMIT;\n`,
			),
		);
		expect(result.ok).toBe(true);
		expect(result.warnings.join(" ")).toContain("header says 2 rows");
	});
});

describe("--self-test", () => {
	it("passes the bundled valid/truncated/tampered fixtures", () => {
		const output = execFileSync(process.execPath, [SCRIPT, "--self-test"], { encoding: "utf8" });
		expect(output).toContain("PASS  a valid export passes");
		expect(output).toContain("PASS  a truncated export fails");
		expect(output).toContain("PASS  a tampered export fails");
	});
});
