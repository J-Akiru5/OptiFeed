import { normalizeNotificationPrefs } from "@/lib/limits";
import prisma from "@/lib/prisma";
import { getOrgAlertRoles, getOrgSettingsForFarm } from "./org";
import { shouldCreatePondAlert } from "./org-alerts";

/**
 * Missed-feeding alerts (issue #190).
 *
 * A scheduled dose that the firmware refused is a feeding that did not happen,
 * so the ingest route reports it here. The org switch
 * (`missedFeedingAlerts`), the pond's personal prefs and the org's `alertRoles`
 * all have to allow it; `ReminderLog.dedupeKey` keeps it to one alert per
 * device per day, so a firmware retry loop cannot spam the inbox.
 *
 * In-app notifications are pond-scoped, so the alert is visible to everyone who
 * can see the pond; `alertRoles` decides whether the org has any intended
 * recipient and therefore whether the alert is created at all.
 */

export type MissedFeedingResult =
	| { created: true }
	| { created: false; reason: "not_enabled" | "duplicate" | "no_pond" };

const MISSED_FEEDING_LINK = "/dashboard/notifications";

function dayKey(timestamp: string): string {
	const parsed = new Date(timestamp);
	const date = Number.isNaN(parsed.getTime()) ? new Date() : parsed;
	return date.toISOString().slice(0, 10);
}

function isUniqueViolation(error: unknown): boolean {
	return (
		typeof error === "object" && error !== null && (error as { code?: unknown }).code === "P2002"
	);
}

export async function recordMissedFeedingAlert(input: {
	deviceId: string;
	deviceLabel: string;
	pondId: string | null;
	grams: number;
	reason: string;
	timestamp: string;
	now?: Date;
}): Promise<MissedFeedingResult> {
	if (!input.pondId) return { created: false, reason: "no_pond" };

	const pond = await prisma.pond.findUnique({
		where: { id: input.pondId },
		select: { ownerId: true, notificationPrefs: true },
	});
	if (!pond) return { created: false, reason: "no_pond" };

	const orgContext = await getOrgSettingsForFarm(pond.ownerId);
	const roles = await getOrgAlertRoles(orgContext.orgId);
	const allowed = shouldCreatePondAlert({
		settings: orgContext.settings,
		category: "missed_feeding",
		prefs: normalizeNotificationPrefs(pond.notificationPrefs),
		roles,
	});
	if (!allowed) return { created: false, reason: "not_enabled" };

	const dedupeKey = `missed_feeding:${input.deviceId}:${dayKey(input.timestamp)}`;
	const grams = Math.round(input.grams);

	try {
		await prisma.$transaction(async (tx) => {
			await tx.reminderLog.create({
				data: {
					pondId: input.pondId as string,
					kind: "missed_feeding",
					channel: "in_app",
					dedupeKey,
				},
			});
			await tx.notification.create({
				data: {
					pondId: input.pondId as string,
					tier: "WARNING",
					category: "feeding",
					message: `${input.deviceLabel} missed a scheduled feeding — the feeder refused ${grams} g (${input.reason}).`,
					linkTo: MISSED_FEEDING_LINK,
				},
			});
		});
		return { created: true };
	} catch (error) {
		if (isUniqueViolation(error)) return { created: false, reason: "duplicate" };
		throw error;
	}
}
