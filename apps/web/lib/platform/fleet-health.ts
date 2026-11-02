import { requirePlatformAdmin } from "@/lib/auth/require-platform-admin";
import { FIRMWARE_VERSION_EVENT_TYPES, versionFromMetadata } from "@/lib/device-firmware";
import { DEVICE_HEALTH_EVENT } from "@/lib/device-health-model";
import type { DeviceStatusPolicy } from "@/lib/device-status";
import { MACHINE_FEED_SOURCES } from "@/lib/feed-figures";
import {
	type FleetDeviceInput,
	type FleetSummary,
	type TenantFleetRow,
	buildTenantFleetRows,
	summarizeFleet,
} from "@/lib/platform/fleet-health-rules";
import { resolveFarmsToOrganizations } from "@/lib/platform/tenant-resolution";
import prisma from "@/lib/prisma";
import { getDeviceStatusPolicy } from "@/lib/settings/device-status";
import { Prisma } from "@prisma/client";

/**
 * Fleet monitor loader (issue #479, M3C.4 and M3C.4b).
 *
 * Read-only and platform-gated: one bounded device query, the same farm → user →
 * active membership → organization resolution the device registry already uses
 * (M3.9, now in `tenant-resolution.ts`), three bounded telemetry reads, and the
 * configured `device.status` policy handed to the pure rules in
 * `fleet-health-rules.ts`. No token or tokenHash is ever selected.
 *
 * Every telemetry row comes from a source that already exists:
 *
 *  - the heartbeat itself (`lastSeenAt`, `wifiRssi*`) and the readings stored on
 *    `EnergyDevice` (`feedLevel*`, `waterTemp*`) — issue #454 and its
 *    predecessors;
 *  - `EnergyDevice.diag`, the sanitised diagnostics the heartbeat carries;
 *  - the newest `device_health` row per unit, which ingest writes on every state
 *    change (issue #454);
 *  - the newest version-carrying state event per unit (`firmware_reported` /
 *    OTA lifecycle, #263) for firmware too old to send `diag`;
 *  - the newest machine dispense per unit (`FeedEvent`), filtered by the same
 *    `MACHINE_FEED_SOURCES` rule the History card uses, so an imported
 *    `hand_fed` daily total is never called "the last feed".
 *
 * A unit with no row in one of those sources keeps `null` (the page renders
 * "Not reported", "Unknown" or "Never"); nothing is defaulted to zero.
 *
 * A failing source is reported, not hidden: the caller receives
 * `sourceError: true` with an `unknown` summary, so the page cannot render a
 * broken query — or a broken telemetry read — as a healthy fleet.
 */

/** Device tables stay bounded; the page says when the list was cut. */
export const FLEET_DEVICE_LIMIT = 1000;

export interface FleetMonitor {
	checkedAt: Date;
	/** Null when the policy itself could not be read, which makes the view unknown. */
	policy: DeviceStatusPolicy | null;
	rows: TenantFleetRow[];
	summary: FleetSummary;
	totalDevices: number;
	truncated: boolean;
	sourceError: boolean;
}

/** The newest state event of one family, as read back from the event stream. */
interface LatestEventRow {
	deviceId: string;
	eventType: string;
	metadata: unknown;
	createdAt: Date;
}

function emptyMonitor(now: Date): FleetMonitor {
	return {
		checkedAt: now,
		policy: null,
		rows: [],
		summary: { state: "unknown", counts: { ok: 0, degraded: 0, critical: 0, unknown: 0 } },
		totalDevices: 0,
		truncated: false,
		sourceError: true,
	};
}

function byDevice(rows: readonly LatestEventRow[]): Map<string, LatestEventRow> {
	const map = new Map<string, LatestEventRow>();
	for (const row of rows) map.set(row.deviceId, row);
	return map;
}

/**
 * Newest `device_health` row per unit.
 *
 * Prisma cannot express "the newest row per device" in one bounded query: a
 * `findMany` with a `take` either reads every row or silently misses the units
 * whose last state change is old — and ingest only writes a row on a change, so
 * those are exactly the healthy units. `DISTINCT ON` is the database's own form
 * of the question, and `@@index([deviceId, createdAt])` carries it. One row per
 * unit, no matter how much history the fleet has.
 */
async function readLatestHealth(
	deviceIds: readonly string[],
): Promise<Map<string, LatestEventRow>> {
	if (deviceIds.length === 0) return new Map();
	const rows = await prisma.$queryRaw<LatestEventRow[]>`
		SELECT DISTINCT ON ("deviceId") "deviceId", "eventType", "metadata", "createdAt"
		FROM "DeviceStateEvent"
		WHERE "deviceId" IN (${Prisma.join([...deviceIds])})
		  AND "eventType" = ${DEVICE_HEALTH_EVENT}
		ORDER BY "deviceId", "createdAt" DESC
	`;
	return byDevice(rows);
}

/**
 * Newest version-carrying event per unit. Same shape and same reason as
 * `readLatestHealth`; the event types come from `lib/device-firmware.ts`, so the
 * monitor and the firmware page agree on what counts as a version report.
 */
