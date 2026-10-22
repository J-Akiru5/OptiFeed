import { badRequest, notFound } from "@/lib/api/errors";
import { resolveActivePond } from "@/lib/auth/pond-access";
import { IMPORT_ROW_LIMIT } from "@/lib/constants";
import { type ExportableType, parseCsvString } from "@/lib/csv";
import prisma from "@/lib/prisma";

export interface ImportResult {
	importedCount: number;
}

/**
 * Validate and apply a CSV import in one bounded transaction.
 *
 * Extracted from the synchronous route so the same implementation runs in the
 * background worker. Callers enforce write access before enqueuing the job;
 * the worker re-resolves the owner's active pond and re-checks ownership of
 * referenced rows.
 */
export async function confirmImport(
	ownerId: string,
	type: ExportableType,
	csvData: string,
): Promise<ImportResult> {
	const pond = await resolveActivePond(ownerId);
	if (!pond) throw notFound("No pond found.");

	const { data } = parseCsvString(csvData);
	if (data.length > IMPORT_ROW_LIMIT) {
		throw badRequest(`Import exceeds the ${IMPORT_ROW_LIMIT} row limit.`);
	}

	const device = await prisma.energyDevice.findFirst({
		where: { pondId: pond.id },
		orderBy: { createdAt: "asc" },
	});

	// F-004 ownership check runs before the transaction so a foreign id can
	// still return a 400 directly (a return inside the tx callback would be
	// swallowed by the transaction wrapper).
	if (type === "fish_samples") {
		const referencedIds = [...new Set(data.map((row) => String(row.biomassLogId)))];
		const ownedLogs = await prisma.biomassLog.findMany({
			where: { id: { in: referencedIds }, pond: { ownerId } },
			select: { id: true },
		});
		const ownedIds = new Set(ownedLogs.map((log) => log.id));
		if (referencedIds.some((id) => !ownedIds.has(id))) {
			throw badRequest("One or more biomassLogId values are not owned by this farm.");
		}
	}

	const importedCount = await prisma.$transaction(
		async (tx) => {
			let count = 0;

			switch (type) {
				case "biomass_logs": {
					const rows = data.map((row) => {
						const sampleWeightKg = Number(row.sampleWeightKg);
						const sampleCount = Number(row.sampleCount);
						const sampleLengthCm = Number(row.sampleLengthCm ?? 0);
						const avgWeightKg = sampleCount > 0 ? sampleWeightKg / sampleCount : 0;
						return {
							pondId: pond.id,
							sampleWeightKg,
							sampleLengthCm,
							sampleCount,
							avgWeightKg,
							source: "import",
							recordedAt: row.recordedAt ? new Date(String(row.recordedAt)) : new Date(),
						};
					});
					count = (await tx.biomassLog.createMany({ data: rows })).count;
					break;
				}
				case "fish_samples": {
					const rows = data.map((row) => ({
						biomassLogId: String(row.biomassLogId),
						weightGrams: Number(row.weightGrams),
						lengthCm: Number(row.lengthCm),
					}));
					count = (await tx.fishSample.createMany({ data: rows })).count;
					break;
				}
				case "feed_events": {
					if (!device) throw new Error("No device found");
					const rows = data.map((row) => ({
						deviceId: device.id,
						eventId: row.eventId ? String(row.eventId) : undefined,
						eventType: String(row.eventType),
						timestamp: String(row.timestamp ?? "unknown"),
						grams: row.grams != null ? Number(row.grams) : null,
						source: row.source ? String(row.source) : null,
						feedRequestId: row.feedRequestId ? String(row.feedRequestId) : null,
						commandId: row.commandId ? String(row.commandId) : null,
						rtcOk: row.rtcOk != null ? Boolean(row.rtcOk) : null,
						feederActive: row.feederActive != null ? Boolean(row.feederActive) : null,
						receivedAt: row.receivedAt ? new Date(String(row.receivedAt)) : new Date(),
					}));
					count = (await tx.feedEvent.createMany({ data: rows })).count;
					break;
				}
				case "fcr_reports": {
					const rows = data.map((row) => ({
						pondId: pond.id,
						periodStart: new Date(String(row.periodStart)),
						periodEnd: new Date(String(row.periodEnd)),
						totalFeedKg: Number(row.totalFeedKg),
						biomassGainKg: Number(row.biomassGainKg),
						fcrValue: Number(row.fcrValue),
					}));
					count = (await tx.fcrReport.createMany({ data: rows })).count;
					break;
				}
				case "feed_level_logs": {
					if (!device) throw new Error("No device found");
					const rows = data.map((row) => ({
						deviceId: device.id,
						levelPercent: Number(row.levelPercent),
						distanceCm: Number(row.distanceCm),
						recordedAt: row.recordedAt ? new Date(String(row.recordedAt)) : new Date(),
					}));
					count = (await tx.feedLevelLog.createMany({ data: rows })).count;
					break;
				}
				case "notifications": {
					const rows = data.map((row) => ({
						pondId: pond.id,
						tier: String(row.tier),
						message: String(row.message),
						linkTo: row.linkTo ? String(row.linkTo) : null,
						read: Boolean(row.read ?? false),
						category: row.category ? String(row.category) : null,
						autoCleared: Boolean(row.autoCleared ?? false),
						createdAt: row.createdAt ? new Date(String(row.createdAt)) : new Date(),
					}));
					count = (await tx.notification.createMany({ data: rows })).count;
					break;
				}
				case "audit_events": {
					if (!device) throw new Error("No device found");
					const rows = data.map((row) => {
						let metadata = null;
						if (row.metadata) {
							try {
								metadata = JSON.parse(String(row.metadata));
							} catch {
								metadata = { raw: row.metadata };
							}
						}
						return {
							deviceId: device.id,
							eventType: String(row.eventType),
							source: String(row.source),
							actorId: row.actorId ? String(row.actorId) : null,
							metadata,
							deviceTime: row.deviceTime ? String(row.deviceTime) : null,
							createdAt: row.createdAt ? new Date(String(row.createdAt)) : new Date(),
						};
					});
					count = (await tx.deviceStateEvent.createMany({ data: rows })).count;
					break;
				}
			}

			// deviceId is a required FK (not nullable, no default) — skip the
			// audit event when the pond has no device rather than writing ""
			// and failing the whole transaction after the bulk insert.
			if (device) {
				await tx.deviceStateEvent.create({
					data: {
						deviceId: device.id,
						eventType: "data_imported",
						source: "user",
						actorId: ownerId,
						metadata: { type, count },
					},
				});
			}

			return count;
		},
		{ timeout: 30_000 },
	);

	return { importedCount };
}
