import { farmIdFromEmail } from "@/lib/auth/session";
import { EXPORT_ROW_LIMIT } from "@/lib/constants";
import { type ExportableType, toCsvString } from "@/lib/csv";
import prisma from "@/lib/prisma";
import { apiRateLimit } from "@/lib/rate-limit";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const EXPORT_TYPES: ExportableType[] = [
	"biomass_logs",
	"feed_events",
	"fcr_reports",
	"feed_level_logs",
	"notifications",
	"audit_events",
];

export async function GET(request: Request) {
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

	const { searchParams } = new URL(request.url);
	const type = searchParams.get("type") as ExportableType | null;

	if (!type || !EXPORT_TYPES.includes(type)) {
		return Response.json(
			{ error: `Invalid type. Must be one of: ${EXPORT_TYPES.join(", ")}` },
			{ status: 400 },
		);
	}

	const pond = await prisma.pond.findFirst({ where: { ownerId } });
	if (!pond) {
		return Response.json({ error: "No pond found" }, { status: 404 });
	}

	const device = await prisma.energyDevice.findFirst({
		where: { pondId: pond.id },
		orderBy: { createdAt: "asc" },
		select: { id: true },
	});

	let rows: Record<string, string | number | boolean | null>[] = [];

	switch (type) {
		case "biomass_logs": {
			const logs = await prisma.biomassLog.findMany({
				where: { pondId: pond.id },
				orderBy: { recordedAt: "asc" },
				take: EXPORT_ROW_LIMIT,
			});
			rows = logs.map((l) => ({
				id: l.id,
				pondId: l.pondId,
				sampleWeightKg: l.sampleWeightKg,
				sampleLengthCm: l.sampleLengthCm,
				sampleCount: l.sampleCount,
				avgWeightKg: l.avgWeightKg,
				recordedAt: l.recordedAt.toISOString(),
			}));
			break;
		}
		case "feed_events": {
			const deviceIds = (
				await prisma.energyDevice.findMany({
					where: { pondId: pond.id },
					select: { id: true },
				})
			).map((d) => d.id);
			const events = await prisma.feedEvent.findMany({
				where: { deviceId: { in: deviceIds } },
				orderBy: { receivedAt: "asc" },
				take: EXPORT_ROW_LIMIT,
			});
			rows = events.map((e) => ({
				id: e.id,
				deviceId: e.deviceId,
				eventId: e.eventId,
				eventType: e.eventType,
				timestamp: e.timestamp,
				grams: e.grams,
				source: e.source,
				feedRequestId: e.feedRequestId,
				commandId: e.commandId,
				rtcOk: e.rtcOk,
				feederActive: e.feederActive,
				receivedAt: e.receivedAt.toISOString(),
			}));
			break;
		}
		case "fcr_reports": {
			const reports = await prisma.fcrReport.findMany({
				where: { pondId: pond.id },
				orderBy: { periodEnd: "asc" },
				take: EXPORT_ROW_LIMIT,
			});
			rows = reports.map((r) => ({
				id: r.id,
				pondId: r.pondId,
				periodStart: r.periodStart.toISOString(),
				periodEnd: r.periodEnd.toISOString(),
				totalFeedKg: r.totalFeedKg,
				biomassGainKg: r.biomassGainKg,
				fcrValue: r.fcrValue,
			}));
			break;
		}
		case "feed_level_logs": {
			if (!device) {
				return Response.json({ error: "No device found" }, { status: 404 });
			}
			const logs = await prisma.feedLevelLog.findMany({
				where: { deviceId: device.id },
				orderBy: { recordedAt: "asc" },
				take: EXPORT_ROW_LIMIT,
			});
			rows = logs.map((l) => ({
				id: l.id,
				deviceId: l.deviceId,
				levelPercent: l.levelPercent,
				distanceCm: l.distanceCm,
				recordedAt: l.recordedAt.toISOString(),
			}));
			break;
		}
		case "notifications": {
			const notifs = await prisma.notification.findMany({
				where: { pondId: pond.id },
				orderBy: { createdAt: "asc" },
				take: EXPORT_ROW_LIMIT,
			});
			rows = notifs.map((n) => ({
				id: n.id,
				pondId: n.pondId,
				tier: n.tier,
				message: n.message,
				linkTo: n.linkTo,
				read: n.read,
				category: n.category,
				acknowledgedAt: n.acknowledgedAt?.toISOString() ?? null,
				acknowledgedBy: n.acknowledgedBy,
				autoCleared: n.autoCleared,
				createdAt: n.createdAt.toISOString(),
			}));
			break;
		}
		case "audit_events": {
			const deviceIds = (
				await prisma.energyDevice.findMany({
					where: { pondId: pond.id },
					select: { id: true },
				})
			).map((d) => d.id);
			const events = await prisma.deviceStateEvent.findMany({
				where: { deviceId: { in: deviceIds } },
				orderBy: { createdAt: "asc" },
				take: EXPORT_ROW_LIMIT,
			});
			rows = events.map((e) => ({
				id: e.id,
				deviceId: e.deviceId,
				eventType: e.eventType,
				source: e.source,
				actorId: e.actorId,
				metadata: e.metadata ? JSON.stringify(e.metadata) : null,
				deviceTime: e.deviceTime,
				createdAt: e.createdAt.toISOString(),
			}));
			break;
		}
	}

	const csv = toCsvString(rows);

	return new Response(csv, {
		headers: {
			"Content-Type": "text/csv",
			"Content-Disposition": `attachment; filename="optifeed_${type}_${new Date().toISOString().slice(0, 10)}.csv"`,
		},
	});
}
