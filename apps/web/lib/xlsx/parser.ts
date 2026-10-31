/**
 * XLSX workbook reader for imports (I-107). Server-side only: ExcelJS is loaded
 * with a dynamic import inside the reader, so it never enters a client bundle.
 *
 * Every guard runs on the raw bytes before any XML is parsed:
 *  - `.xlsx` only: `.xlsm`/`.xlsb`/`.xls` are refused by name, and a package
 *    holding a macro, ActiveX or external-link part is refused by content;
 *  - an encrypted workbook (an OLE container, not a ZIP) is refused by magic bytes;
 *  - the upload is capped at the same 5 MB the CSV path uses;
 *  - the ZIP central directory is read by hand, without decompressing, to cap
 *    the entry count, the total uncompressed size and the expansion ratio, so a
 *    zip bomb costs a bounded peek and never reaches the XML parser;
 *  - formulas are never evaluated: a formula cell contributes its cached result.
 */
import { IMPORT_ROW_LIMIT } from "@/lib/constants";

export const MAX_IMPORT_FILE_BYTES = 5 * 1024 * 1024;
export const MAX_XLSX_ENTRIES = 1_000;
export const MAX_XLSX_UNCOMPRESSED_BYTES = 50 * 1024 * 1024;
/** Real sheet XML compresses 10-20x; a ratio past this is a bomb marker. */
export const MAX_XLSX_EXPANSION_RATIO = 200;
/** Columns read from the header row; a wider sheet is not a data sheet. */
export const MAX_XLSX_COLUMNS = 100;

const MACRO_PARTS = ["vbaproject", "activex", "externallink", "macrosheets"];

export type WorkbookFailureCode =
	| "extension"
	| "format"
	| "encrypted"
	| "oversized"
	| "bomb"
	| "macro";

export interface WorkbookFailure {
	code: WorkbookFailureCode;
	message: string;
}

export type WorkbookCheck = { ok: true; buffer: Buffer } | { ok: false; failure: WorkbookFailure };

interface ZipEntry {
	name: string;
	compressedSize: number;
	uncompressedSize: number;
}

const refuse = (code: WorkbookFailureCode, message: string): WorkbookCheck => ({
	ok: false,
	failure: { code, message },
});

/** Locate the end-of-central-directory record and list the entries. Null when it is not a plain ZIP. */
export function readZipEntries(buffer: Buffer): ZipEntry[] | null {
	const lowest = Math.max(0, buffer.length - 65_557);
	let eocd = -1;
	for (let i = buffer.length - 22; i >= lowest; i -= 1) {
		if (buffer.readUInt32LE(i) === 0x06054b50) {
			eocd = i;
			break;
		}
	}
	if (eocd === -1) return null;

	const count = buffer.readUInt16LE(eocd + 10);
	const size = buffer.readUInt32LE(eocd + 12);
	// ZIP64 markers: workbooks that need them are far beyond the 5 MB cap.
	if (count === 0xffff || size === 0xffffffff) return null;

	let offset = eocd - size;
	if (offset < 0) return null;
	const entries: ZipEntry[] = [];
	for (let i = 0; i < count; i += 1) {
		if (offset + 46 > buffer.length || buffer.readUInt32LE(offset) !== 0x02014b50) return null;
		const nameLength = buffer.readUInt16LE(offset + 28);
		const extraLength = buffer.readUInt16LE(offset + 30);
		const commentLength = buffer.readUInt16LE(offset + 32);
		entries.push({
			name: buffer.subarray(offset + 46, offset + 46 + nameLength).toString("latin1"),
			compressedSize: buffer.readUInt32LE(offset + 20),
			uncompressedSize: buffer.readUInt32LE(offset + 24),
		});
		offset += 46 + nameLength + extraLength + commentLength;
	}
	return entries;
}

