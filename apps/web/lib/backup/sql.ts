import { createHash } from "node:crypto";
import { BACKUP_SQL_FORMAT_VERSION, BACKUP_TRAILER_MARKER } from "./constants";
import { type BackupRow, type BackupTable, columnKind, writtenColumns } from "./tables";

/**
 * SQL text generation for the database export (issue #353).
 *
 * The output is plain, standard SQL: one `INSERT` per row with the column list
 * spelled out, wrapped in a transaction. Values are written as unknown-typed
 * literals and Postgres coerces each one to the column's real type, so the
 * generator does not carry a copy of the schema's type mapping that could drift
 * from it.
 *
 * Safety and bounds:
 * - a single row never spans a line, so a file can be diffed and checked;
 * - strings use `E''` only when they contain a newline, tab or backslash, so
 *   the common case stays readable;
 * - the export is capped in rows (checked before streaming) and in bytes and
 *   wall clock (checked while streaming).
 */

/** Quote an SQL string literal. */
export function sqlString(value: string): string {
	if (/[\n\r\t\\]/.test(value)) {
		const escaped = value
			.replaceAll("\\", "\\\\")
			.replaceAll("'", "''")
			.replaceAll("\n", "\\n")
			.replaceAll("\r", "\\r")
			.replaceAll("\t", "\\t");
		return `E'${escaped}'`;
	}
	return `'${value.replaceAll("'", "''")}'`;
}

function sqlNumber(value: number): string {
	if (Number.isNaN(value)) return "'NaN'";
	if (!Number.isFinite(value)) return value > 0 ? "'Infinity'" : "'-Infinity'";
	return String(value);
}

function sqlArrayElement(value: unknown): string {
	if (value === null || value === undefined) return "NULL";
	if (typeof value === "number") return sqlNumber(value);
	if (typeof value === "bigint") return value.toString();
	if (typeof value === "boolean") return value ? "true" : "false";
	const text =
		value instanceof Date
			? value.toISOString()
			: String(value).replaceAll("\\", "\\\\").replaceAll('"', '\\"');
	return `"${text}"`;
}

/** Postgres array literal: `{"a","b"}` / `{1,2}` / `{}`. */
export function sqlArray(values: readonly unknown[]): string {
	if (values.length === 0) return "'{}'";
	return `'{${values.map(sqlArrayElement).join(",")}}'`;
}

/** A `@db.Time` value: only `HH:MM:SS`, never a full timestamp. */
export function sqlTime(value: unknown): string {
	if (value instanceof Date) return sqlString(value.toISOString().slice(11, 19));
	const text = String(value);
	const match = /T(\d{2}:\d{2}:\d{2})/.exec(text);
	return sqlString(match ? match[1] : text);
}

/** A `@db.Date` value: only `YYYY-MM-DD`. */
export function sqlDate(value: unknown): string {
	if (value instanceof Date) return sqlString(value.toISOString().slice(0, 10));
	const text = String(value);
	const match = /^\d{4}-\d{2}-\d{2}/.exec(text);
	return sqlString(match ? match[0] : text);
}

/** One SQL literal for a column value, preserving JSON and array shape. */
export function sqlLiteral(
	value: unknown,
	kind: "scalar" | "json" | "list" | "time" | "date" = "scalar",
): string {
	if (value === null || value === undefined) return "NULL";
	if (kind === "json") return sqlString(JSON.stringify(value) ?? "null");
	if (kind === "list") return sqlArray(Array.isArray(value) ? value : [value]);
	if (kind === "time") return sqlTime(value);
	if (kind === "date") return sqlDate(value);
	if (value instanceof Date) return sqlString(value.toISOString());
	if (typeof value === "number") return sqlNumber(value);
	if (typeof value === "bigint") return value.toString();
	if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
	if (Array.isArray(value)) return sqlArray(value);
	if (typeof value === "object") return sqlString(JSON.stringify(value) ?? "null");
	return sqlString(String(value));
}

function quoteIdentifier(name: string): string {
	return `"${name.replaceAll('"', '""')}"`;
}

/** `INSERT INTO "Table" ("a", "b") VALUES (...);` with a trailing newline. */
export function insertStatement(table: BackupTable, row: BackupRow): string {
	const columns = writtenColumns(table);
	const values = [
		...table.columns.map((column) => sqlLiteral(row[column], columnKind(table, column))),
		...(table.placeholders ?? []).map((entry) => sqlLiteral(entry.value(row))),
	];
	return `INSERT INTO ${quoteIdentifier(table.name)} (${columns
		.map(quoteIdentifier)
		.join(", ")}) VALUES (${values.join(", ")});\n`;
}

export interface ExportHeaderInput {
	scope: "platform" | "tenant";
	actor: string;
	reason: string;
	orgNames?: readonly string[];
	generatedAt: Date;
}

/** The file header. It names the scope and carries no row data. */
export function exportHeader(input: ExportHeaderInput): string {
	const scopeLine =
		input.scope === "platform"
			? "Scope: full database (platform export)"
			: `Scope: tenant export for ${
					input.orgNames && input.orgNames.length > 0
						? input.orgNames.join(", ")
						: "(no organization)"
				}`;
	return [
		`-- PakaonAI SQL export, format v${BACKUP_SQL_FORMAT_VERSION}`,
		`-- Generated: ${input.generatedAt.toISOString()}`,
		scopeLine,
		`-- Requested by: ${input.actor}`,
		`-- Reason: ${input.reason}`,
		"--",
		"-- Device tokens are redacted, token hashes and session data are absent. A",
		"-- restored feeder must have its token rotated before it can authenticate.",
		"-- Restore order and the auth identity manifest: docs/operations/backup-and-recovery.md §7.5.",
		"-- Verify before restoring: node scripts/ops/restore-check.mjs <this file>",
		"",
		"BEGIN;",
		"",
	].join("\n");
}

/** `-- Table: "Pond" (12 rows)` header before a table's rows. */
export function tableHeader(table: BackupTable, rows: number): string {
	return `\n-- Table: ${quoteIdentifier(table.name)} (${rows} rows)\n`;
}

/** Per-table counts, for the trailing summary. Never row data. */
export function exportSummary(counts: Readonly<Record<string, number>>): string {
	const entries = Object.entries(counts)
		.filter(([, count]) => count > 0)
		.map(([name, count]) => `${name}=${count}`);
	return `\n-- Summary: ${entries.length === 0 ? "no rows exported" : entries.join(", ")}\n`;
}

/** The `COMMIT;` line. Hashed with the payload, so the file commits what it hashes. */
export function exportCommit(): string {
	return "\nCOMMIT;\n";
}

/**
 * The closing block. The checksum covers every byte before this marker, which
 * is why it can be computed first and appended second without a circular hash.
 */
export function exportTrailer(sha256: string, bytes: number): string {
	return [
		"",
		BACKUP_TRAILER_MARKER,
		`-- SHA-256 (of every byte before this marker): ${sha256}`,
		`-- Payload bytes: ${bytes}`,
		"",
	].join("\n");
}

/** Incremental SHA-256 + byte counter used while streaming. */
export function createExportDigest(): {
	update: (chunk: string) => Uint8Array;
	bytes: () => number;
	hex: () => string;
} {
	const hash = createHash("sha256");
	const encoder = new TextEncoder();
	let bytes = 0;
	return {
		update(chunk: string) {
			const encoded = encoder.encode(chunk);
			hash.update(encoded);
			bytes += encoded.byteLength;
			return encoded;
		},
		bytes: () => bytes,
		hex: () => hash.copy().digest("hex"),
	};
}
