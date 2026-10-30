import { ok } from "@/lib/api/envelope";
import { withApi } from "@/lib/api/instrumentation";
import { withCronAuth } from "@/lib/auth/with-auth";
import { processRecalibrationReminders } from "@/lib/calibration/recalibration-reminders";
import { deleteExpiredErrorEvents } from "@/lib/error-capture";
import { normalizeNotificationPrefs } from "@/lib/limits";
import { absoluteAppUrl, sendTelegramMessage } from "@/lib/notify/telegram";
import { reportError } from "@/lib/observability";
import prisma from "@/lib/prisma";
import { cleanupExpiredRateLimitBuckets } from "@/lib/rate-limit";
import { deleteExpiredPondSettingsDrafts, deleteOldHeartbeatEvents } from "@/lib/retention";
import {
	ORG_OFFLINE_AFTER_MIN_MIN,
	ORG_SETTINGS_DEFAULTS,
	getOrgAlertRoles,
	getOrgSettingsForFarms,
} from "@/lib/settings/org";
import { offlineAlertDue, shouldCreatePondAlert } from "@/lib/settings/org-alerts";
import type { MemberRole } from "@prisma/client";

export const dynamic = "force-dynamic";

export const GET = withApi(
	withCronAuth(async () => {
		try {
			// 1. Dead-device detection: stale heartbeat, no disconnected event
			//    since the last contact. The event itself is the dedup marker, so
			//    a device alerts exactly once per outage (no repeats on later runs).
			//
			//    The org's `offlineAfterMin` decides when the ALERT fires; the
			//    device badges use the platform `device.status` policy (#388),
			//    which includes its own grace window.
			//    Scan from the smallest allowed delay so a 5-minute org policy is
			//    honoured, then filter per device below.
			const scanCutoff = new Date(Date.now() - ORG_OFFLINE_AFTER_MIN_MIN * 60 * 1000);
			const staleDevices = await prisma.energyDevice.findMany({
				where: { lastSeenAt: { lt: scanCutoff }, pondId: { not: null } },
				select: { id: true, pondId: true, label: true, lastSeenAt: true },
				// Scan the most recently-stale devices first. An already-alerted
				// device stays stale forever, so the previous oldest-first order
				// permanently filled the 100-row batch with devices that the
				// `alreadyAlerted` check then discarded — once 100 devices had
				// alerted, no newly-offline device could ever be seen. Newest-first
				// means a device crossing the threshold is always in this run's
				// batch, and the already-alerted ones sink out of it over time.
				orderBy: { lastSeenAt: "desc" },
				take: 100,
			});

			// Pond → owner farm → org settings, batched once per run. A pond that
			// cannot be linked to an org keeps the schema defaults and every role,
			// so an unlinkable pond behaves exactly as it did before #190.
			const pondIds = [...new Set(staleDevices.flatMap((d) => (d.pondId ? [d.pondId] : [])))];
			const ponds =
				pondIds.length > 0
					? await prisma.pond.findMany({
							where: { id: { in: pondIds } },
							select: { id: true, ownerId: true, notificationPrefs: true },
							// Bounded by the at most 100 stale devices above.
							take: pondIds.length,
						})
					: [];
			const pondById = new Map(ponds.map((pond) => [pond.id, pond]));
			const settingsByFarm = await getOrgSettingsForFarms(ponds.map((pond) => pond.ownerId));
			const rolesByOrg = new Map<string | null, MemberRole[]>();
			const rolesForOrg = async (orgId: string | null): Promise<MemberRole[]> => {
				const cached = rolesByOrg.get(orgId);
				if (cached) return cached;
				const roles = await getOrgAlertRoles(orgId);
				rolesByOrg.set(orgId, roles);
				return roles;
			};

			let offlineAlerts = 0;
			const offlineMessages: string[] = [];
			const now = new Date();
			for (const device of staleDevices) {
				if (!device.lastSeenAt || !device.pondId) continue;

				const pond = pondById.get(device.pondId);
				const orgContext = pond
					? (settingsByFarm.get(pond.ownerId) ?? {
							orgId: null,
							settings: ORG_SETTINGS_DEFAULTS,
						})
					: { orgId: null, settings: ORG_SETTINGS_DEFAULTS };
				const prefs = normalizeNotificationPrefs(pond?.notificationPrefs);

				if (!offlineAlertDue(device.lastSeenAt, now, orgContext.settings)) continue;

				const roles = await rolesForOrg(orgContext.orgId);
				const allowed = shouldCreatePondAlert({
					settings: orgContext.settings,
					category: "device_offline",
					prefs,
					roles,
				});
				if (!allowed) continue;

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

			// 2. Calibration reminders: one in-app notification per overdue
			//    period, deduped through ReminderLog. Re-runs are no-ops.
			const recalibration = await processRecalibrationReminders();

			// 3. Batched housekeeping so each run stays under the Vercel Hobby
			//    10-second limit: one small batch per job per run.
			const heartbeatsDeleted = await deleteOldHeartbeatEvents();
			const bucketsDeleted = await cleanupExpiredRateLimitBuckets();
			// First-party error capture keeps at most ERROR_EVENT_RETENTION_DAYS
			// (30) days of silence; one bounded batch per run.
			const errorEventsDeleted = await deleteExpiredErrorEvents();
			// Unsaved pond-settings drafts nobody returned to (I-99), one batch
			// per run like the other housekeeping jobs.
			const draftsDeleted = await deleteExpiredPondSettingsDrafts();

			return ok({
				offlineAlerts,
				recalibration,
				heartbeatsDeleted,
				bucketsDeleted,
				errorEventsDeleted,
				draftsDeleted,
			});
		} catch (error) {
			reportError(error, { route: "cron/device-watch" });
			return Response.json({ error: "Internal Error" }, { status: 500 });
		}
	}),
	// Internal cron job, not a user hot path. Vercel Hobby caps the function at
	// 10 s; keep the guard above that cap so the job's own batching wins.
	{ route: "GET /api/cron/device-watch", timeoutMs: 15_000 },
);
