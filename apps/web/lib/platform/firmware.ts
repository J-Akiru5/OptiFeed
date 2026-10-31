import { requirePlatformAdmin } from "@/lib/auth/require-platform-admin";
import { FIRMWARE_VERSION_EVENT_TYPES, versionFromMetadata } from "@/lib/device-firmware";
import { evaluateDeviceStatus } from "@/lib/device-status";
import prisma from "@/lib/prisma";
import { getDeviceStatusPolicy } from "@/lib/settings/device-status";
import { type FirmwareStatus, getFirmwareStatus } from "@/lib/settings/firmware-status";

/**
 * Firmware fleet view for the platform console (E16.4, task I-15).
 *
 * Read-only, platform-gated and bounded. This page deliberately reports what
 * the platform can actually prove:
 *
 *  - The reported version is the `version` in the metadata of the latest
 *    version event: an OTA lifecycle row (`ota_installed` / `ota_valid` /
 *    `ota_rolled_back`) or a `firmware_reported` row written the first time a
 *    heartbeat from a USB-flashed unit reports a new version. A unit that has
 *    never reported a version shows "unknown" — estimating from a build date
 *    would be a guess.
 *  - The channel version comes from the signed file in the private `firmware`
 *    bucket through the service role, read only.
 *  - Nothing here triggers an update or writes a row.
 */

export { versionFromMetadata };

/** A large fleet still fits in one screen of OTA history. */
export const OTA_EVENT_LIMIT = 20;
/** Recent OTA rows scanned to find each device's current version. */
export const OTA_SCAN_LIMIT = 500;
export const FIRMWARE_DEVICE_LIMIT = 500;

export interface OtaVersionRow {
	deviceId: string;
	eventType: string;
	metadata: unknown;
	createdAt: Date;
}

export interface DeviceVersion {
	version: string | null;
	eventType: string;
	createdAt: Date;
}

export interface FirmwareDeviceRow {
	id: string;
	label: string;
	mac: string;
	pondName: string | null;
	lastSeenAt: Date | null;
	online: boolean;
	reportedVersion: string | null;
	versionEvent: { eventType: string; createdAt: Date } | null;
}

export interface OtaEventRow {
	id: string;
	deviceId: string;
	deviceLabel: string;
	eventType: string;
	version: string | null;
	createdAt: Date;
}

export interface FirmwareVersionCount {
	version: string | null;
	count: number;
}

export interface FirmwareFleet {
	channel: FirmwareStatus;
	devices: FirmwareDeviceRow[];
	devicesTruncated: boolean;
	otaEvents: OtaEventRow[];
	versionCounts: FirmwareVersionCount[];
	unknownCount: number;
	generatedAt: Date;
}

/**
 * The newest version row per device, from a newest-first scan.
 *
 * The first row seen for a device wins, so callers must pass rows ordered by
 * `createdAt desc` (the query does). Rows without a version still establish the
 * event and date, which is more honest than pretending there was no update.
 */
export function latestOtaByDevice(rows: readonly OtaVersionRow[]): Map<string, DeviceVersion> {
	const latest = new Map<string, DeviceVersion>();
	for (const row of rows) {
		if (latest.has(row.deviceId)) continue;
		latest.set(row.deviceId, {
			version: versionFromMetadata(row.metadata),
			eventType: row.eventType,
			createdAt: row.createdAt,
		});
	}
	return latest;
}

/** Count devices per reported version, unknown last, for the summary card. */
export function countVersions(devices: readonly { reportedVersion: string | null }[]): {
	versionCounts: FirmwareVersionCount[];
	unknownCount: number;
} {
	const counts = new Map<string, number>();
	let unknownCount = 0;
	for (const device of devices) {
		if (device.reportedVersion === null) {
			unknownCount += 1;
			continue;
		}
		counts.set(device.reportedVersion, (counts.get(device.reportedVersion) ?? 0) + 1);
	}
	const versionCounts = [...counts.entries()]
		.map(([version, count]) => ({ version, count }))
		.sort((a, b) => b.count - a.count || String(a.version).localeCompare(String(b.version)));
	return { versionCounts, unknownCount };
}

export async function getFirmwareFleet(now: Date = new Date()): Promise<FirmwareFleet> {
	// Gate before the service-role read as well: a non-platform admin must not
	// reach Storage through this page.
	await requirePlatformAdmin();

	const [deviceRows, otaRows, recentRows, channel, statusPolicy] = await Promise.all([
		prisma.energyDevice.findMany({
			orderBy: { label: "asc" },
			take: FIRMWARE_DEVICE_LIMIT + 1,
			select: {
				id: true,
				label: true,
				mac: true,
				lastSeenAt: true,
				pond: { select: { name: true } },
			},
		}),
		prisma.deviceStateEvent.findMany({
			where: { eventType: { in: [...FIRMWARE_VERSION_EVENT_TYPES] } },
			orderBy: { createdAt: "desc" },
			take: OTA_SCAN_LIMIT,
			select: { deviceId: true, eventType: true, metadata: true, createdAt: true },
		}),
		prisma.deviceStateEvent.findMany({
			where: { eventType: { in: [...FIRMWARE_VERSION_EVENT_TYPES] } },
			orderBy: { createdAt: "desc" },
			take: OTA_EVENT_LIMIT,
			select: {
				id: true,
				deviceId: true,
				eventType: true,
				metadata: true,
				createdAt: true,
				device: { select: { label: true } },
			},
		}),
		getFirmwareStatus(),
		getDeviceStatusPolicy(),
	]);

	const latest = latestOtaByDevice(otaRows);
	const devices = deviceRows.slice(0, FIRMWARE_DEVICE_LIMIT).map((row) => {
		const version = latest.get(row.id) ?? null;
		return {
			id: row.id,
			label: row.label,
			mac: row.mac,
			pondName: row.pond?.name ?? null,
			lastSeenAt: row.lastSeenAt,
			online: !evaluateDeviceStatus({
				lastSeenAt: row.lastSeenAt,
				now,
				policy: statusPolicy,
			}).isOffline,
			reportedVersion: version?.version ?? null,
			versionEvent: version ? { eventType: version.eventType, createdAt: version.createdAt } : null,
		};
	});

	const { versionCounts, unknownCount } = countVersions(devices);

	return {
		channel,
		devices,
		devicesTruncated: deviceRows.length > FIRMWARE_DEVICE_LIMIT,
		otaEvents: recentRows.map((row) => ({
			id: row.id,
			deviceId: row.deviceId,
			deviceLabel: row.device.label,
			eventType: row.eventType,
			version: versionFromMetadata(row.metadata),
			createdAt: row.createdAt,
		})),
		versionCounts,
		unknownCount,
		generatedAt: now,
	};
}
