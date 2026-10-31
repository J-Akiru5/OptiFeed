// @vitest-environment node
import { parseCsvString } from "@/lib/csv";
import { deriveSchedule, feedingSlotMinutes, formatClock, parseClock } from "@/lib/schedule/slots";
import { MAX_XLSX_UNCOMPRESSED_BYTES, checkWorkbookFile, readWorkbook } from "@/lib/xlsx/parser";
import { prepareImport } from "@/lib/xlsx/prepare";
import {
	TYPE_FIELDS,
	canonicalizeHeader,
	excelSerialToIso,
	resolveHeaderMapping,
	unescapeFormulaInjection,
} from "@/lib/xlsx/schema";
import {
	buildTemplateCsv,
	buildTemplateWorkbookBuffer,
	buildWorkbookBuffer,
} from "@/lib/xlsx/writer";
import JSZip from "jszip";
import { describe, expect, it } from "vitest";

const BIOMASS_HEADERS = ["Sample Weight (kg)", "Sample_Count", "Sample Length (cm)", "Date"];

describe("header mapping", () => {
	it("matches aliases without regard to case, spaces, underscores or unit hints", () => {
		const result = resolveHeaderMapping("biomass_logs", BIOMASS_HEADERS);
		expect(result.unmatched).toEqual([]);
		expect(result.mapping).toMatchObject({
			sampleWeightKg: "Sample Weight (kg)",
			sampleCount: "Sample_Count",
			sampleLengthCm: "Sample Length (cm)",
			recordedAt: "Date",
		});
		expect(canonicalizeHeader(" Weight_(g) ")).toBe("weightg");
	});

	it("reports the required fields that no header matches", () => {
		const result = resolveHeaderMapping("fcr_reports", ["Start", "End", "Feed"]);
		expect(result.unmatched).toEqual([
			"periodStart",
			"periodEnd",
			"totalFeedKg",
			"biomassGainKg",
			"fcrValue",
		]);
	});

	it("lets a hand-picked header win and ignores a header the file does not have", () => {
		const headers = ["Start", "End", "Feed", "Gain", "Ratio"];
		const result = resolveHeaderMapping("fcr_reports", headers, {
			periodStart: "Start",
			periodEnd: "End",
			totalFeedKg: "Feed",
			biomassGainKg: "Gain",
			fcrValue: "Ratio",
			id: "Nope",
		});
		expect(result.unmatched).toEqual([]);
		expect(result.mapping.fcrValue).toBe("Ratio");
		expect(result.mapping.id).toBeUndefined();
	});
});

