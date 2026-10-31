import { notFound } from "@/lib/api/errors";
import { resolveActivePond } from "@/lib/auth/pond-access";
import { dateToFarmDateOnly } from "@/lib/crop-cycle/dates";
import type { ExportArtifact } from "@/lib/jobs/export-data";
import { formatFarmDate, safeFilenamePart } from "@/lib/jobs/pdf-export";
import prisma from "@/lib/prisma";
import { averageDailyGain, elapsedFarmDays, overallSgr, sgrSeries } from "@/lib/sgr";
import type { PdfReport } from "@/lib/xlsx/schema";
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";

/**
 * Growth, SGR and FCR summary reports (I-107): a header, the headline figures,
 * one line chart drawn straight into the page, and the table behind it. The
 * figures come from the same helpers the dashboard uses (`lib/sgr.ts` and the
 * stored FCR reports), so the PDF cannot disagree with the screen.
 */

export type ReportKind = Exclude<PdfReport, "summary">;

interface JsPDFWithAutoTable extends jsPDF {
	lastAutoTable?: { finalY: number };
}

interface ChartPoint {
	label: string;
	value: number;
}

const NAVY: [number, number, number] = [10, 61, 98];
const ORANGE: [number, number, number] = [232, 90, 42];
const GRID: [number, number, number] = [220, 226, 230];
const MAX_CHART_POINTS = 40;
const MAX_TABLE_ROWS = 30;

const REPORT_TITLE: Record<ReportKind, string> = {
	growth: "Growth report",
	sgr: "SGR report",
	fcr: "FCR report",
};

const REPORT_FORMULA: Record<ReportKind, string> = {
	growth: "Average weight is the mean body weight per fish of each sampling.",
	sgr: "SGR (%/day) = 100 x (ln W2 - ln W1) / days, with W the average weight per fish and days counted in farm calendar days.",
	fcr: "FCR = feed given (kg) / biomass gained (kg). Lower is better.",
};

function twoDecimals(value: number | null | undefined): string {
	return value === null || value === undefined || !Number.isFinite(value) ? "-" : value.toFixed(2);
}

function oneDecimal(value: number | null | undefined): string {
	return value === null || value === undefined || !Number.isFinite(value) ? "-" : value.toFixed(1);
}

/** A plain line chart: light grid, three y labels, first/middle/last x labels, a marker per point. */
export function drawLineChart(
	doc: jsPDF,
	box: { x: number; y: number; width: number; height: number },
	points: ChartPoint[],
	options: { title: string; unit: string },
): void {
	const { x, y, width, height } = box;
	doc.setFontSize(11);
	doc.setTextColor(...NAVY);
	doc.text(options.title, x, y - 3);

	const left = x + 14;
	const plotWidth = width - 18;
	const plotHeight = height - 14;
	const top = y;
	const bottom = y + plotHeight;

	doc.setDrawColor(...GRID);
	doc.setLineWidth(0.2);
	doc.setFontSize(7);
	doc.setTextColor(100);

	if (points.length === 0) {
		doc.rect(left, top, plotWidth, plotHeight);
		doc.text("Not enough data to draw this chart yet.", left + 4, top + plotHeight / 2);
		return;
	}

	const values = points.map((point) => point.value);
	let min = Math.min(...values);
	let max = Math.max(...values);
	if (min === max) {
		min -= 1;
		max += 1;
	}
	const pad = (max - min) * 0.1;
	min -= pad;
	max += pad;
	const yFor = (value: number) => bottom - ((value - min) / (max - min)) * plotHeight;
	const xFor = (index: number) =>
		points.length === 1 ? left + plotWidth / 2 : left + (index / (points.length - 1)) * plotWidth;

	for (const fraction of [0, 0.5, 1]) {
		const value = min + (max - min) * fraction;
		const lineY = yFor(value);
		doc.line(left, lineY, left + plotWidth, lineY);
		doc.text(value.toFixed(2), left - 2, lineY + 1, { align: "right" });
	}
	doc.setDrawColor(...ORANGE);
	doc.setLineWidth(0.6);
	for (let index = 1; index < points.length; index += 1) {
		doc.line(
			xFor(index - 1),
			yFor(points[index - 1].value),
			xFor(index),
			yFor(points[index].value),
		);
	}
	doc.setFillColor(...ORANGE);
	for (let index = 0; index < points.length; index += 1) {
		doc.circle(xFor(index), yFor(points[index].value), 0.7, "F");
	}

	doc.setTextColor(100);
	const labelIndexes = [...new Set([0, Math.floor((points.length - 1) / 2), points.length - 1])];
	for (const index of labelIndexes) {
		doc.text(points[index].label, xFor(index), bottom + 5, { align: "center" });
	}
	doc.text(`Unit: ${options.unit}`, left + plotWidth, bottom + 10, { align: "right" });
}

