import { notFound } from "@/lib/api/errors";
import { resolveActivePond } from "@/lib/auth/pond-access";
import { DEFAULT_FISH_COUNT, PH_TZ } from "@/lib/constants";
import { dateToFarmDateOnly } from "@/lib/crop-cycle/dates";
import { feedPerMealG, totalBiomassG } from "@/lib/feed-calc";
import { formatFeedAmountLabel, isDailyTotalSource } from "@/lib/feed-figures";
import type { ExportArtifact } from "@/lib/jobs/export-data";
import prisma from "@/lib/prisma";
import { resolveCurrentSchedule } from "@/lib/schedule/resolve-current";
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";

interface JsPDFWithAutoTable extends jsPDF {
	lastAutoTable?: { finalY: number };
}

/**
 * The report is generated on the server (UTC), but every date it prints is a
 * farm-local date. Formatting with the runtime default would shift the
 * "Generated" date and every feeding time by up to eight hours.
 */
function formatFarmDate(value: Date): string {
	return new Intl.DateTimeFormat("en-US", {
		timeZone: PH_TZ,
		year: "numeric",
		month: "short",
		day: "numeric",
	}).format(value);
}

function formatFarmDateTime(value: Date): string {
	return new Intl.DateTimeFormat("en-US", {
		timeZone: PH_TZ,
		year: "numeric",
		month: "short",
		day: "numeric",
		hour: "numeric",
		minute: "2-digit",
	}).format(value);
}

