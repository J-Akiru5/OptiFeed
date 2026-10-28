import prisma from "@/lib/prisma";

/**
 * The firmware version a unit is actually running (#263).
 *
 * A heartbeat carries `firmware_version`, but nothing on `EnergyDevice` stores
 * it. The version is therefore kept in the existing `DeviceStateEvent` stream:
 *
 *  - an OTA lifecycle row records it on a state transition (`ota_installed`
 *    / `ota_valid` / `ota_rolled_back`), and
 *  - `/api/ingest` writes a `firmware_reported` row the first time a heartbeat
 *    reports a version that no version event has recorded yet (for example
 *    after a USB flash, which never goes through OTA).
 *
 * This module is pure metadata handling plus one bounded read, so the ingest
 * route, the hardware card, the feeder hero and the platform fleet all resolve
 * the version the same way. No schema change is needed.
 */

/** OTA lifecycle rows written by the ingest transition detector. */
export const OTA_EVENT_TYPES = ["ota_installed", "ota_valid", "ota_rolled_back"] as const;
export type OtaEventType = (typeof OTA_EVENT_TYPES)[number];

/** A heartbeat-first version row (covers USB flashes and first contact). */
export const FIRMWARE_REPORTED_EVENT = "firmware_reported";

/** Every event type that carries the running version in `metadata.version`. */
export const FIRMWARE_VERSION_EVENT_TYPES = [...OTA_EVENT_TYPES, FIRMWARE_REPORTED_EVENT] as const;

/** Read the reported version from an event row's JSON metadata. */
export function versionFromMetadata(metadata: unknown): string | null {
	if (typeof metadata !== "object" || metadata === null) return null;
	const value = (metadata as { version?: unknown }).version;
	if (typeof value !== "string") return null;
	const trimmed = value.trim();
	return trimmed.length > 0 && trimmed.length <= 32 ? trimmed : null;
}

export interface DeviceFirmwareVersion {
	version: string | null;
	eventType: string;
	createdAt: Date;
}

/**
 * Newest version-carrying event for a device.
 *
 * Returns null when the unit has never reported a version. A row without a
 * usable version still establishes the event, which is more honest than
 * pretending there was no report.
 */
export async function getDeviceFirmwareVersion(
	deviceId: string,
): Promise<DeviceFirmwareVersion | null> {
	const row = await prisma.deviceStateEvent.findFirst({
		where: {
			deviceId,
			eventType: { in: [...FIRMWARE_VERSION_EVENT_TYPES] },
		},
		orderBy: { createdAt: "desc" },
		select: { eventType: true, metadata: true, createdAt: true },
	});
	if (!row) return null;
	return {
		version: versionFromMetadata(row.metadata),
		eventType: row.eventType,
		createdAt: row.createdAt,
	};
}
