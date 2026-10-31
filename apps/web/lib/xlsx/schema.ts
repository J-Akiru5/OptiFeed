/**
 * Column schema for every importable/exportable type (I-107).
 *
 * One pure, zod-free module defines the canonical headers, header aliases,
 * value kinds and the template example row for all 8 types: the 7 row datasets
 * plus the derived feeding schedule. Export writes these headers, the import
 * parser maps file headers onto these fields, and the template generator uses
 * the examples. Import/export and the templates can therefore never drift.
 *
 * Client components may import this fine — it has no dependency and no server
 * import (deliberately not `lib/limits`, which pulls zod).
 */
import type { ExportableType } from "@/lib/csv";

export type FieldKind = "string" | "number" | "date" | "boolean" | "json";

export interface TypeField {
	/** Key the import row objects use, and the canonical export header. */
	name: string;
	/** Extra header spellings accepted on import (case/space/underscore-free compared). */
	aliases: string[];
	kind: FieldKind;
	/** A missing/empty required field fails validation after header mapping. */
	required: boolean;
	/** Row shown in the downloadable template. */
	example: string | number | boolean | null;
}

const f = (name: string, kind: FieldKind, required: boolean, example: string | number | boolean | null, aliases: string[] = []): TypeField => ({
	name,
	aliases,
	kind,
	required,
	example,
});

export const TYPE_FIELDS: Record<ExportableType, TypeField[]> = {
	biomass_logs: [
		f("id", "string", false, "log-1"),
		f("pondId", "string", false, "pond-1"),
		// Sampling weight totals per event, grams via kg to match the log row.
		f("sampleWeightKg", "number", true, 10, ["sample weight (kg)", "sample_weight_kg", "sample weight"]),
		f("sampleLengthCm", "number", false, 22, ["sample length (cm)", "sample_length_cm", "sample length"]),
		f("sampleCount", "number", true, 5, ["sample count (fish)", "sample_count", "fish count", "count"]),
		f("avgWeightKg", "number", false, 2, ["average weight (kg)", "avg_weight_kg", "average weight"]),
		f("batchLabel", "string", false, "Batch 1"),
		f("recordedAt", "date", false, "2026-03-02T04:00:00Z", ["date", "sample date"]),
	],
	fish_samples: [
		f("id", "string", false, "sample-1"),
		f("biomassLogId", "string", true, "log-1", ["biomass_log_id", "biomass log id", "log id"]),
		f("batchLabel", "string", false, "Batch 1"),
		f("weightGrams", "number", true, 120, ["weight (g)", "weight_g", "weight"]),
		f("lengthCm", "number", false, 21, ["length (cm)", "length_cm", "length"]),
		f("recordedAt", "date", false, "2026-03-02T04:00:00Z", ["date", "sample date"]),
	],
	feed_events: [
		f("id", "string", false, "event-1"),
		f("deviceId", "string", false, "dev-1"),
		f("eventId", "string", false, "req-1"),
		f("eventType", "string", true, "feed_dispensed", ["event type", "event_type"]),
		f("timestamp", "string", true, "2026-03-02T04:00:00Z"),
		f("grams", "number", false, 150, ["grams dispensed", "amount (g)", "amount"]),
		f("source", "string", false, "schedule"),
		f("feedRequestId", "string", false, "fr-1"),
		f("commandId", "string", false, "cmd-1"),
		f("rtcOk", "boolean", false, true),
		f("feederActive", "boolean", false, true),
		f("receivedAt", "date", false, "2026-03-02T04:00:05Z"),
	],
	fcr_reports: [
		f("id", "string", false, "fcr-1"),
		f("pondId", "string", false, "pond-1"),
		f("periodStart", "date", true, "2026-03-01T00:00:00Z", ["start date", "period_start"]),
		f("periodEnd", "date", true, "2026-03-31T00:00:00Z", ["end date", "period_end"]),
		f("totalFeedKg", "number", true, 400, ["total feed (kg)", "total_feed_kg", "feed used (kg)"]),
		f("biomassGainKg", "number", true, 250, ["biomass gain (kg)", "biomass_gain_kg"]),
		f("fcrValue", "number", true, 1.6, ["fcr", "fcr value"]),
	],
	feed_level_logs: [
		f("id", "string", false, "level-1"),
		f("deviceId", "string", false, "dev-1"),
		f("levelPercent", "number", true, 62, ["level (%)", "level_percent", "feed level (%)"]),
		f("distanceCm", "number", true, 18, ["distance (cm)", "distance_cm"]),
		f("recordedAt", "date", false, "2026-03-02T04:00:00Z", ["date"]),
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
		f("createdAt", "date", false, "2026-03-02T04:00:00Z"),
	],
	audit_events: [
		f("id", "string", false, "audit-1"),
		f("deviceId", "string", false, "dev-1"),
		f("eventType", "string", true, "feed_dispensed", ["event type", "event_type"]),
		f("source", "string", true, "device"),
		f("actorId", "string", false, null),
		f("metadata", "json", false, '{"grams":150}'),
		f("deviceTime", "string", false, null),
		f("createdAt", "date", false, "2026-03-02T04:00:00Z"),
	],
	feeding_schedule: [
		f("time", "string", true, "06:00", ["meal time", "feed time", "time (HH:MM)"]),
		f("grams", "number", true, 150, ["grams per meal", "amount (g)", "feed (g)"]),
		f("enabled", "boolean", false, true),
	],
};