describe("prepareImport", () => {
	const headers = ["sampleWeightKg", "sampleCount", "sampleLengthCm"];

	it("returns canonical CSV for clean rows", () => {
		const result = prepareImport({
			type: "biomass_logs",
			headers,
			rows: [
				{ sampleWeightKg: 10, sampleCount: 5, sampleLengthCm: 22 },
				{ sampleWeightKg: "7.5", sampleCount: "3", sampleLengthCm: "" },
			],
		});
		expect(result.structural).toBeNull();
		expect(result.validRows).toBe(2);
		expect(result.issues).toEqual([]);
		const parsed = parseCsvString(result.csvData).data;
		expect(parsed[0]).toMatchObject({
			sampleWeightKg: "10",
			sampleCount: "5",
			sampleLengthCm: "22",
		});
		expect(parsed[1]).toMatchObject({
			sampleWeightKg: "7.5",
			sampleCount: "3",
			sampleLengthCm: "",
		});
	});

	it("asks for a mapping instead of guessing when a required header is missing", () => {
		const result = prepareImport({
			type: "biomass_logs",
			headers: ["Weight", "Fish"],
			rows: [{ Weight: 1, Fish: 2 }],
		});
		expect(result.structural).toBe("missingColumns");
		expect(result.unmatched).toEqual(["sampleWeightKg", "sampleCount"]);
		expect(result.headers).toEqual(["Weight", "Fish"]);
		expect(result.csvData).toBe("");

		const mapped = prepareImport({
			type: "biomass_logs",
			headers: ["Weight", "Fish"],
			rows: [{ Weight: 1, Fish: 2 }],
			overrides: { sampleWeightKg: "Weight", sampleCount: "Fish" },
		});
		expect(mapped.structural).toBeNull();
		expect(mapped.validRows).toBe(1);
	});

	it("lists row errors and keeps only the valid rows in the CSV", () => {
		const result = prepareImport({
			type: "biomass_logs",
			headers,
			rows: [
				{ sampleWeightKg: 10, sampleCount: 5, sampleLengthCm: 22 },
				{ sampleWeightKg: "abc", sampleCount: 5, sampleLengthCm: 1 },
				{ sampleWeightKg: 4, sampleCount: 2.5, sampleLengthCm: 1 },
				{ sampleWeightKg: -1, sampleCount: 5, sampleLengthCm: 1 },
				{ sampleWeightKg: 3, sampleCount: null, sampleLengthCm: 1 },
			],
		});
		expect(result.totalRows).toBe(5);
		expect(result.validRows).toBe(1);
		expect(result.issues).toEqual([
			{ row: 2, field: "sampleWeightKg", message: "must be a number" },
			{ row: 3, field: "sampleCount", message: "must be a whole number greater than 0" },
			{ row: 4, field: "sampleWeightKg", message: "must be greater than 0" },
			{ row: 5, field: "sampleCount", message: "is required" },
		]);
		expect(parseCsvString(result.csvData).data).toHaveLength(1);
	});

	it("reads Excel dates, date serials, booleans and escaped text", () => {
		const result = prepareImport({
			type: "notifications",
			headers: ["tier", "message", "read", "createdAt"],
			rows: [
				{
					tier: "info",
					message: "'=SUM(A1)",
					read: "false",
					createdAt: new Date("2026-03-02T04:00:00Z"),
				},
				{ tier: "info", message: "x", read: 1, createdAt: 46083.25 },
				{ tier: "info", message: "y", read: "maybe", createdAt: "not a date" },
			],
		});
		expect(result.validRows).toBe(2);
		expect(result.issues.map((issue) => `${issue.row}:${issue.field}`)).toEqual([
			"3:read",
			"3:createdAt",
		]);
		const rows = parseCsvString(result.csvData).data;
		expect(rows[0]).toMatchObject({
			message: "=SUM(A1)",
			read: "false",
			createdAt: "2026-03-02T04:00:00.000Z",
		});
		expect(rows[1].read).toBe("true");
		expect(String(rows[1].createdAt)).toBe(excelSerialToIso(46083.25));
		expect(unescapeFormulaInjection("'-5")).toBe("-5");
		expect(unescapeFormulaInjection("'plain")).toBe("'plain");
	});

	it("refuses more rows than the import limit and an empty file", () => {
		const many = Array.from({ length: 5001 }, () => ({ sampleWeightKg: 1, sampleCount: 1 }));
		expect(prepareImport({ type: "biomass_logs", headers, rows: many }).structural).toBe(
			"tooManyRows",
		);
		expect(prepareImport({ type: "biomass_logs", headers, rows: [] }).structural).toBe("noRows");
	});

	it("ignores columns the schema does not know", () => {
		const result = prepareImport({
			type: "fish_samples",
			headers: ["biomassLogId", "weightGrams", "Comments"],
			rows: [{ biomassLogId: "b1", weightGrams: 100, Comments: "hi" }],
		});
		expect(result.csvData.split(/\r?\n/)[0]).toBe("biomassLogId,weightGrams");
	});
});

