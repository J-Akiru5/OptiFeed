import { resolveActivePond } from "@/lib/auth/pond-access";
import { requireWriteAccess } from "@/lib/auth/session";
import { withAuth } from "@/lib/auth/with-auth";
import { IMPORT_ROW_LIMIT } from "@/lib/constants";
import { type ExportableType, parseCsvString } from "@/lib/csv";
import prisma from "@/lib/prisma";
import { checkApiRateLimit } from "@/lib/rate-limit";
import { revalidatePath } from "next/cache";

export const dynamic = "force-dynamic";

interface ImportConfirmRequest {
	type: ExportableType;
	csvData: string;
}

export const POST = withAuth(async (request, { ownerId }) => {
	try {
		await requireWriteAccess();
	} catch {
		return Response.json({ error: "Write access required (ADMIN or OPERATOR)" }, { status: 403 });
	}

	// Rate limit: 30 requests per 60 seconds per user
	const { success } = await checkApiRateLimit(ownerId);
	if (!success) {
		return Response.json({ error: "Too Many Requests" }, { status: 429 });
	}

	const pond = await resolveActivePond(ownerId);
	if (!pond) {
		return Response.json({ error: "No pond found" }, { status: 404 });
	}

	let body: ImportConfirmRequest;
	try {
		body = await request.json();
	} catch {
		return Response.json({ error: "Invalid JSON body" }, { status: 400 });
	}

	const { type, csvData } = body;
	if (!type || !csvData) {
		return Response.json({ error: "Missing type or csvData" }, { status: 400 });
	}

	const { data } = parseCsvString(csvData);

	// F-003: bound the work one request can demand of the database.
	if (data.length > IMPORT_ROW_LIMIT) {
		return Response.json(
			{ error: `Import exceeds the ${IMPORT_ROW_LIMIT} row limit` },
			{ status: 400 },
		);
	}

	const device = await prisma.energyDevice.findFirst({
		where: { pondId: pond.id },
		orderBy: { createdAt: "asc" },
	});

	// F-004 ownership check runs before the transaction so a foreign id can
	// still return 400 directly (a return inside the tx callback would be
	// swallowed by the transaction wrapper).
	if (type === "fish_samples") {
		const referencedIds = [...new Set(data.map((row) => String(row.biomassLogId)))];
		const ownedLogs = await prisma.biomassLog.findMany({
			where: { id: { in: referencedIds }, pond: { ownerId } },
			select: { id: true },
		});
		const ownedIds = new Set(ownedLogs.map((l) => l.id));
		if (referencedIds.some((id) => !ownedIds.has(id))) {
			return Response.json(
				{ error: "One or more biomassLogId values are not owned by this farm" },
				{ status: 400 },
			);
		}
	}

	// F-003: every write — the bulk insert and the audit event — shares one
	// transaction, so a failure anywhere rolls all of it back instead of
	// leaving imported rows with no audit trail (or the reverse).
	try {
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
						const result = await tx.biomassLog.createMany({ data: rows });
						count = result.count;
						break;
					}
					case "fish_samples": {
						// Ownership was validated above (F-004).
						const rows = data.map((row) => ({
							biomassLogId: String(row.biomassLogId),
							weightGrams: Number(row.weightGrams),
							lengthCm: Number(row.lengthCm),
						}));
						const result = await tx.fishSample.createMany({ data: rows });
						count = result.count;
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
						const result = await tx.feedEvent.createMany({ data: rows });
						count = result.count;
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
						const result = await tx.fcrReport.createMany({ data: rows });
						count = result.count;
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
						const result = await tx.feedLevelLog.createMany({ data: rows });
						count = result.count;
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
						const result = await tx.notification.createMany({ data: rows });
						count = result.count;
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
						const result = await tx.deviceStateEvent.createMany({ data: rows });
						count = result.count;
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

		revalidatePath("/[locale]/(dashboard)/dashboard", "page");
		revalidatePath("/[locale]/(dashboard)/dashboard/growth", "page");
		revalidatePath("/[locale]/(dashboard)/dashboard/history", "page");
		revalidatePath("/[locale]/(dashboard)/dashboard/audit", "page");

		return Response.json({ success: true, importedCount });
	} catch (error) {
		console.error("[import] confirm failed:", error);
		return Response.json({ error: "Import failed" }, { status: 500 });
	}
});
