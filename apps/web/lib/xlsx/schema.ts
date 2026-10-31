/**
 * Column schema for every importable/exportable type (I-107).
 *
 * One pure, dependency-free module defines the canonical headers, header
 * aliases, value kinds and the template example row for the 7 row datasets plus
 * the derived feeding schedule. Export writes these headers, the import maps
 * file headers onto these fields, and the template generator uses the
 * examples, so import, export and templates cannot drift apart.
 *
 * Client components may import this (no zod, no server import).
 */
import type { ExportableType } from "@/lib/csv";

/** The seven dataset types plus the feeding schedule (a derived sheet, not a table). */
export type SheetType = ExportableType | "feeding_schedule";

export const SHEET_TYPES: SheetType[] = [
	"biomass_logs",
	"fish_samples",
	"feed_events",
	"fcr_reports",
	"feed_level_logs",
	"notifications",
	"audit_events",
	"feeding_schedule",
];

export function isSheetType(value: unknown): value is SheetType {
	return typeof value === "string" && (SHEET_TYPES as string[]).includes(value);
}

/** PDF exports: the existing pond summary plus the growth, SGR and FCR reports (export only). */
export const PDF_REPORTS = ["summary", "growth", "sgr", "fcr"] as const;
export type PdfReport = (typeof PDF_REPORTS)[number];

export type FieldKind = "string" | "number" | "date" | "boolean" | "json";

export type CellValue = string | number | boolean | null;

export interface TypeField {
	/** Key the import row objects use, and the canonical export header. */
	name: string;
	/** Extra header spellings accepted on import (compared without case, spaces or punctuation). */
	aliases: string[];
	kind: FieldKind;
	/** A missing/empty required field fails the row after header mapping. */
	required: boolean;
	/** Value shown on the template's example row. */
	example: CellValue;
}

const f = (
	name: string,
	kind: FieldKind,
	required: boolean,
	example: CellValue,
	aliases: string[] = [],
): TypeField => ({ name, aliases, kind, required, example });