/** Guard the upload using only its name and bytes. */
export function checkWorkbookFile(fileName: string, bytes: Uint8Array): WorkbookCheck {
	if (!fileName.toLowerCase().endsWith(".xlsx")) {
		return refuse(
			"extension",
			"Only .xlsx workbooks are accepted; macro-enabled (.xlsm) and older Excel formats are refused.",
		);
	}
	if (bytes.byteLength > MAX_IMPORT_FILE_BYTES) {
		return refuse("oversized", "The workbook is over the 5 MB import limit.");
	}

	const buffer = Buffer.from(bytes);
	if (buffer.length >= 4 && buffer.readUInt32BE(0) === 0xd0cf11e0) {
		return refuse(
			"encrypted",
			"Password-protected workbooks are not supported. Save an unprotected copy.",
		);
	}
	const entries =
		buffer.length >= 4 && buffer[0] === 0x50 && buffer[1] === 0x4b ? readZipEntries(buffer) : null;
	if (!entries) return refuse("format", "The file is not a valid .xlsx workbook.");

	if (entries.length > MAX_XLSX_ENTRIES) {
		return refuse("bomb", "The workbook holds too many parts to import.");
	}
	let total = 0;
	for (const entry of entries) {
		const name = entry.name.toLowerCase();
		if (MACRO_PARTS.some((part) => name.includes(part))) {
			return refuse("macro", "Macro-enabled or externally linked workbooks are refused.");
		}
		total += entry.uncompressedSize;
		const ratio = entry.compressedSize > 0 ? entry.uncompressedSize / entry.compressedSize : 0;
		if (ratio > MAX_XLSX_EXPANSION_RATIO) {
			return refuse("bomb", "The workbook expands more than allowed; import refused.");
		}
	}
	if (total > MAX_XLSX_UNCOMPRESSED_BYTES) {
		return refuse("bomb", "The workbook is too large once unpacked; import refused.");
	}
	return { ok: true, buffer };
}

/** A workbook cell reduced to a cached primitive. Formulas are never evaluated. */
export function readCellValue(value: unknown): string | number | boolean | Date | null {
	if (value === null || value === undefined) return null;
	if (typeof value === "number") return Number.isFinite(value) ? value : null;
	if (typeof value === "string" || typeof value === "boolean") return value;
	if (value instanceof Date) return value;
	if (typeof value === "object") {
		const cell = value as Record<string, unknown>;
		if ("formula" in cell || "sharedFormula" in cell || "result" in cell) {
			return readCellValue(cell.result);
		}
		if (Array.isArray(cell.richText)) {
			return (cell.richText as { text?: string }[]).map((part) => part.text ?? "").join("");
		}
		if ("text" in cell) return readCellValue(cell.text);
		if ("error" in cell) return String(cell.error);
	}
	return String(value);
}

export interface RawSheet {
	sheetName: string;
	headers: string[];
	rows: Record<string, unknown>[];
	/** More data rows than the import limit were present; only the first limit + 1 were read. */
	tooManyRows: boolean;
}

/**
 * Read the sheet named `sheetHint` (case-insensitive) or else the first sheet:
 * row 1 is the header row, every later non-empty row is a data row.
 */
export async function readWorkbook(buffer: Buffer, sheetHint?: string): Promise<RawSheet> {
	const mod = await import("exceljs");
	const Excel = (mod as unknown as { default?: typeof mod }).default ?? mod;
	const workbook = new Excel.Workbook();
	// ExcelJS types `load` against its own Buffer declaration.
	await workbook.xlsx.load(buffer as unknown as Parameters<typeof workbook.xlsx.load>[0]);

	const hint = sheetHint?.toLowerCase();
	const sheet =
		workbook.worksheets.find((candidate) => candidate.name.toLowerCase() === hint) ??
		workbook.worksheets[0];
	if (!sheet) return { sheetName: "", headers: [], rows: [], tooManyRows: false };

	const columns = Math.min(sheet.columnCount, MAX_XLSX_COLUMNS);
	const headers: string[] = [];
	const headerRow = sheet.getRow(1);
	for (let column = 1; column <= columns; column += 1) {
		const value = readCellValue(headerRow.getCell(column).value);
		headers.push(value === null ? "" : String(value).trim());
	}

	const rows: Record<string, unknown>[] = [];
	let tooManyRows = false;
	sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
		if (rowNumber === 1 || tooManyRows) return;
		const record: Record<string, unknown> = {};
		let any = false;
		headers.forEach((header, index) => {
			if (header === "") return;
			const value = readCellValue(row.getCell(index + 1).value);
			record[header] = value;
			if (value !== null && value !== "") any = true;
		});
		if (!any) return;
		if (rows.length >= IMPORT_ROW_LIMIT) {
			tooManyRows = true;
			return;
		}
		rows.push(record);
	});

	return {
		sheetName: sheet.name,
		headers: headers.filter((header) => header !== ""),
		rows,
		tooManyRows,
	};
}
