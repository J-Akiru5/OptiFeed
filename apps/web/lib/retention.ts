import prisma from "@/lib/prisma";

// Heartbeat FeedEvent retention: 7 days. Deletes in batches so the 3.1 cron
// endpoint can call this every run without long locks. DeviceStateEvent
// retention is defined separately below (180 days) with open-alert and
// in-progress reconciliation guards.
export const HEARTBEAT_RETENTION_DAYS = 7;

// An unsaved pond-settings draft is useful for days, not months (I-99). Rows
// the reader never came back to are pruned after 30 days, in the same bounded
// batch as the other housekeeping jobs.
export const POND_SETTINGS_DRAFT_RETENTION_DAYS = 30;

// DeviceStateEvent is the device audit trail. 180 days is the documented
// window; the sweep never removes a row for a device with an open alert or a
// row tied to a FeedRequest that is still pending/dispatched (a reconciliation
// in progress).
export const DEVICE_STATE_RETENTION_DAYS = 180;

// #726: owner-approved retention for telemetry and personal data. Each window
// below is the policy; the sweeps delete one bounded batch per cron run,
// oldest first. Notification and IssueReport keep rows that are still open.
export const WATER_TEMP_RETENTION_DAYS = 365;
export const FEED_LEVEL_RETENTION_DAYS = 365;
export const NOTIFICATION_RETENTION_DAYS = 180;
export const CALIBRATION_RUN_RETENTION_DAYS = 730;
export const ASSISTANT_ACTION_RETENTION_DAYS = 180;
export const ISSUE_REPORT_RETENTION_DAYS = 365;
export const REMINDER_LOG_RETENTION_DAYS = 180;
export const PLATFORM_AUDIT_LOG_RETENTION_DAYS = 730;

const DEFAULT_BATCH_SIZE = 5000;

export async function deleteOldHeartbeatEvents(batchSize = DEFAULT_BATCH_SIZE): Promise<number> {
	const cutoff = new Date(Date.now() - HEARTBEAT_RETENTION_DAYS * 24 * 60 * 60 * 1000);

	// The (eventType, receivedAt) index (migration 20261031010000) serves this
	// predicate: eventType is the equality prefix and receivedAt the range.
	// (deviceId, receivedAt) cannot serve it because the query has no deviceId.
	const stale = await prisma.feedEvent.findMany({
		where: { eventType: "heartbeat", receivedAt: { lt: cutoff } },
		select: { id: true },
		take: batchSize,
	});

	if (stale.length === 0) return 0;

	const result = await prisma.feedEvent.deleteMany({
		where: { id: { in: stale.map((row) => row.id) } },
	});

	return result.count;
}

/**
 * Prune the device audit trail older than `DEVICE_STATE_RETENTION_DAYS`.
 *
 * Bounded like the heartbeat sweep: one batch per cron run, oldest first. Two
 * safety rules keep evidence that is still needed:
 *  - an event whose device's pond has an open `Notification` is kept;
 *  - an event whose metadata references a `FeedRequest` in `pending` or
 *    `dispatched` (`feedRequestId` or `expiredRequestId`) is kept, so a
 *    reconciliation in progress can still read it.
 *
 * If a whole batch is protected it returns 0 and the next run retries; it never
 * deletes a protected row to make progress.
 */
export async function deleteOldDeviceStateEvents(batchSize = DEFAULT_BATCH_SIZE): Promise<number> {
	const cutoff = new Date(Date.now() - DEVICE_STATE_RETENTION_DAYS * 24 * 60 * 60 * 1000);

	// Bounded candidate window, oldest first. Nothing stale is the common case,
	// so the two guard queries below only run when there is work to consider.
	const stale = await prisma.deviceStateEvent.findMany({
		where: { createdAt: { lt: cutoff } },
		orderBy: { createdAt: "asc" },
		select: {
			id: true,
			metadata: true,
			device: { select: { pondId: true } },
		},
		take: batchSize,
	});
	if (stale.length === 0) return 0;

	const [openAlerts, inProgressRequests] = await Promise.all([
		prisma.notification.findMany({
			where: { resolvedAt: null, autoCleared: false, supersededById: null },
			select: { pondId: true },
			distinct: ["pondId"],
			take: DEFAULT_BATCH_SIZE,
		}),
		prisma.feedRequest.findMany({
			where: { status: { in: ["pending", "dispatched"] } },
			select: { id: true },
			take: DEFAULT_BATCH_SIZE,
		}),
	]);
	const openPonds = new Set(openAlerts.map((row) => row.pondId));
	const inProgress = new Set(inProgressRequests.map((row) => row.id));

	const deletable = stale.filter((event) => {
		if (event.device?.pondId && openPonds.has(event.device.pondId)) return false;
		if (typeof event.metadata !== "object" || event.metadata === null) return true;
		const metadata = event.metadata as Record<string, unknown>;
		return ![metadata.feedRequestId, metadata.expiredRequestId].some(
			(id) => typeof id === "string" && inProgress.has(id),
		);
	});
	if (deletable.length === 0) return 0;

	const result = await prisma.deviceStateEvent.deleteMany({
		where: { id: { in: deletable.map((event) => event.id) } },
	});
	return result.count;
}

