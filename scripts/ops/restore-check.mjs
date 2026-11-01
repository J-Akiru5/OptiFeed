#!/usr/bin/env node
/**
 * Read-only dry run for an OptiFeed SQL export (issue #353 / #322).
 *
 *   node scripts/ops/restore-check.mjs <export.sql>
 *   node scripts/ops/restore-check.mjs <export.sql> --json
 *   node scripts/ops/restore-check.mjs --self-test
 *
 * It opens no database connection and writes no file. It answers one question
 * before anyone restores: "is this file complete, allowed, internally
 * consistent, and does it carry the identities the restore needs?"
 *
 * Checks:
 *  1. the header and the closing trailer are present and well formed;
 *  2. the SHA-256 in the trailer matches every byte before it, and the byte
 *     count agrees (a truncated download fails here);
 *  3. every INSERT targets an allow-listed table and an allow-listed column,
 *     and no credential column is present;
 *  4. every foreign key in the file resolves inside the file;
 *  5. every exported User has an identity-manifest entry and vice versa, and
 *     the manifest carries no credential;
 *  6. primary keys are unique.
 *
 * The allow-list below mirrors `apps/web/lib/backup/tables.ts`; the
 * `restore-check.test.ts` unit test fails when the two drift.
 */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export const EXPORT_TABLES = [
	"Organization",
	"User",
	"Farm",
	"Pond",
	"Membership",
	"MembershipPermission",
	"OrgSetting",
	"CropCycle",
	"PondEvent",
	"ReminderLog",
	"PondOwnershipHistory",
	"BiomassLog",
	"MortalityLog",
	"FishSample",
	"FcrReport",
	"Notification",
	"Device",
	"EnergyDevice",
	"PondSettingsDraft",
	"FeedingEvent",
	"FeedEvent",
	"FeedRequest",
	"DeviceStateEvent",
	"ScheduleCommand",
	"FeedLevelLog",
	"WaterTempLog",
	"CalibrationRun",
	"AssistantAction",
	"PlatformAdmin",
	"PlatformSetting",
	"AiProviderConfig",
	"PlatformAuditLog",
	"ErrorEvent",
];

/** A credential column must never appear in an export at all. */
export const FORBIDDEN_COLUMNS = [
	"token",
	"tokenHash",
	"password",
	"passwordHash",
	"secret",
	"session",
	"sessionToken",
	"accessToken",
	"refreshToken",
	"apiKey",
	"privateKey",
];

/** The device token is written as a non-usable placeholder, never a real value. */
export const REDACTED_COLUMNS = { EnergyDevice: ["token"] };

/** Primary key per table (only the tables referenced as targets matter, but the
 * duplicate check uses all of them). */
export const PRIMARY_KEYS = {
	Organization: "id",
	User: "id",
	Farm: "id",
	Pond: "id",
	Membership: "id",
	MembershipPermission: "id",
	OrgSetting: "orgId",
	CropCycle: "id",
	PondEvent: "id",
	ReminderLog: "id",
	PondOwnershipHistory: "id",
	BiomassLog: "id",
	MortalityLog: "id",
	FishSample: "id",
	FcrReport: "id",
	Notification: "id",
	Device: "id",
	EnergyDevice: "id",
	PondSettingsDraft: "id",
	FeedingEvent: "id",
	FeedEvent: "id",
	FeedRequest: "id",
	DeviceStateEvent: "id",
	ScheduleCommand: "id",
	FeedLevelLog: "id",
	WaterTempLog: "id",
	CalibrationRun: "id",
	AssistantAction: "id",
	PlatformAdmin: "id",
	PlatformSetting: "key",
	AiProviderConfig: "id",
	PlatformAuditLog: "id",
	ErrorEvent: "id",
};

/**
 * Foreign keys the database enforces. `target` names the column the reference
 * points at (usually the target's `id`; `Farm.ownerId` points at `User.farmId`).
 * Nullable keys may be null in a row, which means "no referenced row required".
 */
