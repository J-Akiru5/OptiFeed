import prisma from "@/lib/prisma";
import { getRecalibrationStatus, recalibrationDedupeKey } from "./recalibration";

/**
 * Create the overdue-recalibration notification for every device whose
 * calibration interval has elapsed.
 *
 * `ReminderLog.dedupeKey` is the idempotency gate (same pattern as crop
 * reminders): the notification and its log row commit together, and a second
 * run for the same due date is skipped as a duplicate. One reminder per overdue
 * period — re-running the cron never multiplies it.
 */

export interface RecalibrationReminderSummary {
	checked: number;
	notified: number;
	skipped: number;
	failed: number;
}

const RECALIBRATION_LINK = "/dashboard/settings/hardware";

function isUniqueViolation(error: unknown): boolean {
	return (
		typeof error === "object" && error !== null && (error as { code?: unknown }).code === "P2002"
	);
}

function formatDate(date: Date): string {
	return date.toISOString().slice(0, 10);
}

export async function processRecalibrationReminders(
	now: Date = new Date(),
): Promise<RecalibrationReminderSummary> {
	const devices = await prisma.energyDevice.findMany({
		where: { pondId: { not: null }, lastCalibratedAt: { not: null } },
		select: {
			id: true,
			label: true,
			pondId: true,
			lastCalibratedAt: true,
			recalibrationIntervalDays: true,
		},
		take: 200,
	});

	const summary: RecalibrationReminderSummary = {
		checked: devices.length,
		notified: 0,
		skipped: 0,
		failed: 0,
	};

	for (const device of devices) {
		if (!device.pondId || !device.lastCalibratedAt) continue;

		const pondId = device.pondId;
		const lastCalibratedAt = device.lastCalibratedAt;
		const status = getRecalibrationStatus(lastCalibratedAt, device.recalibrationIntervalDays, now);
		if (!status.isOverdue || !status.dueAt) continue;

		const dedupeKey = recalibrationDedupeKey(device.id, status.dueAt);
		const message = `${device.label} is due for recalibration — last calibrated ${formatDate(lastCalibratedAt)} (every ${device.recalibrationIntervalDays} days). Re-run the feed rate test.`;

		try {
			await prisma.$transaction(async (tx) => {
				await tx.reminderLog.create({
					data: {
						pondId,
						kind: "recalibration_due",
						channel: "in_app",
						dedupeKey,
					},
				});
				await tx.notification.create({
					data: {
						pondId,
						tier: "WARNING",
						category: "system",
						message,
						linkTo: RECALIBRATION_LINK,
					},
				});
			});
			summary.notified += 1;
		} catch (error) {
			if (isUniqueViolation(error)) {
				summary.skipped += 1;
				continue;
			}
			summary.failed += 1;
			console.error("[calibration] Failed to create recalibration reminder:", error);
		}
	}

	return summary;
}
