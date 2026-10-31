import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ default: {} }));

import { BACKUP_TRAILER_MARKER } from "@/lib/backup/constants";
import {
	createExportDigest,
	exportCommit,
	exportHeader,
	exportSummary,
	exportTrailer,
	insertStatement,
	sqlArray,
	sqlLiteral,
	sqlString,
	tableHeader,
} from "@/lib/backup/sql";
import { findBackupTable } from "@/lib/backup/tables";

/**
 * SQL text generation. The escaping cases are the ones that can corrupt a file
 * or (worse) a restore: quotes, backslashes, line breaks, Postgres arrays and
 * JSON values that contain commas or quotes.
 */

describe("sqlString", () => {
	it("doubles single quotes", () => {
		expect(sqlString("O'Brien")).toBe("'O''Brien'");
	});

	it("uses an E-string when a newline, tab or backslash is present", () => {
		expect(sqlString("line 1\nline 2")).toBe("E'line 1\\nline 2'");
		expect(sqlString("a\tb")).toBe("E'a\\tb'");
		expect(sqlString("C:\\pond")).toBe("E'C:\\\\pond'");
		expect(sqlString("it's\n")).toBe("E'it''s\\n'");
	});

	it("leaves ordinary text unquoted-without-escapes", () => {
		expect(sqlString("Pond A")).toBe("'Pond A'");
		expect(sqlString("")).toBe("''");
	});
});

describe("sqlArray", () => {
	it("writes an empty array", () => {
		expect(sqlArray([])).toBe("'{}'");
	});

	it("quotes text and enum elements", () => {
		expect(sqlArray(["OWNER", "ADMIN"])).toBe('\'{"OWNER","ADMIN"}\'');
	});

	it("escapes an embedded quote and backslash", () => {
		expect(sqlArray(['a"b', "c\\d"])).toBe('\'{"a\\"b","c\\\\d"}\'');
	});

	it("keeps numbers, booleans, null and dates readable", () => {
		expect(sqlArray([60, 1440])).toBe("'{60,1440}'");
		expect(sqlArray([true, false])).toBe("'{true,false}'");
		expect(sqlArray([null])).toBe("'{NULL}'");
		expect(sqlArray([new Date("2026-10-31T01:02:03.000Z")])).toBe(
			"'{\"2026-10-31T01:02:03.000Z\"}'",
		);
		expect(sqlArray([BigInt(10)])).toBe("'{10}'");
	});
});

describe("sqlLiteral", () => {
	it("writes NULL for null and undefined", () => {
		expect(sqlLiteral(null)).toBe("NULL");
		expect(sqlLiteral(undefined)).toBe("NULL");
	});

	it("writes numbers and booleans", () => {
		expect(sqlLiteral(42)).toBe("42");
		expect(sqlLiteral(1.5)).toBe("1.5");
		expect(sqlLiteral(true)).toBe("TRUE");
		expect(sqlLiteral(false)).toBe("FALSE");
	});

	it("writes NaN and infinities as Postgres float literals", () => {
		expect(sqlLiteral(Number.NaN)).toBe("'NaN'");
		expect(sqlLiteral(Number.POSITIVE_INFINITY)).toBe("'Infinity'");
		expect(sqlLiteral(Number.NEGATIVE_INFINITY)).toBe("'-Infinity'");
	});

	it("writes dates as ISO strings", () => {
		expect(sqlLiteral(new Date("2026-10-31T01:02:03.000Z"))).toBe("'2026-10-31T01:02:03.000Z'");
	});

	it("writes bigint without a decimal point", () => {
		expect(sqlLiteral(BigInt("9007199254740993"))).toBe("9007199254740993");
	});

	it("keeps a JSON array as JSON, not as a Postgres array", () => {
		expect(sqlLiteral([1, 2], "json")).toBe("'[1,2]'");
		expect(sqlLiteral({ a: 1 }, "json")).toBe("'{\"a\":1}'");
	});

	it("writes a list column as a Postgres array", () => {
		expect(sqlLiteral([1, 2], "list")).toBe("'{1,2}'");
	});

	it("writes only the time part for a @db.Time column", () => {
		expect(sqlLiteral(new Date("1970-01-01T06:30:00.000Z"), "time")).toBe("'06:30:00'");
		expect(sqlLiteral("06:30:00", "time")).toBe("'06:30:00'");
		expect(sqlLiteral("1970-01-01T06:30:00.000Z", "time")).toBe("'06:30:00'");
	});

	it("writes only the date part for a @db.Date column", () => {
		expect(sqlLiteral(new Date("2026-10-01T00:00:00.000Z"), "date")).toBe("'2026-10-01'");
		expect(sqlLiteral("2026-10-01", "date")).toBe("'2026-10-01'");
		expect(sqlLiteral("2026-10-01T00:00:00.000Z", "date")).toBe("'2026-10-01'");
	});

	it("falls back to an array literal for an untyped array", () => {
		expect(sqlLiteral([1, 2])).toBe("'{1,2}'");
	});

	it("serialises an object value as JSON text", () => {
		expect(sqlLiteral({ missedFeeding: true })).toBe("'{\"missedFeeding\":true}'");
	});

	it("writes a plain string through the string escaping", () => {
		expect(sqlLiteral("hi")).toBe("'hi'");
	});
});

