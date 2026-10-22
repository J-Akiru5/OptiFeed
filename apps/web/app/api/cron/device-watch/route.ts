import { ok } from "@/lib/api/envelope";
import { withApi } from "@/lib/api/instrumentation";
import { withCronAuth } from "@/lib/auth/with-auth";
import { OFFLINE_THRESHOLD_MS } from "@/lib/constants";
import { absoluteAppUrl, sendTelegramMessage } from "@/lib/notify/telegram";
import { reportError } from "@/lib/observability";
import prisma from "@/lib/prisma";
import { cleanupExpiredRateLimitBuckets } from "@/lib/rate-limit";
import { deleteOldHeartbeatEvents } from "@/lib/retention";

export const dynamic = "force-dynamic";

export const GET = withApi(
	withCronAuth(async () => {
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
			const offlineMessages: string[] = [];
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
				offlineMessages.push(
					`CRITICAL — ${device.label} is offline — no heartbeat for ~${offlineHours}h.`,
				);
			}

			// 3.5: one Telegram message per new outage, sent in parallel after the
			// loop. The dedup marker above guarantees no repeats; a Telegram
			// outage never fails the endpoint (the helper swallows its own errors).
			if (offlineMessages.length > 0) {
				const link = absoluteAppUrl("/dashboard/notifications");
				await Promise.all(
					offlineMessages.map((message) =>
						sendTelegramMessage(link ? `${message}\n${link}` : message),
					),
				);
			}

			// 2. Batched housekeeping so each run stays under the Vercel Hobby
			//    10-second limit: one small batch per job per run.
			const heartbeatsDeleted = await deleteOldHeartbeatEvents();
			const bucketsDeleted = await cleanupExpiredRateLimitBuckets();

			return ok({ offlineAlerts, heartbeatsDeleted, bucketsDeleted });
		} catch (error) {
			reportError(error, { route: "cron/device-watch" });
			return Response.json({ error: "Internal Error" }, { status: 500 });
		}
	}),
	// Internal cron job, not a user hot path. Vercel Hobby caps the function at
	// 10 s; keep the guard above that cap so the job's own batching wins.
	{ route: "GET /api/cron/device-watch", timeoutMs: 15_000 },
);
