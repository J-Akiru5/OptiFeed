import { ApiError, notFound } from "@/lib/api/errors";
import { resolveActivePond } from "@/lib/auth/pond-access";
import { EXPORT_ROW_LIMIT } from "@/lib/constants";
import { dateToFarmDateOnly } from "@/lib/crop-cycle/dates";
import { type ExportableType, toCsvString } from "@/lib/csv";
import prisma from "@/lib/prisma";
import { buildScheduleRows } from "@/lib/schedule/sheet";
import type { SheetType } from "@/lib/xlsx/schema";
import type { SheetData } from "@/lib/xlsx/writer";
import JSZip from "jszip";

/** The datasets the importer can also read back. */
export const CSV_EXPORT_TYPES: ExportableType[] = [
	"biomass_logs",
	"fish_samples",
	"feed_events",
	"fcr_reports",
	"feed_level_logs",
	"notifications",
	"audit_events",
];

/** Everything a single CSV or a workbook can export: the datasets plus the feeding schedule. */
export const SHEET_EXPORT_TYPES: SheetType[] = [...CSV_EXPORT_TYPES, "feeding_schedule"];

export const BATCH_EXPORT_TYPES: SheetType[] = [
	"biomass_logs",
	"feed_events",
	"fcr_reports",
	"feed_level_logs",
	"notifications",
	"audit_events",
	"feeding_schedule",
];

export type ExportRow = Record<string, string | number | boolean | null>;

export interface ExportArtifact {
	filename: string;
	contentType: string;
	body: ArrayBuffer;
}

interface ExportContext {
	pondId: string;
	deviceIds: string[];
	deviceId: string | null;
}

export async function loadExportContext(ownerId: string): Promise<ExportContext> {
	const pond = await resolveActivePond(ownerId);
	// A farm with no pond is an empty state, not a server fault: the envelope
	// maps a plain Error to 500, so throw the same 404 the PDF export uses.
	if (!pond) throw notFound("No pond found.");

	const deviceIds = (
		await prisma.energyDevice.findMany({
			where: { pondId: pond.id },
			select: { id: true },
			take: 100,
		})
	).map((device) => device.id);

	return { pondId: pond.id, deviceIds, deviceId: deviceIds[0] ?? null };
}

export async function buildExportRows(
	context: ExportContext,
	type: ExportableType,
): Promise<ExportRow[]> {
	switch (type) {
		case "biomass_logs": {
			const logs = await prisma.biomassLog.findMany({
				where: { pondId: context.pondId },
				orderBy: { recordedAt: "asc" },
				take: EXPORT_ROW_LIMIT,
			});
			return logs.map((log) => ({
				id: log.id,
				pondId: log.pondId,
				sampleWeightKg: log.sampleWeightKg,
				sampleLengthCm: log.sampleLengthCm,
				sampleCount: log.sampleCount,
				avgWeightKg: log.avgWeightKg,
				batchLabel: log.batchLabel,
				recordedAt: log.recordedAt.toISOString(),
			}));
		}
		case "fish_samples": {
			const logs = await prisma.biomassLog.findMany({
				where: { pondId: context.pondId },
				select: { id: true, batchLabel: true, recordedAt: true },
				take: EXPORT_ROW_LIMIT,
			});
			const logMeta = new Map(logs.map((log) => [log.id, log]));
			const samples = await prisma.fishSample.findMany({
				where: { biomassLogId: { in: logs.map((log) => log.id) } },
				orderBy: { id: "asc" },
				take: EXPORT_ROW_LIMIT,
			});
			return samples.map((sample) => ({
				id: sample.id,
				biomassLogId: sample.biomassLogId,
				batchLabel: logMeta.get(sample.biomassLogId)?.batchLabel ?? null,
				weightGrams: sample.weightGrams,
				lengthCm: sample.lengthCm,
				recordedAt: logMeta.get(sample.biomassLogId)?.recordedAt.toISOString() ?? null,
			}));
		}
		case "feed_events": {
			const events = await prisma.feedEvent.findMany({
				where: { deviceId: { in: context.deviceIds } },
				orderBy: { receivedAt: "asc" },
				take: EXPORT_ROW_LIMIT,
			});
			return events.map((event) => ({
				id: event.id,
				deviceId: event.deviceId,
				eventId: event.eventId,
				eventType: event.eventType,
				timestamp: event.timestamp,
				grams: event.grams,
				source: event.source,
				feedRequestId: event.feedRequestId,
				commandId: event.commandId,
				rtcOk: event.rtcOk,
				feederActive: event.feederActive,
				receivedAt: event.receivedAt.toISOString(),
			}));
		}
		case "fcr_reports": {
			const reports = await prisma.fcrReport.findMany({
				where: { pondId: context.pondId },
				orderBy: { periodEnd: "asc" },
				take: EXPORT_ROW_LIMIT,
			});
			return reports.map((report) => ({
				id: report.id,
				pondId: report.pondId,
				periodStart: report.periodStart.toISOString(),
				periodEnd: report.periodEnd.toISOString(),
				totalFeedKg: report.totalFeedKg,
				biomassGainKg: report.biomassGainKg,
				fcrValue: report.fcrValue,
			}));
		}
		case "feed_level_logs": {
			if (!context.deviceId) throw notFound("No device found.");
			const logs = await prisma.feedLevelLog.findMany({
				where: { deviceId: context.deviceId },
				orderBy: { recordedAt: "asc" },
				take: EXPORT_ROW_LIMIT,
			});
			return logs.map((log) => ({
				id: log.id,
				deviceId: log.deviceId,
				levelPercent: log.levelPercent,
				distanceCm: log.distanceCm,
				recordedAt: log.recordedAt.toISOString(),
			}));
		}
		case "notifications": {
			const notifications = await prisma.notification.findMany({
				where: { pondId: context.pondId },
				orderBy: { createdAt: "asc" },
				take: EXPORT_ROW_LIMIT,
			});
			return notifications.map((notification) => ({
				id: notification.id,
				pondId: notification.pondId,
				tier: notification.tier,
				message: notification.message,
				linkTo: notification.linkTo,
				read: notification.read,
				category: notification.category,
				acknowledgedAt: notification.acknowledgedAt?.toISOString() ?? null,
				acknowledgedBy: notification.acknowledgedBy,
				autoCleared: notification.autoCleared,
				createdAt: notification.createdAt.toISOString(),
			}));
		}
		case "audit_events": {
			const events = await prisma.deviceStateEvent.findMany({
				where: { deviceId: { in: context.deviceIds } },
				orderBy: { createdAt: "asc" },
				take: EXPORT_ROW_LIMIT,
			});
			return events.map((event) => ({
				id: event.id,
				deviceId: event.deviceId,
				eventType: event.eventType,
				source: event.source,
				actorId: event.actorId,
				metadata: event.metadata ? JSON.stringify(event.metadata) : null,
				deviceTime: event.deviceTime,
				createdAt: event.createdAt.toISOString(),
			}));
		}
	}
}

