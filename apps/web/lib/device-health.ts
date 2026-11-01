import {
	DEVICE_HEALTH_EVENT,
	type DeviceHealthKey,
	type DeviceHealthView,
	HEALTHY_VIEW,
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

/**
 * Health is advisory on pages that are about something else (the dashboard, the
 * schedule). A failed read must not take such a page down, so it reads as
 * healthy and the failure is logged. Surfaces whose whole point is device health
 * use `getDeviceHealth` and let the error surface.
 */
export async function getDeviceHealthSafe(
	deviceId: string,
	now = new Date(),
): Promise<DeviceHealthView> {
	try {
		return await getDeviceHealth(deviceId, now);
	} catch (error) {
		console.warn(
			"[device-health] read failed",
			error instanceof Error ? error.message : String(error),
		);
		return HEALTHY_VIEW;
	}
}