/** Notes lines rendered on the template's Notes sheet / the template UI. */
export const TYPE_NOTES: Record<ExportableType, string[]> = {
	biomass_logs: [
		"sampleWeightKg and sampleCount are required; avgWeightKg is derived, so you may leave it out.",
		"recordedAt accepts ISO dates; a sample without a date is stamped with the import time.",
	],
	fish_samples: [
		"biomassLogId must belong to a sampling on your farm; export sampling rows first, or take the id from the History page.",
		"weightGrams must be greater than 0.",
	],
	feed_events: [
		"eventType and timestamp are required.",
		"Rows are attached to your pond's feeder; deviceId in the file is ignored.",
	],
	fcr_reports: ["All columns except id and pondId are required.", "FCR equals totalFeedKg divided by biomassGainKg."],
	feed_level_logs: [
		"levelPercent and distanceCm are required.",
		"Rows attach to your pond's feeder; deviceId in the file is ignored.",
	],
	notifications: ["tier and message are required.", "read and autoCleared accept TRUE/FALSE or 1/0."],
	audit_events: ["eventType and source are required.", "metadata accepts a JSON object string."],
	feeding_schedule: [
		"Columns: time (HH:MM, feeder time), grams, enabled (TRUE/FALSE).",
		"Explicitly confirming the import replaces the whole feeding schedule; the daily feed ceiling is the only gram cap.",
		"Per-meal grams are informational: the feeder derives each dose from your pond settings.",
	],
};

/** Lowercase; drop every character outside a-z/0-9, so case, spaces, underscores and unit hints like "(g)" disappear. */
export function canonicalizeHeader(header: string): string {
	return header.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function canonicalAliases(field: TypeField): Set<string> {
	const set = new Set([canonicalizeHeader(field.name)]);
	for (const alias of field.aliases) set.add(canonicalizeHeader(alias));
	return set;
}

export interface HeaderMapping {
	/** Canonical field name → the file's original header. */
	mapping: Record<string, string>;
	/** Required fields with no matching header, in schema order. */
	unmatched: string[];
	/** Original headers (in file order) never used as a required field's target. */
	fileHeaders: string[];
}

/** Order file headers lose to schema order for the mapping dropdowns. */
export function resolveHeaderMapping(
	type: ExportableType,
	headers: string[],
): HeaderMapping {
	const fileHeaders = headers.filter((h) => h.trim() !== "");
	const canonicalToFile = new Map<string, string>();
	for (const header of fileHeaders) {
		const canonical = canonicalizeHeader(header);
		if (canonical !== "" && !canonicalToFile.has(canonical)) canonicalToFile.set(canonical, header);
	}

	const mapping: Record<string, string> = {};
	const unmatched: string[] = [];
	for (const field of TYPE_FIELDS[type]) {
		const found = canonicalAliases(field)
			.values()
			.map((key) => canonicalToFile.get(key))
			.find((value) => value !== undefined);
		if (found !== undefined) mapping[field.name] = found;
		else if (field.required) unmatched.push(field.name);
	}
	return { mapping, unmatched, fileHeaders };
}

/**
 * An exact original-header name wins (the mapping dropdown's contract);
 * otherwise each field resolves through its canonical name/aliases.
 */
export function resolveHeaderMappingWithOverrides(
	type: ExportableType,
	headers: string[],
	overrides?: Record<string, string>,
): HeaderMapping {
	const base = resolveHeaderMapping(type, headers);
	if (!overrides) return base;

	const fields = new Set(TYPE_FIELDS[type].map((field) => field.name));
	const mapping: Record<string, string> = { ...base.mapping };
	for (const [field, header] of Object.entries(overrides)) {
		if (fields.has(field) && header && fileHeaderExists(base.fileHeaders, header)) {
			mapping[field] = header;
		}
	}
	const unmatched = TYPE_FIELDS[type]
		.filter((field) => field.required && mapping[field.name] === undefined)
		.map((field) => field.name);
	return { mapping, unmatched, fileHeaders: base.fileHeaders };
}

function fileHeaderExists(fileHeaders: string[], header: string): boolean {
	return fileHeaders.includes(header);
}

/**
 * Rename row keys onto canonical field names using `mapping`
 * (canonical field → the file's header for that field).
 */
export function applyHeaderMapping(
	rows: Record<string, unknown>[],
	mapping: Record<string, string>,
): Record<string, unknown>[] {
	if (Object.keys(mapping).length === 0) return rows;
	return rows.map((row) => {
		const next: Record<string, unknown> = {};
		for (const [key, value] of Object.entries(row)) {
			const mapped = Object.entries(mapping).find(([, header]) => header === key);
			next[mapped ? mapped[0] : key] = value;
		}
		return next;
	});
}

/** Coerce one raw cell into the typed value `confirmImport` validators expect. */
export function coerceCell(raw: unknown, kind: FieldKind): string | number | boolean | null {
	if (raw === null || raw === undefined) return null;

	switch (kind) {
		case "boolean": {
			if (typeof raw === "boolean") return raw;
			const text = String(raw).trim().toLowerCase();
			if (["true", "1", "yes", "y"].includes(text)) return true;
			if (["false", "0", "no", "n", ""].includes(text)) return false;
			return String(raw);
		}
		case "number": {
			if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
			const text = String(raw).trim();
			if (text === "") return null;
			const parsed = Number(text);
			return Number.isFinite(parsed) ? parsed : String(raw);
		}
		case "date":
			return raw instanceof Date ? raw : String(raw);
		case "json":
			return typeof raw === "object" && raw !== null ? JSON.stringify(raw) : String(raw);
		default:
			return String(raw);
	}
}

/** ExcelJS-exposed date serials without a date style land here too. ExcelJS uses the same 1899-12-30 epoch. */
export function excelSerialToIso(serial: number): string | null {
	if (!Number.isFinite(serial)) return null;
	// Excel serial 25569 is 1970-01-01 on the tool's 1899-12-30 epoch.
	const ms = Math.round((serial - 25569) * 24 * 60 * 60 * 1000);
	return new Date(ms).toISOString();
}