async function readLatestFirmware(
	deviceIds: readonly string[],
): Promise<Map<string, LatestEventRow>> {
	if (deviceIds.length === 0) return new Map();
	const rows = await prisma.$queryRaw<LatestEventRow[]>`
		SELECT DISTINCT ON ("deviceId") "deviceId", "eventType", "metadata", "createdAt"
		FROM "DeviceStateEvent"
		WHERE "deviceId" IN (${Prisma.join([...deviceIds])})
		  AND "eventType" IN (${Prisma.join([...FIRMWARE_VERSION_EVENT_TYPES])})
		ORDER BY "deviceId", "createdAt" DESC
	`;
	return byDevice(rows);
}

/**
 * Newest machine dispense per unit, in one grouped read.
 *
 * The filter is the History card's rule (`feed_dispensed` from a
 * `MACHINE_FEED_SOURCES` source), so a `hand_fed` daily import — one row for a
 * whole day of hand feeding — is never presented as "last successful feed".
 * A unit with no such row is simply absent, which reads "Never".
 */
async function readLastMachineFeeds(deviceIds: readonly string[]): Promise<Map<string, Date>> {
	const feeds = new Map<string, Date>();
	if (deviceIds.length === 0) return feeds;

	const rows = await prisma.feedEvent.groupBy({
		by: ["deviceId"],
		where: {
			deviceId: { in: [...deviceIds] },
			eventType: "feed_dispensed",
			source: { in: [...MACHINE_FEED_SOURCES] },
		},
		_max: { receivedAt: true },
	});

	for (const row of rows) {
		const at = row._max.receivedAt;
		if (at) feeds.set(row.deviceId, at);
	}
	return feeds;
}

export async function getFleetMonitor(now: Date = new Date()): Promise<FleetMonitor> {
	await requirePlatformAdmin();

	try {
		const [policy, devices] = await Promise.all([
			getDeviceStatusPolicy(),
			prisma.energyDevice.findMany({
				orderBy: { label: "asc" },
				take: FLEET_DEVICE_LIMIT + 1,
				select: {
					id: true,
					label: true,
					mac: true,
					lastSeenAt: true,
					// M3C.4b telemetry: readings already stored on the device row.
					wifiRssiDbm: true,
					wifiRssiUpdatedAt: true,
					feedLevelPercent: true,
					feedLevelUpdatedAt: true,
					waterTempC: true,
					waterTempOk: true,
					waterTempUpdatedAt: true,
					// `diag` is size-capped at ingest (`DIAG_BYTES_MAX`, 2 KB), so the
					// bounded fleet stays within a couple of MB even when every unit
					// reports diagnostics.
					diag: true,
					pond: { select: { name: true, ownerId: true } },
				},
			}),
		]);

		const truncated = devices.length > FLEET_DEVICE_LIMIT;
		const bounded = truncated ? devices.slice(0, FLEET_DEVICE_LIMIT) : devices;
		const deviceIds = bounded.map((device) => device.id);

		// pond.ownerId is a farm id (one farm per farmer), so a device reaches its
		// tenant the same way the registry resolves it.
		const farmIds = [...new Set(bounded.flatMap((d) => (d.pond ? [d.pond.ownerId] : [])))];
		const [tenantByFarm, lastFeedByDevice, healthByDevice, firmwareByDevice] = await Promise.all([
			resolveFarmsToOrganizations(farmIds),
			readLastMachineFeeds(deviceIds),
			readLatestHealth(deviceIds),
			readLatestFirmware(deviceIds),
		]);

		const inputs: FleetDeviceInput[] = bounded.map((device) => {
			const tenant = device.pond ? (tenantByFarm.get(device.pond.ownerId) ?? null) : null;
			const health = healthByDevice.get(device.id) ?? null;
			const firmware = firmwareByDevice.get(device.id) ?? null;
			return {
				id: device.id,
				label: device.label,
				mac: device.mac,
				lastSeenAt: device.lastSeenAt,
				tenantId: tenant?.id ?? null,
				tenantName: tenant?.name ?? null,
				pondName: device.pond?.name ?? null,
				diag: device.diag,
				rssiDbm: device.wifiRssiDbm,
				rssiUpdatedAt: device.wifiRssiUpdatedAt,
				feedLevelPercent: device.feedLevelPercent,
				feedLevelUpdatedAt: device.feedLevelUpdatedAt,
				waterTempC: device.waterTempC,
				waterTempOk: device.waterTempOk,
				waterTempUpdatedAt: device.waterTempUpdatedAt,
				firmwareEvent: firmware
					? {
							version: versionFromMetadata(firmware.metadata),
							createdAt: firmware.createdAt,
						}
					: null,
				lastFeedAt: lastFeedByDevice.get(device.id) ?? null,
				health: health ? { metadata: health.metadata, createdAt: health.createdAt } : null,
			};
		});

		const rows = buildTenantFleetRows(inputs, now, policy);

		return {
			checkedAt: now,
			policy,
			rows,
			summary: summarizeFleet(rows),
			totalDevices: bounded.length,
			truncated,
			sourceError: false,
		};
	} catch {
		return emptyMonitor(now);
	}
}
