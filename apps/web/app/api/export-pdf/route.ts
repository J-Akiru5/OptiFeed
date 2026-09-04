import { getCurrentPondOwnerId } from "@/lib/auth/session";
import prisma from "@/lib/prisma";
import { resolveCurrentSchedule } from "@/lib/schedule/resolve-current";
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { NextResponse } from "next/server";

interface JsPDFWithAutoTable extends jsPDF {
	lastAutoTable?: { finalY: number };
}

export async function GET() {
	try {
		const ownerId = await getCurrentPondOwnerId();
		const pond = await prisma.pond.findFirst({
			where: { ownerId },
			include: { devices: true },
		});

		if (!pond) {
			return NextResponse.json({ error: "No pond found" }, { status: 404 });
		}

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
		doc.text("OptiFeed Report", 14, 22);

		doc.setFontSize(10);
		doc.setTextColor(100);
		doc.text(`Pond: ${pond.name}  |  Generated: ${new Date().toLocaleDateString()}`, 14, 30);

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

		const pondPopulation = 200;
		let nextFeedingVolumeG = 330;
		if (latestBiomass) {
			const totalBiomassGrams = latestBiomass.avgWeightKg * 1000 * pondPopulation;
			const dailyFeedGrams = totalBiomassGrams * (feedingRatePct / 100);
			nextFeedingVolumeG = Math.round(dailyFeedGrams / feedsPerDay);
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
				["Population", `${pondPopulation}`],
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
						latestBiomass.recordedAt.toLocaleDateString(),
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
				body: fcrReports.map((r) => [
					`${r.periodStart.toLocaleDateString()} - ${r.periodEnd.toLocaleDateString()}`,
					r.fcrValue.toFixed(2),
					r.totalFeedKg?.toFixed(1) ?? "—",
					r.biomassGainKg?.toFixed(1) ?? "—",
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
				head: [["Time", "Grams", "Source"]],
				body: feedEvents
					.slice(0, 20)
					.map((e) => [e.receivedAt.toLocaleString(), `${e.grams ?? 0}g`, e.source ?? "scheduled"]),
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
				`OptiFeed Report - Page ${i} of ${pageCount}`,
				pageWidth / 2,
				doc.internal.pageSize.getHeight() - 10,
				{ align: "center" },
			);
		}

		const pdfBuffer = doc.output("arraybuffer");
		return new NextResponse(pdfBuffer, {
			headers: {
				"Content-Type": "application/pdf",
				"Content-Disposition": `attachment; filename="optifeed-report-${pond.name}-${new Date().toISOString().split("T")[0]}.pdf"`,
			},
		});
	} catch (error) {
		console.error("PDF export failed:", error);
		return NextResponse.json({ error: "Export failed" }, { status: 500 });
	}
}