function sectionTitle(doc: JsPDFWithAutoTable, text: string, y: number): void {
	doc.setFontSize(13);
	doc.setTextColor(...NAVY);
	doc.text(text, 14, y);
}

export async function buildReportPdf(ownerId: string, kind: ReportKind): Promise<ExportArtifact> {
	const pond = await resolveActivePond(ownerId);
	if (!pond) throw notFound("No pond found.");

	const doc = new jsPDF() as JsPDFWithAutoTable;
	const pageWidth = doc.internal.pageSize.getWidth();

	doc.setFontSize(20);
	doc.setTextColor(...NAVY);
	doc.text(`PakaonAI ${REPORT_TITLE[kind]}`, 14, 22);
	doc.setFontSize(10);
	doc.setTextColor(100);
	doc.text(`Pond: ${pond.name}  |  Generated: ${formatFarmDate(new Date())} (Asia/Manila)`, 14, 30);
	doc.setDrawColor(...ORANGE);
	doc.setLineWidth(0.5);
	doc.line(14, 34, pageWidth - 14, 34);

	let summary: [string, string][] = [];
	let chart: { title: string; unit: string; points: ChartPoint[] } = {
		title: "",
		unit: "",
		points: [],
	};
	let head: string[] = [];
	let body: string[][] = [];
	let emptyMessage = "";

	if (kind === "fcr") {
		const reports = await prisma.fcrReport.findMany({
			where: { pondId: pond.id },
			orderBy: { periodEnd: "desc" },
			take: 200,
		});
		reports.reverse();
		const totalFeed = reports.reduce((sum, report) => sum + (report.totalFeedKg ?? 0), 0);
		const totalGain = reports.reduce((sum, report) => sum + (report.biomassGainKg ?? 0), 0);
		const fcrValues = reports.map((report) => report.fcrValue).filter(Number.isFinite);
		const latest = reports.at(-1);
		summary = [
			["Reports", `${reports.length}`],
			["Latest FCR", twoDecimals(latest?.fcrValue)],
			[
				"Latest period",
				latest
					? `${formatFarmDate(latest.periodStart)} - ${formatFarmDate(latest.periodEnd)}`
					: "-",
			],
			["Best FCR (lowest)", twoDecimals(fcrValues.length ? Math.min(...fcrValues) : null)],
			["Worst FCR (highest)", twoDecimals(fcrValues.length ? Math.max(...fcrValues) : null)],
			["Overall FCR (all periods)", twoDecimals(totalGain > 0 ? totalFeed / totalGain : null)],
			["Total feed (kg)", oneDecimal(totalFeed)],
			["Total biomass gain (kg)", oneDecimal(totalGain)],
		];
		chart = {
			title: "FCR by period",
			unit: "FCR",
			points: reports
				.slice(-MAX_CHART_POINTS)
				.map((report) => ({ label: formatFarmDate(report.periodEnd), value: report.fcrValue })),
		};
		head = ["Period", "FCR", "Feed used (kg)", "Biomass gain (kg)"];
		body = reports
			.slice(-MAX_TABLE_ROWS)
			.reverse()
			.map((report) => [
				`${formatFarmDate(report.periodStart)} - ${formatFarmDate(report.periodEnd)}`,
				twoDecimals(report.fcrValue),
				oneDecimal(report.totalFeedKg),
				oneDecimal(report.biomassGainKg),
			]);
		emptyMessage = "No FCR reports yet.";
	} else {
		const logs = await prisma.biomassLog.findMany({
			where: { pondId: pond.id },
			orderBy: { recordedAt: "desc" },
			take: 200,
		});
		logs.reverse();
		const samples = logs.map((log) => ({
			recordedAt: log.recordedAt,
			avgWeightKg: log.avgWeightKg,
		}));
		const first = logs[0];
		const last = logs.at(-1);
		const days = first && last ? elapsedFarmDays(first.recordedAt, last.recordedAt) : null;
		const gramsOf = (kg: number | undefined) => (kg === undefined ? null : kg * 1000);

		if (kind === "growth") {
			const gain =
				first && last && logs.length > 1 ? (last.avgWeightKg - first.avgWeightKg) * 1000 : null;
			summary = [
				["Samplings", `${logs.length}`],
				["First average weight (g)", oneDecimal(gramsOf(first?.avgWeightKg))],
				["Latest average weight (g)", oneDecimal(gramsOf(last?.avgWeightKg))],
				["Gain per fish (g)", oneDecimal(gain)],
				["Days between first and latest", days === null ? "-" : `${days}`],
				["Average daily gain (g/day)", twoDecimals(averageDailyGain(samples))],
				["First sampling", first ? formatFarmDate(first.recordedAt) : "-"],
				["Latest sampling", last ? formatFarmDate(last.recordedAt) : "-"],
			];
			chart = {
				title: "Average weight per fish",
				unit: "g",
				points: logs
					.slice(-MAX_CHART_POINTS)
					.map((log) => ({ label: formatFarmDate(log.recordedAt), value: log.avgWeightKg * 1000 })),
			};
			head = ["Date", "Average weight (g)", "Fish sampled", "Batch"];
			body = logs
				.slice(-MAX_TABLE_ROWS)
				.reverse()
				.map((log) => [
					formatFarmDate(log.recordedAt),
					oneDecimal(log.avgWeightKg * 1000),
					`${log.sampleCount}`,
					log.batchLabel ?? "-",
				]);
			emptyMessage = "No biomass samplings recorded yet.";
		} else {
			const series = sgrSeries(samples);
			summary = [
				["Samplings", `${logs.length}`],
				["Overall SGR (%/day)", twoDecimals(overallSgr(samples))],
				["Average daily gain (g/day)", twoDecimals(averageDailyGain(samples))],
				["Days between first and latest", days === null ? "-" : `${days}`],
				["First average weight (g)", oneDecimal(gramsOf(first?.avgWeightKg))],
				["Latest average weight (g)", oneDecimal(gramsOf(last?.avgWeightKg))],
			];
			const usable = series.filter((point) => point.sgrPctPerDay !== null);
			chart = {
				title: "SGR between samplings",
				unit: "%/day",
				points: usable.slice(-MAX_CHART_POINTS).map((point) => ({
					label: formatFarmDate(point.to),
					value: point.sgrPctPerDay as number,
				})),
			};
			head = ["From", "To", "Days", "SGR (%/day)", "Daily gain (g/day)"];
			body = series
				.slice(-MAX_TABLE_ROWS)
				.reverse()
				.map((point) => [
					formatFarmDate(point.from),
					formatFarmDate(point.to),
					point.days === null ? "-" : `${point.days}`,
					twoDecimals(point.sgrPctPerDay),
					twoDecimals(point.averageDailyGainG),
				]);
			emptyMessage = "At least two samplings are needed to calculate SGR.";
		}
	}

	sectionTitle(doc, "Summary", 44);
	autoTable(doc, {
		startY: 48,
		head: [["Figure", "Value"]],
		body: summary,
		theme: "grid",
		headStyles: { fillColor: NAVY },
	});

	let y = (doc.lastAutoTable?.finalY ?? 48) + 14;
	if (y + 70 > doc.internal.pageSize.getHeight() - 20) {
		doc.addPage();
		y = 24;
	}
	drawLineChart(doc, { x: 14, y: y + 4, width: pageWidth - 28, height: 58 }, chart.points, chart);
	y += 74;

	if (body.length === 0) {
		doc.setFontSize(10);
		doc.setTextColor(120);
		doc.text(emptyMessage, 14, y);
	} else {
		if (y + 30 > doc.internal.pageSize.getHeight() - 20) {
			doc.addPage();
			y = 24;
		}
		sectionTitle(doc, "Data", y);
		autoTable(doc, {
			startY: y + 4,
			head: [head],
			body,
			theme: "grid",
			headStyles: { fillColor: NAVY },
		});
	}

	const pageCount = doc.getNumberOfPages();
	for (let page = 1; page <= pageCount; page += 1) {
		doc.setPage(page);
		doc.setFontSize(8);
		doc.setTextColor(150);
		doc.text(REPORT_FORMULA[kind], 14, doc.internal.pageSize.getHeight() - 16, {
			maxWidth: pageWidth - 28,
		});
		doc.text(
			`PakaonAI ${REPORT_TITLE[kind]} - Page ${page} of ${pageCount}`,
			pageWidth / 2,
			doc.internal.pageSize.getHeight() - 8,
			{ align: "center" },
		);
	}

	return {
		filename: `pakaonai-${kind}-${safeFilenamePart(pond.name)}-${dateToFarmDateOnly(new Date())}.pdf`,
		contentType: "application/pdf",
		body: doc.output("arraybuffer"),
	};
}
