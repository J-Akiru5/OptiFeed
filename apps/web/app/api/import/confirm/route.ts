import { farmIdFromEmail } from "@/lib/auth/session";
import { type ExportableType, parseCsvString } from "@/lib/csv";
import prisma from "@/lib/prisma";
import { apiRateLimit } from "@/lib/rate-limit";
import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

export const dynamic = "force-dynamic";

interface ImportConfirmRequest {
	type: ExportableType;
	csvData: string;
}

export async function POST(request: Request) {
	const supabase = await createClient();
	const {
		data: { user },
	} = await supabase.auth.getUser();

	const ownerId = user?.email ? farmIdFromEmail(user.email) : null;
	if (!ownerId) {
		return Response.json({ error: "Unauthorized" }, { status: 401 });
	}

	// Rate limit: 30 requests per 60 seconds per user
	const { success } = await apiRateLimit.limit(ownerId);
	if (!success) {
		return Response.json({ error: "Too Many Requests" }, { status: 429 });
	}

	const pond = await prisma.pond.findFirst({ where: { ownerId } });
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

	const device = await prisma.energyDevice.findFirst({
		where: { pondId: pond.id },
		orderBy: { createdAt: "asc" },
	});

	let importedCount = 0;

	try {
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
						recordedAt: row.recordedAt ? new Date(String(row.recordedAt)) : new Date(),
					};
				});
				const result = await prisma.biomassLog.createMany({ data: rows });
				importedCount = result.count;
				break;
			}
			case "fish_samples": {
				const rows = data.map((row) => ({
					biomassLogId: String(row.biomassLogId),
					weightGrams: Number(row.weightGrams),
					lengthCm: Number(row.lengthCm),
				}));
				const result = await prisma.fishSample.createMany({ data: rows });
				importedCount = result.count;
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
				const result = await prisma.feedEvent.createMany({ data: rows });
				importedCount = result.count;
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
				const result = await prisma.fcrReport.createMany({ data: rows });
				importedCount = result.count;
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
				const result = await prisma.feedLevelLog.createMany({ data: rows });
				importedCount = result.count;
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
				const result = await prisma.notification.createMany({ data: rows });
				importedCount = result.count;
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
				const result = await prisma.deviceStateEvent.createMany({ data: rows });
				importedCount = result.count;
				break;
			}
		}

		await prisma.deviceStateEvent.create({
			data: {
				deviceId: device?.id ?? "",
				eventType: "data_imported",
				source: "user",
				actorId: ownerId,
				metadata: { type, count: importedCount },
			},
		});

		revalidatePath("/[locale]/(dashboard)/dashboard", "page");
		revalidatePath("/[locale]/(dashboard)/dashboard/growth", "page");
		revalidatePath("/[locale]/(dashboard)/dashboard/history", "page");
		revalidatePath("/[locale]/(dashboard)/dashboard/audit", "page");

		return Response.json({ success: true, importedCount });
	} catch (error) {
		console.error("[import] confirm failed:", error);
		return Response.json({ error: "Import failed" }, { status: 500 });
	}
}
