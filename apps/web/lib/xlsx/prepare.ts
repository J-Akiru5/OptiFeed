/**
 * Turns the rows read from a CSV or workbook into canonical, typed rows (I-107).
 *
 * The result is the single input to the preview screen and to the confirm step:
 * the header mapping applied, every cell coerced to its schema kind, a per-row
 * error list, and the valid rows re-serialised as canonical CSV, which is what
 * the existing import job (`confirmImport`) reads. Import therefore has one
 * validation path and one writer, whatever the file format.
 *
 * Pure: no database, no I/O, no ExcelJS. The same code runs in the preview
 * route and again, server-side, when the confirm step re-checks the data.
 */
import { IMPORT_ROW_LIMIT } from "@/lib/constants";
import { FEEDS_PER_DAY_MAX } from "@/lib/limits";
import {
	type DerivedSchedule,
	deriveSchedule,
	formatClock,
	parseClock,
} from "@/lib/schedule/slots";
import Papa from "papaparse";
import {
	type CellValue,
	type SheetType,
	TYPE_FIELDS,
	coerceCell,
	resolveHeaderMapping,
} from "./schema";

export interface RowIssue {
	/** 1-based data row (the first row under the header is row 1). */
	row: number;
	field: string;
	message: string;
}

export type StructuralError =
	| "noRows"
	| "missingColumns"
	| "tooManyRows"
	| "scheduleEmpty"
	| "scheduleTooMany"
	| "scheduleUneven";

export interface PreparedImport {
	type: SheetType;
	/** The file's own headers, for the mapping dropdowns. */
	headers: string[];
	/** Canonical field → file header actually used. */
	mapping: Record<string, string>;
	/** Required fields still without a header. */
	unmatched: string[];
	totalRows: number;
	validRows: number;
	issueCount: number;
	/** At most {@link MAX_REPORTED_ISSUES}. */
	issues: RowIssue[];
	preview: Record<string, CellValue>[];
	/** Canonical CSV of the valid rows; empty when the file has a structural error. */
	csvData: string;
	structural: StructuralError | null;
	/** The window and meal count described by the schedule sheet. */
	schedule: DerivedSchedule | null;
}

export const MAX_REPORTED_ISSUES = 50;
const PREVIEW_ROWS = 10;

type NumberRule = "positive" | "positiveInt" | "nonNegative";

/** Mirrors the checks `confirmImport` applies, so a row that passes here cannot fail the import. */
const NUMBER_RULES: Record<string, NumberRule> = {
	"biomass_logs.sampleWeightKg": "positive",
	"biomass_logs.sampleCount": "positiveInt",
	"biomass_logs.sampleLengthCm": "nonNegative",
	"fish_samples.weightGrams": "positive",
	"fish_samples.lengthCm": "nonNegative",
	"feed_events.grams": "nonNegative",
	"fcr_reports.totalFeedKg": "nonNegative",
	"fcr_reports.biomassGainKg": "nonNegative",
	"fcr_reports.fcrValue": "nonNegative",
	"feed_level_logs.levelPercent": "nonNegative",
	"feed_level_logs.distanceCm": "nonNegative",
	"feeding_schedule.grams": "nonNegative",
};

const RULE_MESSAGE: Record<NumberRule, string> = {
	positive: "must be greater than 0",
	positiveInt: "must be a whole number greater than 0",
	nonNegative: "must be 0 or more",
};

function ruleViolated(rule: NumberRule, value: number): boolean {
	if (rule === "positive") return value <= 0;
	if (rule === "positiveInt") return value <= 0 || !Number.isInteger(value);
	return value < 0;
}

/** A time cell may arrive as text, an Excel time-of-day fraction, or a date-typed cell. */
function normalizeTime(raw: unknown): string | null {
	if (raw instanceof Date) {
		return Number.isNaN(raw.getTime())
			? null
			: formatClock(raw.getUTCHours() * 60 + raw.getUTCMinutes());
	}
	if (typeof raw === "number") {
		return raw >= 0 && raw < 1 ? formatClock(Math.round(raw * 1440)) : null;
	}
	const minutes = parseClock(String(raw ?? ""));
	return minutes === null ? null : formatClock(minutes);
}