export const FOREIGN_KEYS = {
	Farm: [{ column: "ownerId", table: "User", target: "farmId" }],
	Pond: [
		{ column: "ownerId", table: "User", target: "farmId" },
		{ column: "farmId", table: "Farm", target: "id" },
	],
	CropCycle: [{ column: "pondId", table: "Pond", target: "id" }],
	PondEvent: [
		{ column: "pondId", table: "Pond", target: "id" },
		{ column: "cropCycleId", table: "CropCycle", target: "id", nullable: true },
	],
	PondOwnershipHistory: [{ column: "pondId", table: "Pond", target: "id" }],
	BiomassLog: [{ column: "pondId", table: "Pond", target: "id" }],
	MortalityLog: [
		{ column: "pondId", table: "Pond", target: "id" },
		{ column: "cropCycleId", table: "CropCycle", target: "id", nullable: true },
	],
	FishSample: [{ column: "biomassLogId", table: "BiomassLog", target: "id" }],
	FcrReport: [{ column: "pondId", table: "Pond", target: "id" }],
	Notification: [{ column: "pondId", table: "Pond", target: "id" }],
	Device: [{ column: "pondId", table: "Pond", target: "id" }],
	EnergyDevice: [{ column: "pondId", table: "Pond", target: "id", nullable: true }],
	PondSettingsDraft: [
		{ column: "pondId", table: "Pond", target: "id" },
		{ column: "userId", table: "User", target: "id" },
		{ column: "deviceId", table: "EnergyDevice", target: "id", nullable: true },
	],
	FeedingEvent: [{ column: "deviceId", table: "Device", target: "id" }],
	FeedEvent: [{ column: "deviceId", table: "EnergyDevice", target: "id" }],
	FeedRequest: [{ column: "deviceId", table: "EnergyDevice", target: "id" }],
	DeviceStateEvent: [{ column: "deviceId", table: "EnergyDevice", target: "id" }],
	ScheduleCommand: [
		{ column: "deviceId", table: "EnergyDevice", target: "id" },
		{ column: "pondId", table: "Pond", target: "id" },
	],
	FeedLevelLog: [{ column: "deviceId", table: "EnergyDevice", target: "id" }],
	WaterTempLog: [{ column: "deviceId", table: "EnergyDevice", target: "id" }],
	CalibrationRun: [{ column: "deviceId", table: "EnergyDevice", target: "id" }],
};

export const TRAILER_MARKER = "-- === END OF EXPORT ===";
const IDENTITY_PREFIX = "-- identity: ";
const MANIFEST_MARKER = "-- === AUTH IDENTITY MANIFEST (issue #322) ===";
const HEADER_PREFIX = "-- PakaonAI SQL export, format v";
const INSERT_PATTERN = /^INSERT INTO "([^"]+)" \(([^)]*)\) VALUES \((.*)\);$/;

function splitValues(text) {
	const values = [];
	let current = "";
	let inString = false;
	for (let index = 0; index < text.length; index += 1) {
		const char = text[index];
		if (inString) {
			current += char;
			if (char === "'") {
				if (text[index + 1] === "'") {
					current += "'";
					index += 1;
				} else {
					inString = false;
				}
			}
			continue;
		}
		if (char === "'") {
			inString = true;
			current += char;
			continue;
		}
		if (char === ",") {
			values.push(current.trim());
			current = "";
			continue;
		}
		current += char;
	}
	values.push(current.trim());
	return values.map(parseValue);
}

function parseValue(raw) {
	const text = raw.trim();
	if (text === "NULL") return null;
	if (text === "TRUE") return true;
	if (text === "FALSE") return false;
	const escapeString = /^E'([\s\S]*)'$/.exec(text);
	if (escapeString) return unescapePostgres(escapeString[1]);
	const plainString = /^'([\s\S]*)'$/.exec(text);
	if (plainString) return plainString[1].replace(/''/g, "'");
	if (/^-?\d+(\.\d+)?$/.test(text)) return Number(text);
	return text;
}

function unescapePostgres(text) {
	return text
		.replace(/''/g, "'")
		.replace(/\\n/g, "\n")
		.replace(/\\r/g, "\r")
		.replace(/\\t/g, "\t")
		.replace(/\\\\/g, "\\");
}

function columnsOf(list) {
	return [...list.matchAll(/"([^"]+)"/g)].map((match) => match[1]);
}

function addFailure(failures, message) {
	failures.push(message);
}