describe("feeding schedule sheet", () => {
	const headers = ["time", "grams", "enabled"];

	it("derives the window and meal count from evenly spaced times", () => {
		const result = prepareImport({
			type: "feeding_schedule",
			headers,
			rows: [
				{ time: "06:00", grams: 150, enabled: true },
				{ time: "09:00", grams: 150, enabled: true },
				{ time: "12:00", grams: 150, enabled: true },
				{ time: "15:00", grams: 150, enabled: true },
				{ time: "18:00", grams: 150, enabled: false },
			],
		});
		expect(result.structural).toBeNull();
		expect(result.schedule).toEqual({
			scheduleStart: "06:00",
			scheduleEnd: "15:00",
			feedsPerDay: 4,
		});
	});

	it("reads Excel time fractions and date-typed time cells", () => {
		const result = prepareImport({
			type: "feeding_schedule",
			headers,
			rows: [{ time: 0.25 }, { time: new Date("1899-12-30T12:00:00Z") }],
		});
		expect(result.issues).toEqual([]);
		expect(result.schedule).toEqual({
			scheduleStart: "06:00",
			scheduleEnd: "12:00",
			feedsPerDay: 2,
		});
	});

	it("refuses uneven spacing, an empty schedule and more than 24 meals", () => {
		const uneven = prepareImport({
			type: "feeding_schedule",
			headers,
			rows: [{ time: "06:00" }, { time: "07:00" }, { time: "12:00" }],
		});
		expect(uneven.structural).toBe("scheduleUneven");

		const none = prepareImport({
			type: "feeding_schedule",
			headers,
			rows: [{ time: "06:00", enabled: false }],
		});
		expect(none.structural).toBe("scheduleEmpty");

		const tooMany = prepareImport({
			type: "feeding_schedule",
			headers,
			rows: Array.from({ length: 25 }, (_, i) => ({ time: formatClock(i * 30) })),
		});
		expect(tooMany.structural).toBe("scheduleTooMany");
	});

	it("flags a malformed time on its row", () => {
		const result = prepareImport({
			type: "feeding_schedule",
			headers,
			rows: [{ time: "6 o'clock" }, { time: "06:00" }],
		});
		expect(result.issues).toEqual([
			{ row: 1, field: "time", message: "must be a time such as 06:00" },
		]);
	});

	it("round-trips the device's own slot spacing, including past midnight", () => {
		for (const [start, end, feeds] of [
			[360, 1080, 4],
			[1320, 360, 3],
			[420, 420, 1],
			[360, 1080, 7],
		] as const) {
			const slots = feedingSlotMinutes(start, end, feeds);
			const derived = deriveSchedule(slots, 24);
			expect(derived.ok).toBe(true);
			if (derived.ok) {
				expect(derived.value.feedsPerDay).toBe(feeds);
				expect(parseClock(derived.value.scheduleStart)).toBe(start % 1440);
				expect(parseClock(derived.value.scheduleEnd)).toBe(end % 1440);
			}
		}
	});
});

describe("workbook guards", () => {
	async function zipWith(entries: Record<string, string | Buffer>): Promise<Uint8Array> {
		const zip = new JSZip();
		for (const [name, data] of Object.entries(entries)) zip.file(name, data);
		return zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
	}

	it("accepts a workbook this app wrote", async () => {
		const bytes = new Uint8Array(await buildWorkbookBuffer([{ type: "fcr_reports", rows: [] }]));
		expect(checkWorkbookFile("export.xlsx", bytes).ok).toBe(true);
	});

	it("refuses macro files and other extensions by name", () => {
		for (const name of ["a.xlsm", "a.xls", "a.xlsb", "a.csv", "a"]) {
			const result = checkWorkbookFile(name, new Uint8Array(10));
			expect(result.ok).toBe(false);
			if (!result.ok) expect(result.failure.code).toBe("extension");
		}
	});

	it("refuses a package that carries a macro part", async () => {
		const bytes = await zipWith({ "[Content_Types].xml": "<x/>", "xl/vbaProject.bin": "binary" });
		const result = checkWorkbookFile("a.xlsx", bytes);
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.failure.code).toBe("macro");
	});

	it("refuses encrypted (OLE) files and non-zip content", () => {
		const ole = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0, 0, 0, 0]);
		const encrypted = checkWorkbookFile("a.xlsx", ole);
		expect(encrypted.ok).toBe(false);
		if (!encrypted.ok) expect(encrypted.failure.code).toBe("encrypted");

		const text = checkWorkbookFile("a.xlsx", new TextEncoder().encode("id,name\n1,x\n"));
		expect(text.ok).toBe(false);
		if (!text.ok) expect(text.failure.code).toBe("format");
	});

	it("refuses an oversized upload before reading it", () => {
		const result = checkWorkbookFile("a.xlsx", new Uint8Array(5 * 1024 * 1024 + 1));
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.failure.code).toBe("oversized");
	});

	it("refuses a zip bomb from the central directory alone", async () => {
		const bytes = await zipWith({ "xl/worksheets/sheet1.xml": Buffer.alloc(20 * 1024 * 1024, 0) });
		expect(bytes.byteLength).toBeLessThan(MAX_XLSX_UNCOMPRESSED_BYTES);
		const result = checkWorkbookFile("a.xlsx", bytes);
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.failure.code).toBe("bomb");
	});
});

