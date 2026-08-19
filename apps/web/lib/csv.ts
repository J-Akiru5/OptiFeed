import Papa from "papaparse";

export type ExportableType =
	| "biomass_logs"
	| "feed_events"
	| "fcr_reports"
	| "feed_level_logs"
	| "notifications"
	| "audit_events";

export const EXPORT_LABELS: Record<ExportableType, string> = {
	biomass_logs: "Biomass Logs",
	feed_events: "Feed Events",
	fcr_reports: "FCR Reports",
	feed_level_logs: "Feed Level Logs",
	notifications: "Notifications",
	audit_events: "Audit Events",
};

interface CsvRow {
	[key: string]: string | number | boolean | null;
}

export function toCsvString(rows: CsvRow[]): string {
	if (rows.length === 0) return "";
	return Papa.unparse(rows);
}

export function parseCsvString(csv: string): { data: CsvRow[]; errors: Papa.ParseError[] } {
	const result = Papa.parse(csv, {
		header: true,
		skipEmptyLines: true,
		dynamicTyping: true,
	});
	return { data: result.data as CsvRow[], errors: result.errors };
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
