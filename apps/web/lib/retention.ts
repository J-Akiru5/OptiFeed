import prisma from "@/lib/prisma";

// Heartbeat FeedEvent retention: 7 days. Deletes in batches so the 3.1 cron
// endpoint can call this every run without long locks. Never touches
// historical "connected" DeviceStateEvent rows (human-approved cleanup only).
export const HEARTBEAT_RETENTION_DAYS = 7;

const DEFAULT_BATCH_SIZE = 5000;

export async function deleteOldHeartbeatEvents(batchSize = DEFAULT_BATCH_SIZE): Promise<number> {
	const cutoff = new Date(Date.now() - HEARTBEAT_RETENTION_DAYS * 24 * 60 * 60 * 1000);

	// (deviceId, receivedAt) index makes this range scan cheap.
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
