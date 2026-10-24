import { resolveActivePond } from "@/lib/auth/pond-access";
import { EXPORT_ROW_LIMIT } from "@/lib/constants";
import { type ExportableType, toCsvString } from "@/lib/csv";
import prisma from "@/lib/prisma";
import JSZip from "jszip";

export const CSV_EXPORT_TYPES: ExportableType[] = [
	"biomass_logs",
	"fish_samples",
	"feed_events",
	"fcr_reports",
	"feed_level_logs",
	"notifications",
	"audit_events",
];

export const BATCH_EXPORT_TYPES: ExportableType[] = [
	"biomass_logs",
	"feed_events",
	"fcr_reports",
	"feed_level_logs",
	"notifications",
	"audit_events",
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
	if (!pond) throw new Error("No pond found.");

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
			if (!context.deviceId) throw new Error("No device found.");
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

export async function buildCsvExport(
	ownerId: string,
	type: ExportableType,
): Promise<ExportArtifact> {
	const context = await loadExportContext(ownerId);
	const rows = await buildExportRows(context, type);
	const csv = toCsvString(rows);
	return {
		filename: `optifeed_${type}_${new Date().toISOString().slice(0, 10)}.csv`,
		contentType: "text/csv; charset=utf-8",
		body: new TextEncoder().encode(csv).buffer as ArrayBuffer,
	};
}

export async function buildBatchExport(
	ownerId: string,
	types: ExportableType[] = BATCH_EXPORT_TYPES,
): Promise<ExportArtifact> {
	const context = await loadExportContext(ownerId);
	const zip = new JSZip();

	for (const type of types) {
		const rows = await buildExportRows(context, type);
		if (rows.length > 0) zip.file(`${type}.csv`, toCsvString(rows));
	}

	const buffer = await zip.generateAsync({ type: "arraybuffer" });
	return {
		filename: `pakaonai_export_${new Date().toISOString().slice(0, 10)}.zip`,
		contentType: "application/zip",
		body: buffer,
	};
}