describe("insertStatement", () => {
	const pond = findBackupTable("Pond");
	if (!pond) throw new Error("Pond is missing from the allow-list");

	it("names every column and writes one row on one line", () => {
		const sql = insertStatement(pond, {
			id: "pond-1",
			ownerId: "farm-1",
			farmId: "farm-row-1",
			name: "Pond's north",
			feedingRatePct: 3,
			feedsPerDay: 3,
			population: null,
			sampleIntervalDays: 14,
			scheduleStart: "06:00:00",
			scheduleEnd: "18:00:00",
			notificationPrefs: { missedFeeding: true },
			status: "ACTIVE",
			isFallow: false,
			createdAt: new Date("2026-10-01T00:00:00.000Z"),
		});

		expect(sql.startsWith('INSERT INTO "Pond" ("id", "ownerId"')).toBe(true);
		expect(sql).toContain("'Pond''s north'");
		expect(sql).toContain("'{\"missedFeeding\":true}'");
		expect(sql).toContain("NULL");
		expect(sql.endsWith(";\n")).toBe(true);
		expect(sql.trimEnd().split("\n")).toHaveLength(1);
	});

	it("writes the redacted device token placeholder instead of the stored value", () => {
		const device = findBackupTable("EnergyDevice");
		if (!device) throw new Error("EnergyDevice is missing from the allow-list");
		const sql = insertStatement(device, { id: "dev-1", mac: "AA:BB" });
		expect(sql).toContain("'redacted:dev-1'");
		expect(sql).toContain('"token"');
		expect(sql).not.toContain("tokenHash");
	});
});

describe("file framing", () => {
	it("names the scope, actor and reason in the header without row data", () => {
		const header = exportHeader({
			scope: "tenant",
			actor: "Owner One",
			reason: "Monthly backup",
			orgNames: ["CICT Farm"],
			generatedAt: new Date("2026-10-31T07:30:00.000Z"),
		});
		expect(header).toContain("Scope: tenant export for CICT Farm");
		expect(header).toContain("Requested by: Owner One");
		expect(header).toContain("Reason: Monthly backup");
		expect(header).toContain("BEGIN;");
		expect(header).toContain("restore-check.mjs");
	});

	it("says when a tenant scope has no organization", () => {
		const header = exportHeader({
			scope: "tenant",
			actor: "x",
			reason: "y",
			orgNames: [],
			generatedAt: new Date(0),
		});
		expect(header).toContain("(no organization)");
	});

	it("labels a platform export as the full database", () => {
		const header = exportHeader({
			scope: "platform",
			actor: "x",
			reason: "y",
			generatedAt: new Date(0),
		});
		expect(header).toContain("Scope: full database (platform export)");
	});

	it("writes a per-table header", () => {
		const pond = findBackupTable("Pond");
		if (!pond) throw new Error("Pond is missing");
		expect(tableHeader(pond, 12)).toContain('-- Table: "Pond" (12 rows)');
	});

	it("summarises only tables that contributed rows", () => {
		expect(exportSummary({ Pond: 2, User: 0, Farm: 1 })).toContain("Pond=2, Farm=1");
		expect(exportSummary({ Pond: 0 })).toContain("no rows exported");
	});

	it("ends with a checksum trailer that covers the payload", () => {
		const trailer = exportTrailer("abc123", 4096);
		expect(trailer).toContain(BACKUP_TRAILER_MARKER);
		expect(trailer).toContain("SHA-256 (of every byte before this marker): abc123");
		expect(trailer).toContain("Payload bytes: 4096");
		expect(trailer).not.toContain("COMMIT;");
	});

	it("puts COMMIT; in the hashed payload, before the trailer", () => {
		expect(exportCommit()).toBe("\nCOMMIT;\n");
	});
});

describe("createExportDigest", () => {
	it("counts bytes, hashes the text and reports the same hex as node:crypto", () => {
		const digest = createExportDigest();
		const first = digest.update("hello ");
		const second = digest.update("world");
		expect(Buffer.from(first).toString("utf8")).toBe("hello ");
		expect(Buffer.from(second).toString("utf8")).toBe("world");
		expect(digest.bytes()).toBe(11);
		expect(digest.hex()).toBe(createHash("sha256").update("hello world").digest("hex"));
	});

	it("counts multi-byte text by encoded bytes, not characters", () => {
		const digest = createExportDigest();
		digest.update("é");
		expect(digest.bytes()).toBe(2);
	});
});