/** Tenant-controlled pond name → a filename safe for Content-Disposition. */
function safeFilenamePart(value: string): string {
	const cleaned = value
		.replace(/[^A-Za-z0-9._-]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.replace(/^\.+/, "")
		.slice(0, 60);
	return cleaned || "pond";
}

export async function buildPdfExport(ownerId: string): Promise<ExportArtifact> {
	// Same pond the dashboard and CSV exports use (first ACTIVE pond). An
	// unfiltered findFirst could report an archived pond, and the choice was
	// nondeterministic when a farm had more than one.
	const pond = await resolveActivePond(ownerId);

	if (!pond) throw notFound("No pond found.");

	const energyDevice = await prisma.energyDevice.findFirst({
		where: { pondId: pond.id },
		orderBy: { createdAt: "asc" },
	});

	const currentConfig = await resolveCurrentSchedule(pond.id, energyDevice?.id ?? null);

	const latestBiomass = await prisma.biomassLog.findFirst({
		where: { pondId: pond.id },
		orderBy: { recordedAt: "desc" },
	});

	const fcrReports = await prisma.fcrReport.findMany({
		where: { pondId: pond.id },
		orderBy: { periodEnd: "asc" },
		take: 10,
	});

	const feedEvents = energyDevice
		? await prisma.feedEvent.findMany({
				where: { deviceId: energyDevice.id, eventType: "feed_dispensed" },
				orderBy: { receivedAt: "desc" },
				take: 50,
			})
		: [];

	const doc = new jsPDF() as JsPDFWithAutoTable;
	const pageWidth = doc.internal.pageSize.getWidth();

	// Header
	doc.setFontSize(20);
	doc.setTextColor(10, 61, 98); // #0A3D62
	doc.text("PakaonAI Report", 14, 22);

	doc.setFontSize(10);
	doc.setTextColor(100);
	doc.text(`Pond: ${pond.name}  |  Generated: ${formatFarmDate(new Date())}`, 14, 30);

	doc.setDrawColor(232, 90, 42); // #E85A2A
	doc.setLineWidth(0.5);
	doc.line(14, 34, pageWidth - 14, 34);

	// Pond Summary
	doc.setFontSize(14);
	doc.setTextColor(10, 61, 98);
	doc.text("Pond Summary", 14, 44);

	const feedingRatePct = currentConfig?.feedingRatePct ?? pond.feedingRatePct;
	const feedsPerDay = currentConfig?.feedsPerDay ?? pond.feedsPerDay;
	const scheduleStart = currentConfig?.scheduleStart ?? pond.scheduleStart;
	const scheduleEnd = currentConfig?.scheduleEnd ?? pond.scheduleEnd;

	// Daily Feed (g) = Total Biomass (g) × Feeding Rate (%)
	// Feed per Meal (g) = Daily Feed (g) ÷ Feeds Per Day  (see lib/feed-calc.ts)
	const pondPopulation = pond.population;
	let nextFeedingVolumeG = energyDevice?.gramsPerFeeding ?? 330;
	if (latestBiomass) {
		nextFeedingVolumeG = feedPerMealG(
			totalBiomassG(pondPopulation, latestBiomass.avgWeightKg),
			feedingRatePct,
			feedsPerDay,
		);
	}

	autoTable(doc, {
		startY: 48,
		head: [["Parameter", "Value"]],
		body: [
			["Pond Name", pond.name],
			["Schedule", `${scheduleStart.getUTCHours()}:00 - ${scheduleEnd.getUTCHours()}:00`],
			["Feeds Per Day", `${feedsPerDay}`],
			["Feeding Rate", `${feedingRatePct}%`],
			["Feed Volume", `${nextFeedingVolumeG}g`],
			["Population", `${pondPopulation ?? DEFAULT_FISH_COUNT}`],
			["Sample Interval", `${pond.sampleIntervalDays ?? 14} days`],
		],
		theme: "grid",
		headStyles: { fillColor: [10, 61, 98] },
	});

	// Biomass
	let yPos = doc.lastAutoTable?.finalY ?? 48;
	doc.setFontSize(14);
	doc.setTextColor(10, 61, 98);
	doc.text("Biomass Data", 14, yPos + 12);

	if (latestBiomass) {
		autoTable(doc, {
			startY: yPos + 16,
			head: [["Date", "Avg Weight (g)", "Samples", "Notes"]],
			body: [
				[
					formatFarmDate(latestBiomass.recordedAt),
					`${(latestBiomass.avgWeightKg * 1000).toFixed(1)}`,
					`${latestBiomass.sampleCount}`,
					"",
				],
			],
			theme: "grid",
			headStyles: { fillColor: [10, 61, 98] },
		});
		yPos = doc.lastAutoTable?.finalY ?? yPos + 16;
	} else {
		doc.setFontSize(10);
		doc.setTextColor(150);
		doc.text("No biomass data recorded", 14, yPos + 16);
		yPos += 16;
	}

	// FCR History
	doc.setFontSize(14);
	doc.setTextColor(10, 61, 98);
	doc.text("FCR History", 14, yPos + 12);

	if (fcrReports.length > 0) {
		autoTable(doc, {
			startY: yPos + 16,
			head: [["Period", "FCR Value", "Feed Used (kg)", "Biomass Gain (kg)"]],
			body: fcrReports.map((report) => [
				`${formatFarmDate(report.periodStart)} - ${formatFarmDate(report.periodEnd)}`,
				report.fcrValue.toFixed(2),
				report.totalFeedKg?.toFixed(1) ?? "—",
				report.biomassGainKg?.toFixed(1) ?? "—",
			]),
			theme: "grid",
			headStyles: { fillColor: [10, 61, 98] },
		});
		yPos = doc.lastAutoTable?.finalY ?? yPos + 16;
	} else {
		doc.setFontSize(10);
		doc.setTextColor(150);
		doc.text("No FCR reports yet", 14, yPos + 16);
		yPos += 16;
	}

	// Feeding History
	doc.setFontSize(14);
	doc.setTextColor(10, 61, 98);
	doc.text("Recent Feedings", 14, yPos + 12);

	if (feedEvents.length > 0) {
		autoTable(doc, {
			startY: yPos + 16,
			head: [["Time", "Amount", "Source"]],
			body: feedEvents
				.slice(0, 20)
				.map((event) => [
					formatFarmDateTime(event.receivedAt),
					formatFeedAmountLabel(event.grams),
					event.source
						? isDailyTotalSource(event.source)
							? "Hand-fed (daily total)"
							: event.source
						: "Not reported",
				]),
			theme: "grid",
			headStyles: { fillColor: [10, 61, 98] },
		});
	}

	// Footer
	const pageCount = doc.getNumberOfPages();
	for (let i = 1; i <= pageCount; i++) {
		doc.setPage(i);
		doc.setFontSize(8);
		doc.setTextColor(150);
		doc.text(
			`PakaonAI Report - Page ${i} of ${pageCount}`,
			pageWidth / 2,
			doc.internal.pageSize.getHeight() - 10,
			{ align: "center" },
		);
	}

	return {
		filename: `pakaonai-report-${safeFilenamePart(pond.name)}-${dateToFarmDateOnly(new Date())}.pdf`,
		contentType: "application/pdf",
		body: doc.output("arraybuffer"),
	};
}
