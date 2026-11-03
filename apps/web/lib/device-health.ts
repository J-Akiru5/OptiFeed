import {
	DEVICE_HEALTH_EVENT,
	type DeviceHealthKey,
	type DeviceHealthView,
	REFUSAL_LOOKBACK_MS,
	buildHealthView,
	healthFromMetadata,
	unavailableHealthView,
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
 * schedule). A failed read must not take such a page down, and it must not
 * pretend the feeder is healthy (#624): it returns an explicit "cannot verify"
 * view carrying the attempt time and, when this process has seen one, the last
 * successful read. Surfaces whose whole point is device health use
 * `getDeviceHealth` and let the error surface.
 */

/** Last successful read per device, for the "unknown since" line. */
const lastSuccessByDevice = new Map<string, Date>();

/** Test hook: the cache is process-wide by design. */
export function resetDeviceHealthCacheForTests(): void {
	lastSuccessByDevice.clear();
}

export async function getDeviceHealthSafe(
	deviceId: string,
	now = new Date(),
): Promise<DeviceHealthView> {
	try {
		const view = await getDeviceHealth(deviceId, now);
		lastSuccessByDevice.set(deviceId, now);
		return view;
	} catch (error) {
		console.warn(
			"[device-health] read failed",
			error instanceof Error ? error.message : String(error),
		);
		return unavailableHealthView(now, lastSuccessByDevice.get(deviceId) ?? null);
	}
}