describe("workbook round trip", () => {
	it("exports every type's headers and reads the rows back the same", async () => {
		const rows = [
			{
				id: "log-1",
				pondId: "pond-1",
				sampleWeightKg: 10.5,
				sampleLengthCm: 22,
				sampleCount: 5,
				avgWeightKg: 2.1,
				batchLabel: "=Batch 1",
				recordedAt: "2026-03-02T04:00:00.000Z",
			},
		];
		const buffer = Buffer.from(await buildWorkbookBuffer([{ type: "biomass_logs", rows }]));
		const checked = checkWorkbookFile("round.xlsx", buffer);
		expect(checked.ok).toBe(true);
		if (!checked.ok) return;

		const sheet = await readWorkbook(checked.buffer, "biomass_logs");
		expect(sheet.headers).toEqual(TYPE_FIELDS.biomass_logs.map((field) => field.name));
		const prepared = prepareImport({
			type: "biomass_logs",
			headers: sheet.headers,
			rows: sheet.rows,
		});
		expect(prepared.structural).toBeNull();
		expect(prepared.issues).toEqual([]);
		const back = parseCsvString(prepared.csvData).data[0];
		expect(back).toMatchObject({
			id: "log-1",
			sampleWeightKg: "10.5",
			sampleCount: "5",
			batchLabel: "=Batch 1",
			recordedAt: "2026-03-02T04:00:00.000Z",
		});
	});

	it("picks the sheet named like the type, else the first", async () => {
		const buffer = Buffer.from(
			await buildWorkbookBuffer([
				{ type: "fcr_reports", rows: [] },
				{ type: "feed_level_logs", rows: [{ levelPercent: 50, distanceCm: 10 }] },
			]),
		);
		const named = await readWorkbook(buffer, "feed_level_logs");
		expect(named.sheetName).toBe("feed_level_logs");
		expect(named.rows).toHaveLength(1);
		const first = await readWorkbook(buffer);
		expect(first.sheetName).toBe("fcr_reports");
	});

	it("reads a formula's cached result and never evaluates it", async () => {
		const mod = await import("exceljs");
		const Excel = (mod as unknown as { default?: typeof mod }).default ?? mod;
		const workbook = new Excel.Workbook();
		const sheet = workbook.addWorksheet("Data");
		sheet.addRow(["levelPercent", "distanceCm"]);
		sheet.addRow([{ formula: "40+10", result: 50 }, 18]);
		sheet.addRow([{ formula: "1+1" }, 3]);
		const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
		const read = await readWorkbook(buffer, "Data");
		expect(read.rows[0].levelPercent).toBe(50);
		expect(read.rows[1].levelPercent).toBeNull();
	});

	it("fills merged cells from their master and skips blank rows", async () => {
		const mod = await import("exceljs");
		const Excel = (mod as unknown as { default?: typeof mod }).default ?? mod;
		const workbook = new Excel.Workbook();
		const sheet = workbook.addWorksheet("Data");
		sheet.addRow(["tier", "message"]);
		sheet.addRow(["info", "same"]);
		sheet.addRow(["info", null]);
		sheet.mergeCells("B2:B3");
		sheet.addRow([null, null]);
		sheet.addRow(["warn", "other"]);
		const read = await readWorkbook(Buffer.from(await workbook.xlsx.writeBuffer()), "Data");
		expect(read.rows.map((row) => row.message)).toEqual(["same", "same", "other"]);
	});

	it("stops reading past the import limit", async () => {
		const rows = Array.from({ length: 5002 }, (_, i) => ({ levelPercent: i % 100, distanceCm: 1 }));
		const buffer = Buffer.from(await buildWorkbookBuffer([{ type: "feed_level_logs", rows }]));
		const read = await readWorkbook(buffer, "feed_level_logs");
		expect(read.tooManyRows).toBe(true);
		expect(read.rows).toHaveLength(5000);
	});
});

describe("templates", () => {
	it("writes a CSV template the importer accepts as is", () => {
		const csv = buildTemplateCsv("fcr_reports");
		expect(csv.startsWith("# ")).toBe(true);
		const parsed = parseCsvString(csv);
		expect(parsed.data).toHaveLength(1);
		const prepared = prepareImport({
			type: "fcr_reports",
			headers: Object.keys(parsed.data[0]),
			rows: parsed.data,
		});
		expect(prepared.structural).toBeNull();
		expect(prepared.issues).toEqual([]);
	});

	it("writes a workbook template with a Data and a Notes sheet that imports cleanly", async () => {
		const buffer = Buffer.from(await buildTemplateWorkbookBuffer("biomass_logs"));
		const read = await readWorkbook(buffer, "Data");
		expect(read.sheetName).toBe("Data");
		const prepared = prepareImport({
			type: "biomass_logs",
			headers: read.headers,
			rows: read.rows,
		});
		expect(prepared.structural).toBeNull();
		expect(prepared.validRows).toBe(1);
	});
});