/**
 * Prune pond-settings drafts nobody came back to (I-99).
 *
 * Bounded like the heartbeat sweep: one batch per cron run, oldest first, so a
 * backlog can never hold a long table lock. `updatedAt` is the age clock — a
 * reader who keeps typing keeps the draft alive.
 */
export async function deleteExpiredPondSettingsDrafts(
	batchSize = DEFAULT_BATCH_SIZE,
): Promise<number> {
	const cutoff = new Date(Date.now() - POND_SETTINGS_DRAFT_RETENTION_DAYS * 24 * 60 * 60 * 1000);

	const stale = await prisma.pondSettingsDraft.findMany({
		where: { updatedAt: { lt: cutoff } },
		orderBy: { updatedAt: "asc" },
		select: { id: true },
		take: batchSize,
	});

	if (stale.length === 0) return 0;

	const result = await prisma.pondSettingsDraft.deleteMany({
		where: { id: { in: stale.map((row) => row.id) } },
	});

	return result.count;
}

/**
 * Prune water-temperature readings older than `WATER_TEMP_RETENTION_DAYS`.
 *
 * Bounded like the other sweeps: one oldest-first batch per cron run. The
 * batch bound, not the `(deviceId, recordedAt)` index, caps the work: that
 * index serves the per-device trend, while this sweep has no device prefix.
 */
export async function deleteOldWaterTempLogs(batchSize = DEFAULT_BATCH_SIZE): Promise<number> {
	const cutoff = new Date(Date.now() - WATER_TEMP_RETENTION_DAYS * 24 * 60 * 60 * 1000);

	const stale = await prisma.waterTempLog.findMany({
		where: { recordedAt: { lt: cutoff } },
		orderBy: { recordedAt: "asc" },
		select: { id: true },
		take: batchSize,
	});

	if (stale.length === 0) return 0;

	const result = await prisma.waterTempLog.deleteMany({
		where: { id: { in: stale.map((row) => row.id) } },
	});

	return result.count;
}

/**
 * Prune hopper-level readings older than `FEED_LEVEL_RETENTION_DAYS`.
 * One oldest-first batch per cron run.
 */
export async function deleteOldFeedLevelLogs(batchSize = DEFAULT_BATCH_SIZE): Promise<number> {
	const cutoff = new Date(Date.now() - FEED_LEVEL_RETENTION_DAYS * 24 * 60 * 60 * 1000);

	const stale = await prisma.feedLevelLog.findMany({
		where: { recordedAt: { lt: cutoff } },
		orderBy: { recordedAt: "asc" },
		select: { id: true },
		take: batchSize,
	});

	if (stale.length === 0) return 0;

	const result = await prisma.feedLevelLog.deleteMany({
		where: { id: { in: stale.map((row) => row.id) } },
	});

	return result.count;
}

/**
 * Prune notifications older than `NOTIFICATION_RETENTION_DAYS`, but only rows
 * that are already closed. An open alert — `resolvedAt` null, `autoCleared`
 * false and `supersededById` null — is never deleted, regardless of age.
 *
 * One oldest-first batch per cron run.
 */
export async function deleteOldNotifications(batchSize = DEFAULT_BATCH_SIZE): Promise<number> {
	const cutoff = new Date(Date.now() - NOTIFICATION_RETENTION_DAYS * 24 * 60 * 60 * 1000);

	const stale = await prisma.notification.findMany({
		where: {
			createdAt: { lt: cutoff },
			OR: [
				{ resolvedAt: { not: null } },
				{ autoCleared: true },
				{ supersededById: { not: null } },
			],
		},
		orderBy: { createdAt: "asc" },
		select: { id: true },
		take: batchSize,
	});

	if (stale.length === 0) return 0;

	const result = await prisma.notification.deleteMany({
		where: { id: { in: stale.map((row) => row.id) } },
	});

	return result.count;
}