export function checkExport(text) {
	const failures = [];
	const warnings = [];
	const rows = new Map();
	const tableHeaderCounts = new Map();

	if (!text.startsWith(HEADER_PREFIX)) {
		addFailure(failures, "missing the PakaonAI SQL export header");
	}
	if (!/^BEGIN;$/m.test(text)) addFailure(failures, "missing BEGIN;");
	if (!/^COMMIT;$/m.test(text)) addFailure(failures, "missing COMMIT;");

	const markerIndex = text.indexOf(`\n${TRAILER_MARKER}`);
	if (markerIndex < 0) {
		addFailure(failures, "missing the closing trailer marker");
	} else {
		const payload = text.slice(0, markerIndex);
		const trailer = text.slice(markerIndex);
		const digest = createHash("sha256").update(payload, "utf8").digest("hex");
		const declaredHash = /SHA-256 \(of every byte before this marker\): ([0-9a-f]{64})/.exec(
			trailer,
		)?.[1];
		const declaredBytes = /Payload bytes: (\d+)/.exec(trailer)?.[1];
		if (!declaredHash) addFailure(failures, "the trailer has no SHA-256");
		else if (declaredHash !== digest) {
			addFailure(
				failures,
				`checksum mismatch: the file hashes to ${digest}, the trailer says ${declaredHash}`,
			);
		}
		if (!declaredBytes) addFailure(failures, "the trailer has no payload byte count");
		else if (Number(declaredBytes) !== Buffer.byteLength(payload, "utf8")) {
			addFailure(
				failures,
				`byte count mismatch: the payload is ${Buffer.byteLength(payload, "utf8")} bytes, the trailer says ${declaredBytes}`,
			);
		}
	}

	const allowed = new Set(EXPORT_TABLES);

	for (const line of text.split("\n")) {
		const header = /^-- Table: "([^"]+)" \((\d+) rows\)$/.exec(line);
		if (header) {
			tableHeaderCounts.set(header[1], Number(header[2]));
			continue;
		}

		const match = INSERT_PATTERN.exec(line);
		if (!match) continue;
		const [, table, columnList, valueList] = match;

		if (!allowed.has(table)) {
			addFailure(failures, `INSERT into a table that is not on the export allow-list: ${table}`);
			continue;
		}

		const columns = columnsOf(columnList);
		const redacted = new Set(REDACTED_COLUMNS[table] ?? []);
		for (const column of columns) {
			if (FORBIDDEN_COLUMNS.includes(column) && !redacted.has(column)) {
				addFailure(failures, `${table} exports the credential column ${column}`);
			}
		}

		const values = splitValues(valueList);
		if (values.length !== columns.length) {
			addFailure(
				failures,
				`${table}: ${columns.length} columns but ${values.length} values on one row`,
			);
			continue;
		}

		const row = {};
		columns.forEach((column, index) => {
			row[column] = values[index];
		});
		for (const column of redacted) {
			const value = row[column];
			if (typeof value === "string" && !value.startsWith("redacted:")) {
				addFailure(failures, `${table}.${column} must be a redacted placeholder, not a value`);
			}
		}
		if (!rows.has(table)) rows.set(table, []);
		rows.get(table).push(row);
	}

	// Primary keys are unique per table.
	for (const [table, tableRows] of rows) {
		const key = PRIMARY_KEYS[table];
		if (!key) {
			addFailure(failures, `${table} has no declared primary key for the duplicate check`);
			continue;
		}
		const seen = new Set();
		for (const row of tableRows) {
			const value = row[key];
			if (value === null || value === undefined) continue;
			if (seen.has(value)) addFailure(failures, `${table}: duplicate ${key} ${String(value)}`);
			seen.add(value);
		}
	}

	// Every foreign key resolves inside the file.
	for (const [table, keys] of Object.entries(FOREIGN_KEYS)) {
		const tableRows = rows.get(table) ?? [];
		for (const key of keys) {
			const target = new Map((rows.get(key.table) ?? []).map((row) => [row[key.target], true]));
			for (const row of tableRows) {
				if (!(key.column in row)) {
					addFailure(failures, `${table} does not export its foreign key ${key.column}`);
					continue;
				}
				const value = row[key.column];
				if (value === null && key.nullable) continue;
				if (!target.has(value)) {
					addFailure(
						failures,
						`${table}.${key.column}=${String(value)} has no ${key.table}.${key.target} in the file`,
					);
				}
			}
		}
	}

	// The identity manifest (issue #322).
	const identities = [];
	for (const line of text.split("\n")) {
		if (!line.startsWith(IDENTITY_PREFIX)) continue;
		try {
			identities.push(JSON.parse(line.slice(IDENTITY_PREFIX.length)));
		} catch {
			addFailure(failures, "an identity-manifest line is not valid JSON");
		}
	}
	if (identities.length === 0 && (rows.get("User") ?? []).length > 0) {
		addFailure(failures, "the file exports User rows but has no auth identity manifest");
	}
	const identityById = new Map(identities.map((entry) => [entry.id, entry]));
	for (const user of rows.get("User") ?? []) {
		const identity = identityById.get(user.id);
		if (!identity) {
			addFailure(failures, `User ${String(user.id)} has no identity-manifest entry`);
			continue;
		}
		for (const field of ["id", "supabaseId", "email", "farmId", "role"]) {
			if (identity[field] !== user[field === "id" ? "id" : field]) {
				addFailure(failures, `identity ${String(user.id)} disagrees with User.${field}`);
			}
		}
		const serialized = JSON.stringify(identity);
		if (/password|token|hash|secret|session/i.test(serialized)) {
			addFailure(failures, `identity ${String(user.id)} contains a credential field`);
		}
	}
	for (const identity of identities) {
		if (!(rows.get("User") ?? []).some((user) => user.id === identity.id)) {
			addFailure(failures, `identity ${String(identity.id)} has no User row in the file`);
		}
	}
	for (const membership of rows.get("Membership") ?? []) {
		if (membership.userId !== null && !identityById.has(membership.userId)) {
			addFailure(
				failures,
				`Membership ${String(membership.id)} references user ${String(membership.userId)} outside the export`,
			);
		}
	}

	// Informational: the pre-flight count is a snapshot, so a concurrent write
	// can legitimately change it. Reported, not failed.
	for (const [table, expected] of tableHeaderCounts) {
		const actual = (rows.get(table) ?? []).length;
		if (actual !== expected) {
			warnings.push(`${table}: header says ${expected} rows, the file contains ${actual}`);
		}
	}

	const totalRows = [...rows.values()].reduce((sum, tableRows) => sum + tableRows.length, 0);

	return {
		ok: failures.length === 0,
		failures,
		warnings,
		manifestPresent: text.includes(MANIFEST_MARKER),
		tables: Object.fromEntries([...rows].map(([table, tableRows]) => [table, tableRows.length])),
		identities: identities.length,
		totalRows,
	};
}

