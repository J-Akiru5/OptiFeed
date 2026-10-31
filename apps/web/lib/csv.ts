import Papa from "papaparse";

export type ExportableType =
	| "biomass_logs"
	| "fish_samples"
	| "feed_events"
	| "fcr_reports"
	| "feed_level_logs"
	| "notifications"
	| "audit_events";

export const EXPORT_LABELS: Record<ExportableType, string> = {
	biomass_logs: "Biomass Logs",
	fish_samples: "Fish Samples",
	feed_events: "Feed Events",
	fcr_reports: "FCR Reports",
	feed_level_logs: "Feed Level Logs",
	notifications: "Notifications",
	audit_events: "Audit Events",
};

interface CsvRow {
	[key: string]: string | number | boolean | null;
}

/**
 * Spreadsheet formula injection (I-107): a text cell starting with = + - @,
 * tab or CR could execute as a formula when the file is opened in Excel.
 * The leading apostrophe is Excel's own safe-escape convention.
 */
export function escapeFormulaInjection(value: string): string {
	return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}

export function toCsvString(rows: CsvRow[]): string {
	if (rows.length === 0) return "";
	const escaped = rows.map((row) => {
		const next: CsvRow = {};
		for (const [key, value] of Object.entries(row)) {
			next[key] = typeof value === "string" ? escapeFormulaInjection(value) : value;
		}
		return next;
	});
	return Papa.unparse(escaped);
}

export function parseCsvString(csv: string): { data: CsvRow[]; errors: Papa.ParseError[] } {
	// The downloadable CSV template adds its notes as leading `#` comment
	// lines; they are not data. Skipped only while the file has not reached
	// its first real line yet, so a note inside the data still imports.
	const lines = csv.split(/\r?\n/);
	let index = 0;
	while (index < lines.length && lines[index].startsWith("#")) index += 1;
	const body = index > 0 ? lines.slice(index).join("\n") : csv;

	const result = Papa.parse(body, {
		header: true,
		skipEmptyLines: true,
		dynamicTyping: false,
	});

	const typedData = (result.data as Record<string, unknown>[]).filter((row) =>
		Object.values(row).every(
			(v) => v === null || typeof v === "string" || typeof v === "number" || typeof v === "boolean",
		),
	);
	const errors = [...result.errors];
	if (typedData.length < result.data.length) {
		errors.push({
			type: "FieldMismatch",
			row: -1,
			message: `${result.data.length - typedData.length} row(s) dropped due to unexpected value types`,
		} as Papa.ParseError);
	}

	return { data: typedData as CsvRow[], errors };
}

export function downloadCsv(filename: string, csvString: string) {
	const blob = new Blob([csvString], { type: "text/csv;charset=utf-8;" });
	const url = URL.createObjectURL(blob);
	const link = document.createElement("a");
	link.href = url;
	link.download = filename;
	link.click();
	URL.revokeObjectURL(url);
}

export function buildFilename(type: ExportableType, date?: Date): string {
	const d = date ?? new Date();
	const ts = d.toISOString().slice(0, 10);
	return `optifeed_${type}_${ts}.csv`;
}
