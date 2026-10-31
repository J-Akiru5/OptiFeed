/**
 * Reads an uploaded import file (CSV or workbook) into the header row plus raw
 * rows that `prepareImport` expects (I-107). Server-side only.
 */
import { parseCsvTable } from "@/lib/csv";
import { MAX_IMPORT_FILE_BYTES, checkWorkbookFile, readWorkbook } from "./parser";

export interface UploadTable {
	headers: string[];
	rows: Record<string, unknown>[];
	/** A workbook with more rows than the import limit was cut at the limit. */
	truncated: boolean;
}

export type UploadResult =
	| { ok: true; table: UploadTable }
	| { ok: false; status: 400 | 413; message: string };

/**
 * `sheetHint` picks the workbook sheet by name (an export holds one sheet per
 * type); without a match the first sheet is read, which is the template's Data sheet.
 */
export async function readUploadTable(
	fileName: string,
	bytes: Uint8Array,
	sheetHint: string,
): Promise<UploadResult> {
	if (bytes.byteLength > MAX_IMPORT_FILE_BYTES) {
		return { ok: false, status: 413, message: "The file is over the 5 MB import limit." };
	}

	const lower = fileName.toLowerCase();
	if (lower.endsWith(".csv")) {
		const { headers, rows } = parseCsvTable(new TextDecoder().decode(bytes));
		return { ok: true, table: { headers, rows, truncated: false } };
	}
	if (!/\.(xlsx|xlsm|xlsb|xls)$/.test(lower)) {
		return { ok: false, status: 400, message: "Upload a .csv or .xlsx file." };
	}

	const checked = checkWorkbookFile(fileName, bytes);
	if (!checked.ok) {
		return {
			ok: false,
			status: checked.failure.code === "oversized" ? 413 : 400,
			message: checked.failure.message,
		};
	}
	try {
		const sheet = await readWorkbook(checked.buffer, sheetHint);
		return {
			ok: true,
			table: { headers: sheet.headers, rows: sheet.rows, truncated: sheet.tooManyRows },
		};
	} catch {
		return {
			ok: false,
			status: 400,
			message: "The workbook could not be read. Save it again as .xlsx and retry.",
		};
	}
}
