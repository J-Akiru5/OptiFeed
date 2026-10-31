/**
 * XLSX and template writers (I-107). Server-side only: ExcelJS is loaded with a
 * dynamic import, so it never enters a client bundle.
 *
 * Cells are written as typed values: dates as real Excel dates, numbers as
 * numbers, text as text. A text cell is never written as a formula, so a value
 * such as `=1+1` stays inert in the workbook; the CSV writer prefixes those
 * values instead (`lib/csv.ts`).
 */
import Papa from "papaparse";
import {
	type CellValue,
	type FieldKind,
	type SheetType,
	TYPE_FIELDS,
	TYPE_NOTES,
	type TypeField,
} from "./schema";

export interface SheetData {
	type: SheetType;
	rows: Record<string, CellValue>[];
}

const COLUMN_WIDTH: Record<FieldKind, number> = {
	string: 20,
	number: 14,
	date: 24,
	boolean: 10,
	json: 36,
};

const DATE_FORMAT = "yyyy-mm-dd hh:mm:ss";

/** Sheet names are limited to 31 characters and cannot hold a few symbols. */
export function sheetName(type: SheetType): string {
	return type.slice(0, 31);
}

function cellFor(field: TypeField, value: CellValue): CellValue | Date {
	if (value === null || value === undefined) return null;
	if (field.kind === "date" && typeof value === "string") {
		const date = new Date(value);
		return Number.isNaN(date.getTime()) ? value : date;
	}
	return value;
}

async function newWorkbook() {
	const mod = await import("exceljs");
	const Excel = (mod as unknown as { default?: typeof mod }).default ?? mod;
	const workbook = new Excel.Workbook();
	workbook.creator = "PakaonAI";
	workbook.created = new Date();
	return workbook;
}

type Workbook = Awaited<ReturnType<typeof newWorkbook>>;

function addDataSheet(
	workbook: Workbook,
	name: string,
	fields: TypeField[],
	rows: Record<string, CellValue>[],
) {
	const sheet = workbook.addWorksheet(name, { views: [{ state: "frozen", ySplit: 1 }] });
	sheet.columns = fields.map((field) => ({
		header: field.name,
		key: field.name,
		width: COLUMN_WIDTH[field.kind],
		style: field.kind === "date" ? { numFmt: DATE_FORMAT } : {},
	}));
	sheet.getRow(1).font = { bold: true };
	for (const row of rows) {
		sheet.addRow(
			Object.fromEntries(
				fields.map((field) => [field.name, cellFor(field, row[field.name] ?? null)]),
			),
		);
	}
	return sheet;
}

async function toBuffer(workbook: Workbook): Promise<ArrayBuffer> {
	const data = await workbook.xlsx.writeBuffer();
	const bytes = new Uint8Array(data as ArrayBuffer);
	return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

/** One workbook, one sheet per type, columns in schema order. */
export async function buildWorkbookBuffer(sheets: SheetData[]): Promise<ArrayBuffer> {
	const workbook = await newWorkbook();
	for (const { type, rows } of sheets) {
		addDataSheet(workbook, sheetName(type), TYPE_FIELDS[type], rows);
	}
	return toBuffer(workbook);
}

/** A Data sheet (headers plus one example row) and a Notes sheet for one type. */
export async function buildTemplateWorkbookBuffer(type: SheetType): Promise<ArrayBuffer> {
	const workbook = await newWorkbook();
	const fields = TYPE_FIELDS[type];
	addDataSheet(workbook, "Data", fields, [
		Object.fromEntries(fields.map((f) => [f.name, f.example])),
	]);

	const notes = workbook.addWorksheet("Notes");
	notes.columns = [{ width: 24 }, { width: 12 }, { width: 12 }, { width: 60 }];
	notes.addRow(["Column", "Required", "Type", "Also accepted as a header"]).font = { bold: true };
	for (const field of fields) {
		notes.addRow([field.name, field.required ? "yes" : "no", field.kind, field.aliases.join(", ")]);
	}
	notes.addRow([]);
	for (const line of TYPE_NOTES[type]) notes.addRow([line]);
	return toBuffer(workbook);
}

/** The CSV template: note lines (the import skips leading `#` lines), the header row, one example row. */
export function buildTemplateCsv(type: SheetType): string {
	const fields = TYPE_FIELDS[type];
	const notes = TYPE_NOTES[type].map((line) => `# ${line}`).join("\n");
	const body = Papa.unparse({
		fields: fields.map((field) => field.name),
		data: [fields.map((field) => field.example)],
	});
	return `${notes}\n${body}\n`;
}
