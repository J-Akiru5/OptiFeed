import {
	DEVICE_HEALTH_EVENT,
	type DeviceHealthKey,
	type DeviceHealthView,
	REFUSAL_LOOKBACK_MS,
	buildHealthView,
	healthFromMetadata,
} from "@/lib/device-health-model";
import prisma from "@/lib/prisma";

export * from "@/lib/device-health-model";

/**
 * Database reads for device health. The model (names, parsing, change rules,
 * the view builder) is in `device-health-model.ts`; see that file for how the
 * state is stored in the `DeviceStateEvent` stream.
 */

/** The newest stored health state for a device, or null when none was ever written. */
export async function getLatestHealthKey(deviceId: string): Promise<DeviceHealthKey | null> {
	const row = await prisma.deviceStateEvent.findFirst({
		where: { deviceId, eventType: DEVICE_HEALTH_EVENT },
		orderBy: { createdAt: "desc" },
		select: { metadata: true },
	});
	return row ? healthFromMetadata(row.metadata) : null;
}

/** Two bounded reads: the newest health row and the newest refused dose. */
export async function getDeviceHealth(
	deviceId: string,
	now = new Date(),
): Promise<DeviceHealthView> {
	const [health, refusal] = await Promise.all([
		prisma.deviceStateEvent.findFirst({
			where: { deviceId, eventType: DEVICE_HEALTH_EVENT },
			orderBy: { createdAt: "desc" },
			select: { metadata: true, createdAt: true },
		}),
		prisma.deviceStateEvent.findFirst({
			where: {
				deviceId,
				eventType: "feed_refused",
				createdAt: { gte: new Date(now.getTime() - REFUSAL_LOOKBACK_MS) },
			},
			orderBy: { createdAt: "desc" },
			select: { metadata: true, createdAt: true },
		}),
	]);
	return buildHealthView({ health, refusal, now });
}
