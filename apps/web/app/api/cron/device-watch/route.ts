import { withCronAuth } from "@/lib/auth/with-auth";
import { OFFLINE_THRESHOLD_MS } from "@/lib/constants";
import { reportError } from "@/lib/observability";
import prisma from "@/lib/prisma";
import { cleanupExpiredRateLimitBuckets } from "@/lib/rate-limit";
import { deleteOldHeartbeatEvents } from "@/lib/retention";

export const dynamic = "force-dynamic";

export const GET = withCronAuth(async () => {
	try {
		// 1. Dead-device detection: stale heartbeat, no disconnected event
		//    since the last contact. The event itself is the dedup marker, so
		//    a device alerts exactly once per outage (no repeats on later runs).
		const cutoff = new Date(Date.now() - OFFLINE_THRESHOLD_MS);
		const staleDevices = await prisma.energyDevice.findMany({
			where: { lastSeenAt: { lt: cutoff }, pondId: { not: null } },
			select: { id: true, pondId: true, label: true, lastSeenAt: true },
			take: 100,
		});

		let offlineAlerts = 0;
		for (const device of staleDevices) {
			if (!device.lastSeenAt || !device.pondId) continue;

			const alreadyAlerted = await prisma.deviceStateEvent.findFirst({
				where: {
					deviceId: device.id,
					eventType: "disconnected",
					createdAt: { gt: device.lastSeenAt },
				},
				select: { id: true },
			});
			if (alreadyAlerted) continue;

			const offlineMs = Date.now() - device.lastSeenAt.getTime();
			const offlineHours = Math.max(1, Math.round(offlineMs / (60 * 60 * 1000)));

			await prisma.$transaction([
				prisma.deviceStateEvent.create({
					data: {
						deviceId: device.id,
						eventType: "disconnected",
						source: "system",
						deviceTime: device.lastSeenAt.toISOString(),
						metadata: { durationMs: offlineMs, detectedBy: "device-watch cron" },
					},
				}),
				prisma.notification.create({
					data: {
						pondId: device.pondId,
						tier: "CRITICAL",
						category: "connectivity",
						message: `${device.label} is offline — no heartbeat for ~${offlineHours}h`,
						linkTo: "/dashboard/notifications",
					},
				}),
			]);
			offlineAlerts++;
		}

		// 2. Batched housekeeping so each run stays under the Vercel Hobby
		//    10-second limit: one small batch per job per run.
		const heartbeatsDeleted = await deleteOldHeartbeatEvents();
		const bucketsDeleted = await cleanupExpiredRateLimitBuckets();

		return Response.json({ offlineAlerts, heartbeatsDeleted, bucketsDeleted });
	} catch (error) {
		reportError(error, { route: "cron/device-watch" });
		return Response.json({ error: "Internal Error" }, { status: 500 });
	}
});
