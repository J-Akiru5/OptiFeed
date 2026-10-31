import prisma from "@/lib/prisma";

// Heartbeat FeedEvent retention: 7 days. Deletes in batches so the 3.1 cron
// endpoint can call this every run without long locks. Never touches
// historical "connected" DeviceStateEvent rows (human-approved cleanup only).
export const HEARTBEAT_RETENTION_DAYS = 7;

// An unsaved pond-settings draft is useful for days, not months (I-99). Rows
// the reader never came back to are pruned after 30 days, in the same bounded
// batch as the other housekeeping jobs.
export const POND_SETTINGS_DRAFT_RETENTION_DAYS = 30;

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