/**
 * Prune calibration history older than `CALIBRATION_RUN_RETENTION_DAYS`.
 * One oldest-first batch per cron run.
 */
export async function deleteOldCalibrationRuns(batchSize = DEFAULT_BATCH_SIZE): Promise<number> {
	const cutoff = new Date(Date.now() - CALIBRATION_RUN_RETENTION_DAYS * 24 * 60 * 60 * 1000);

	const stale = await prisma.calibrationRun.findMany({
		where: { createdAt: { lt: cutoff } },
		orderBy: { createdAt: "asc" },
		select: { id: true },
		take: batchSize,
	});

	if (stale.length === 0) return 0;

	const result = await prisma.calibrationRun.deleteMany({
		where: { id: { in: stale.map((row) => row.id) } },
	});

	return result.count;
}

/**
 * Prune assistant proposals older than `ASSISTANT_ACTION_RETENTION_DAYS`.
 * One oldest-first batch per cron run.
 */
export async function deleteOldAssistantActions(batchSize = DEFAULT_BATCH_SIZE): Promise<number> {
	const cutoff = new Date(Date.now() - ASSISTANT_ACTION_RETENTION_DAYS * 24 * 60 * 60 * 1000);

	const stale = await prisma.assistantAction.findMany({
		where: { createdAt: { lt: cutoff } },
		orderBy: { createdAt: "asc" },
		select: { id: true },
		take: batchSize,
	});

	if (stale.length === 0) return 0;

	const result = await prisma.assistantAction.deleteMany({
		where: { id: { in: stale.map((row) => row.id) } },
	});

	return result.count;
}

/**
 * Prune issue reports older than `ISSUE_REPORT_RETENTION_DAYS`, but only once
 * they are no longer open. A report with `status = OPEN` and no `resolvedAt`
 * is the only copy of the reporter's message and is never deleted.
 *
 * One oldest-first batch per cron run.
 */
export async function deleteOldIssueReports(batchSize = DEFAULT_BATCH_SIZE): Promise<number> {
	const cutoff = new Date(Date.now() - ISSUE_REPORT_RETENTION_DAYS * 24 * 60 * 60 * 1000);

	const stale = await prisma.issueReport.findMany({
		where: {
			createdAt: { lt: cutoff },
			OR: [{ resolvedAt: { not: null } }, { status: { not: "OPEN" } }],
		},
		orderBy: { createdAt: "asc" },
		select: { id: true },
		take: batchSize,
	});

	if (stale.length === 0) return 0;

	const result = await prisma.issueReport.deleteMany({
		where: { id: { in: stale.map((row) => row.id) } },
	});

	return result.count;
}

/**
 * Prune reminder delivery records older than `REMINDER_LOG_RETENTION_DAYS`.
 * `sentAt` is the age clock: it is the delivery attempt, not a later edit.
 * One oldest-first batch per cron run.
 */
export async function deleteOldReminderLogs(batchSize = DEFAULT_BATCH_SIZE): Promise<number> {
	const cutoff = new Date(Date.now() - REMINDER_LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000);

	const stale = await prisma.reminderLog.findMany({
		where: { sentAt: { lt: cutoff } },
		orderBy: { sentAt: "asc" },
		select: { id: true },
		take: batchSize,
	});

	if (stale.length === 0) return 0;

	const result = await prisma.reminderLog.deleteMany({
		where: { id: { in: stale.map((row) => row.id) } },
	});

	return result.count;
}

/**
 * Prune platform audit rows older than `PLATFORM_AUDIT_LOG_RETENTION_DAYS`.
 * One oldest-first batch per cron run.
 */
export async function deleteOldPlatformAuditLogs(batchSize = DEFAULT_BATCH_SIZE): Promise<number> {
	const cutoff = new Date(Date.now() - PLATFORM_AUDIT_LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000);

	const stale = await prisma.platformAuditLog.findMany({
		where: { createdAt: { lt: cutoff } },
		orderBy: { createdAt: "asc" },
		select: { id: true },
		take: batchSize,
	});

	if (stale.length === 0) return 0;

	const result = await prisma.platformAuditLog.deleteMany({
		where: { id: { in: stale.map((row) => row.id) } },
	});

	return result.count;
}