export const TYPE_FIELDS: Record<SheetType, TypeField[]> = {
	biomass_logs: [
		f("id", "string", false, "log-1"),
		f("pondId", "string", false, "pond-1"),
		f("sampleWeightKg", "number", true, 10, ["sample weight (kg)", "sample weight"]),
		f("sampleLengthCm", "number", false, 22, ["sample length (cm)", "sample length"]),
		f("sampleCount", "number", true, 5, ["sample count (fish)", "fish count", "count"]),
		f("avgWeightKg", "number", false, 2, ["average weight (kg)", "average weight"]),
		f("batchLabel", "string", false, "Batch 1"),
		f("recordedAt", "date", false, "2026-03-02T04:00:00.000Z", ["date", "sample date"]),
	],
	fish_samples: [
		f("id", "string", false, "sample-1"),
		f("biomassLogId", "string", true, "log-1", ["biomass log id", "log id"]),
		f("batchLabel", "string", false, "Batch 1"),
		f("weightGrams", "number", true, 120, ["weight (g)", "weight"]),
		f("lengthCm", "number", false, 21, ["length (cm)", "length"]),
		f("recordedAt", "date", false, "2026-03-02T04:00:00.000Z", ["date", "sample date"]),
	],
	feed_events: [
		f("id", "string", false, "event-1"),
		f("deviceId", "string", false, "dev-1"),
		f("eventId", "string", false, "req-1"),
		f("eventType", "string", true, "feed_dispensed", ["event type"]),
		f("timestamp", "string", true, "2026-03-02T04:00:00.000Z"),
		f("grams", "number", false, 150, ["grams dispensed", "amount (g)", "amount"]),
		f("source", "string", false, "schedule"),
		f("feedRequestId", "string", false, "fr-1"),
		f("commandId", "string", false, "cmd-1"),
		f("rtcOk", "boolean", false, true),
		f("feederActive", "boolean", false, true),
		f("receivedAt", "date", false, "2026-03-02T04:00:05.000Z"),
	],
	fcr_reports: [
		f("id", "string", false, "fcr-1"),
		f("pondId", "string", false, "pond-1"),
		f("periodStart", "date", true, "2026-03-01T00:00:00.000Z", ["start date"]),
		f("periodEnd", "date", true, "2026-03-31T00:00:00.000Z", ["end date"]),
		f("totalFeedKg", "number", true, 400, ["total feed (kg)", "feed used (kg)"]),
		f("biomassGainKg", "number", true, 250, ["biomass gain (kg)"]),
		f("fcrValue", "number", true, 1.6, ["fcr", "fcr value"]),
	],
	feed_level_logs: [
		f("id", "string", false, "level-1"),
		f("deviceId", "string", false, "dev-1"),
		f("levelPercent", "number", true, 62, ["level (%)", "feed level (%)"]),
		f("distanceCm", "number", true, 18, ["distance (cm)"]),
		f("recordedAt", "date", false, "2026-03-02T04:00:00.000Z", ["date"]),
	],
	notifications: [
		f("id", "string", false, "notif-1"),
		f("pondId", "string", false, "pond-1"),
		f("tier", "string", true, "warning", ["severity"]),
		f("message", "string", true, "Hopper low"),
		f("linkTo", "string", false, "summary"),
		f("read", "boolean", false, false),
		f("category", "string", false, "hopper"),
		f("acknowledgedAt", "date", false, null),
		f("acknowledgedBy", "string", false, null),
		f("autoCleared", "boolean", false, false),
		f("createdAt", "date", false, "2026-03-02T04:00:00.000Z"),
	],
	audit_events: [
		f("id", "string", false, "audit-1"),
		f("deviceId", "string", false, "dev-1"),
		f("eventType", "string", true, "feed_dispensed", ["event type"]),
		f("source", "string", true, "device"),
		f("actorId", "string", false, null),
		f("metadata", "json", false, '{"grams":150}'),
		f("deviceTime", "string", false, null),
		f("createdAt", "date", false, "2026-03-02T04:00:00.000Z"),
	],
	feeding_schedule: [
		f("time", "string", true, "06:00", ["meal time", "feed time", "time (hh:mm)"]),
		f("grams", "number", false, 150, ["grams per meal", "amount (g)", "feed (g)"]),
		f("enabled", "boolean", false, true),
	],
};

/** Lines for the template's Notes sheet and the import dialog. */
export const TYPE_NOTES: Record<SheetType, string[]> = {
	biomass_logs: [
		"sampleWeightKg and sampleCount are required; avgWeightKg is calculated on import, so you may leave it out.",
		"recordedAt accepts ISO dates or Excel dates; a sample without a date is stamped with the import time.",
	],
	fish_samples: [
		"biomassLogId must belong to a sampling on your farm; take the id from an exported sampling sheet.",
		"weightGrams must be greater than 0.",
	],
	feed_events: [
		"eventType and timestamp are required.",
		"Rows are attached to your pond's feeder; a deviceId in the file is ignored.",
	],
	fcr_reports: [
		"periodStart, periodEnd, totalFeedKg, biomassGainKg and fcrValue are required.",
		"FCR is total feed divided by biomass gain.",
	],
	feed_level_logs: [
		"levelPercent and distanceCm are required.",
		"Rows attach to your pond's feeder; a deviceId in the file is ignored.",
	],
	notifications: [
		"tier and message are required.",
		"read and autoCleared accept TRUE/FALSE or 1/0.",
	],
	audit_events: ["eventType and source are required.", "metadata accepts a JSON object string."],
	feeding_schedule: [
		"Columns: time (HH:MM, farm time), grams, enabled (TRUE/FALSE). Rows with enabled FALSE are ignored.",
		"The feeder spaces meals evenly between the first and the last time, so the times must be evenly spaced (within a minute).",
		"Importing replaces the feeding window and the number of meals per day. It is refused when the day's total would pass the daily feed ceiling, which is the only gram cap.",
		"Per-meal grams are informational: each dose comes from your pond settings, not from this file.",
	],
};