export interface PrepareInput {
	type: SheetType;
	headers: string[];
	rows: Record<string, unknown>[];
	/** Canonical field → exact file header the user picked in the mapping step. */
	overrides?: Record<string, string>;
	/** The reader stopped at the row limit, so `rows` is only the start of a longer sheet. */
	truncated?: boolean;
}

export function prepareImport({
	type,
	headers,
	rows,
	overrides,
	truncated = false,
}: PrepareInput): PreparedImport {
	const resolved = resolveHeaderMapping(type, headers, overrides);
	const base: PreparedImport = {
		type,
		headers: resolved.fileHeaders,
		mapping: resolved.mapping,
		unmatched: resolved.unmatched,
		totalRows: rows.length,
		validRows: 0,
		issueCount: 0,
		issues: [],
		preview: [],
		csvData: "",
		structural: null,
		schedule: null,
	};

	if (resolved.unmatched.length > 0) return { ...base, structural: "missingColumns" };
	if (rows.length === 0) return { ...base, structural: "noRows" };
	if (truncated || rows.length > IMPORT_ROW_LIMIT) return { ...base, structural: "tooManyRows" };

	const fields = TYPE_FIELDS[type].filter((field) => resolved.mapping[field.name] !== undefined);
	const issues: RowIssue[] = [];
	let issueCount = 0;
	const valid: Record<string, CellValue>[] = [];

	rows.forEach((source, index) => {
		const record: Record<string, CellValue> = {};
		let rowOk = true;
		const report = (field: string, message: string) => {
			rowOk = false;
			issueCount += 1;
			if (issues.length < MAX_REPORTED_ISSUES) issues.push({ row: index + 1, field, message });
		};

		for (const field of fields) {
			const raw = source[resolved.mapping[field.name]];
			let value: CellValue;
			if (type === "feeding_schedule" && field.name === "time") {
				const time = raw === null || raw === undefined || raw === "" ? null : normalizeTime(raw);
				if (time === null && raw !== null && raw !== undefined && raw !== "") {
					report(field.name, "must be a time such as 06:00");
					continue;
				}
				value = time;
			} else {
				const coerced = coerceCell(raw, field.kind);
				if (!coerced.ok) {
					report(field.name, coerced.message);
					continue;
				}
				value = coerced.value;
			}

			if (value === null) {
				if (field.required) report(field.name, "is required");
			} else {
				const rule = NUMBER_RULES[`${type}.${field.name}`];
				if (rule && typeof value === "number" && ruleViolated(rule, value)) {
					report(field.name, RULE_MESSAGE[rule]);
				}
			}
			record[field.name] = value;
		}
		if (rowOk) valid.push(record);
	});

	let schedule: DerivedSchedule | null = null;
	let structural: StructuralError | null = null;
	if (type === "feeding_schedule") {
		const times = valid
			.filter((row) => row.enabled !== false)
			.map((row) => parseClock(String(row.time)) as number);
		const derived = deriveSchedule(times, FEEDS_PER_DAY_MAX);
		if (derived.ok) schedule = derived.value;
		else
			structural =
				derived.reason === "empty"
					? "scheduleEmpty"
					: derived.reason === "tooMany"
						? "scheduleTooMany"
						: "scheduleUneven";
	}

	const columns = fields.map((field) => field.name);
	return {
		...base,
		validRows: valid.length,
		issueCount,
		issues,
		preview: valid.slice(0, PREVIEW_ROWS),
		structural,
		schedule,
		csvData:
			structural || valid.length === 0
				? ""
				: Papa.unparse({
						fields: columns,
						data: valid.map((row) => columns.map((c) => row[c] ?? null)),
					}),
	};
}