/** The rows of one sheet: a dataset, or the feeding schedule derived from the pond settings. */
export async function buildSheetRows(
	context: ExportContext,
	type: SheetType,
): Promise<ExportRow[]> {
	return type === "feeding_schedule"
		? buildScheduleRows(context.pondId)
		: buildExportRows(context, type);
}

export async function buildCsvExport(ownerId: string, type: SheetType): Promise<ExportArtifact> {
	const context = await loadExportContext(ownerId);
	const rows = await buildSheetRows(context, type);
	const csv = toCsvString(rows);
	return {
		// Farm-local date, like the PDF report: the UTC date rolls over at 08:00 in
		// Asia/Manila, so an export taken in the morning was dated yesterday.
		filename: `optifeed_${type}_${dateToFarmDateOnly(new Date())}.csv`,
		contentType: "text/csv; charset=utf-8",
		body: new TextEncoder().encode(csv).buffer as ArrayBuffer,
	};
}

export async function buildBatchExport(
	ownerId: string,
	types: SheetType[] = BATCH_EXPORT_TYPES,
): Promise<ExportArtifact> {
	const context = await loadExportContext(ownerId);
	const zip = new JSZip();

	for (const type of types) {
		const rows = await buildSheetRows(context, type);
		if (rows.length > 0) zip.file(`${type}.csv`, toCsvString(rows));
	}

	const buffer = await zip.generateAsync({ type: "arraybuffer" });
	return {
		// Farm-local date, for the same reason as the CSV export above.
		filename: `pakaonai_export_${dateToFarmDateOnly(new Date())}.zip`,
		contentType: "application/zip",
		body: buffer,
	};
}

/**
 * One workbook with one sheet per requested type. A type with nothing to
 * export (or no feeder to read) still gets its header row, so the sheet doubles
 * as a template for that type.
 */
export async function buildXlsxExport(
	ownerId: string,
	types: SheetType[] = SHEET_EXPORT_TYPES,
): Promise<ExportArtifact> {
	const context = await loadExportContext(ownerId);
	const sheets: SheetData[] = [];
	for (const type of types) {
		let rows: ExportRow[] = [];
		try {
			rows = await buildSheetRows(context, type);
		} catch (error) {
			if (!(error instanceof ApiError) || error.status !== 404) throw error;
		}
		sheets.push({ type, rows });
	}

	const { buildWorkbookBuffer } = await import("@/lib/xlsx/writer");
	return {
		filename: `pakaonai_export_${dateToFarmDateOnly(new Date())}.xlsx`,
		contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
		body: await buildWorkbookBuffer(sheets),
	};
}