/** Lowercase and drop everything but a-z and 0-9, so case, spaces, underscores and unit hints like "(g)" never matter. */
export function canonicalizeHeader(header: string): string {
	return header.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function canonicalKeys(field: TypeField): string[] {
	return [field.name, ...field.aliases].map(canonicalizeHeader);
}

export interface HeaderMapping {
	/** Canonical field name → the file's own header. */
	mapping: Record<string, string>;
	/** Required fields no header was matched to, in schema order. */
	unmatched: string[];
	/** The file's non-empty headers, in file order (the mapping dropdown's options). */
	fileHeaders: string[];
}

/**
 * Match file headers to schema fields. A field the user mapped by hand
 * (`overrides`: field → exact file header) wins over the automatic match, and
 * an override naming a header the file does not have is ignored.
 */
export function resolveHeaderMapping(
	type: SheetType,
	headers: string[],
	overrides: Record<string, string> = {},
): HeaderMapping {
	const fileHeaders = headers.filter((header) => header.trim() !== "");
	const byCanonical = new Map<string, string>();
	for (const header of fileHeaders) {
		const key = canonicalizeHeader(header);
		if (key !== "" && !byCanonical.has(key)) byCanonical.set(key, header);
	}

	const mapping: Record<string, string> = {};
	const unmatched: string[] = [];
	for (const field of TYPE_FIELDS[type]) {
		const override = overrides[field.name];
		const auto = canonicalKeys(field)
			.map((key) => byCanonical.get(key))
			.find((header) => header !== undefined);
		const chosen = override !== undefined && fileHeaders.includes(override) ? override : auto;
		if (chosen !== undefined) mapping[field.name] = chosen;
		else if (field.required) unmatched.push(field.name);
	}
	return { mapping, unmatched, fileHeaders };
}

/** Undo the leading apostrophe the exporter adds in front of a cell that starts like a formula. */
export function unescapeFormulaInjection(value: string): string {
	return /^'[=+\-@\t\r]/.test(value) ? value.slice(1) : value;
}

/** Excel stores dates as days since 1899-12-30 (serial 25569 is 1970-01-01). */
export function excelSerialToIso(serial: number): string | null {
	if (!Number.isFinite(serial)) return null;
	const date = new Date(Math.round((serial - 25569) * 86_400_000));
	return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export type CoerceResult = { ok: true; value: CellValue } | { ok: false; message: string };

/**
 * Turn one raw cell (a CSV string, or whatever the workbook reader produced)
 * into the typed value the import validators expect. An empty cell is `null`;
 * a value that cannot be read as its kind is an error, never a silent guess.
 */
export function coerceCell(raw: unknown, kind: FieldKind): CoerceResult {
	if (raw === null || raw === undefined) return { ok: true, value: null };
	if (typeof raw === "string" && raw.trim() === "") return { ok: true, value: null };

	switch (kind) {
		case "boolean": {
			if (typeof raw === "boolean") return { ok: true, value: raw };
			const text = String(raw).trim().toLowerCase();
			if (["true", "1", "yes", "y"].includes(text)) return { ok: true, value: true };
			if (["false", "0", "no", "n"].includes(text)) return { ok: true, value: false };
			return { ok: false, message: "must be TRUE or FALSE" };
		}
		case "number": {
			const value = typeof raw === "number" ? raw : Number(String(raw).trim());
			return Number.isFinite(value)
				? { ok: true, value }
				: { ok: false, message: "must be a number" };
		}
		case "date": {
			if (raw instanceof Date) {
				return Number.isNaN(raw.getTime())
					? { ok: false, message: "is not a valid date" }
					: { ok: true, value: raw.toISOString() };
			}
			if (typeof raw === "number") {
				const iso = excelSerialToIso(raw);
				return iso ? { ok: true, value: iso } : { ok: false, message: "is not a valid date" };
			}
			const text = unescapeFormulaInjection(String(raw).trim());
			return Number.isNaN(new Date(text).getTime())
				? { ok: false, message: "is not a valid date" }
				: { ok: true, value: text };
		}
		case "json": {
			const text =
				typeof raw === "object" ? JSON.stringify(raw) : unescapeFormulaInjection(String(raw));
			return { ok: true, value: text };
		}
		default:
			return {
				ok: true,
				value: raw instanceof Date ? raw.toISOString() : unescapeFormulaInjection(String(raw)),
			};
	}
}