function buildSelfTestExport() {
	const user = {
		id: "user-1",
		supabaseId: "11111111-1111-1111-1111-111111111111",
		farmId: "cict-farm",
		email: "owner@example.com",
		role: "OWNER",
	};
	const payload = [
		"-- PakaonAI SQL export, format v1",
		"BEGIN;",
		'INSERT INTO "User" ("id", "supabaseId", "farmId", "email", "role") VALUES (\'user-1\', \'11111111-1111-1111-1111-111111111111\', \'cict-farm\', \'owner@example.com\', \'OWNER\');',
		"COMMIT;",
		"",
		MANIFEST_MARKER,
		`${IDENTITY_PREFIX}${JSON.stringify({ ...user, displayName: null, memberships: [] })}`,
		"",
	].join("\n");
	const digest = createHash("sha256").update(payload, "utf8").digest("hex");
	return `${payload}\n${TRAILER_MARKER}\n-- SHA-256 (of every byte before this marker): ${digest}\n-- Payload bytes: ${Buffer.byteLength(payload, "utf8")}\n`;
}

function runSelfTest() {
	const valid = buildSelfTestExport();
	const good = checkExport(valid);
	const truncated = checkExport(valid.slice(0, valid.length - 120));
	const tampered = checkExport(valid.replace("owner@example.com", "attacker@example.com"));

	const results = [
		{ name: "a valid export passes", ok: good.ok, detail: good.failures },
		{ name: "a truncated export fails", ok: !truncated.ok, detail: truncated.failures },
		{ name: "a tampered export fails", ok: !tampered.ok, detail: tampered.failures },
	];

	for (const result of results) {
		console.log(`${result.ok ? "PASS" : "FAIL"}  ${result.name}`);
		if (!result.ok) console.log(`      ${result.detail.join("; ")}`);
	}
	return results.every((result) => result.ok);
}

function main() {
	const args = process.argv.slice(2);
	if (args.includes("--self-test")) {
		process.exit(runSelfTest() ? 0 : 1);
	}

	const file = args.find((arg) => !arg.startsWith("--"));
	if (!file) {
		console.error("Usage: node scripts/ops/restore-check.mjs <export.sql> [--json] | --self-test");
		process.exit(2);
	}

	const text = readFileSync(file, "utf8");
	const result = checkExport(text);

	if (args.includes("--json")) {
		console.log(JSON.stringify({ file, ...result }, null, 2));
	} else {
		console.log(`Restore dry run: ${file}`);
		console.log(`  rows:        ${result.totalRows}`);
		console.log(`  tables:      ${Object.keys(result.tables).length}`);
		console.log(`  identities:  ${result.identities}`);
		for (const warning of result.warnings) console.log(`WARN  ${warning}`);
		for (const failure of result.failures) console.log(`FAIL  ${failure}`);
		console.log(
			result.ok
				? "\nPASS  the file is complete and consistent."
				: "\nFAIL  do not restore this file.",
		);
	}

	process.exit(result.ok ? 0 : 1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	main();
}
