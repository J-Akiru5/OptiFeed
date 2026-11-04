import { resolveOrgScope } from "@/lib/auth/org-scope";
import { getCurrentPondOwnerIdSafe, getCurrentUser } from "@/lib/auth/session";
import { faultsFromMask, parseDeviceHealthReport } from "@/lib/device-health-model";
import { HOPPER_SENSOR_FAULT, resolveHopperSensorOffline } from "@/lib/device-hopper";
import { resolveRssiDbm } from "@/lib/device-status";
import { MACHINE_FEED_SOURCES } from "@/lib/feed-figures";
import { IN_FLIGHT_FEED_STATUSES } from "@/lib/feed/commands";
import { type FeederStatus, feederStatus } from "@/lib/feeder/feeder-parts";
import prisma from "@/lib/prisma";
import { getDeviceStatusPolicy } from "@/lib/settings/device-status";

/**
 * One guarded read for the device detail / 3D viewer (plan v1.1.0).
 *
 * Tenant admins see every pond in their organization; every other member sees
 * the active ponds they own (view-as resolves to the target farm through
 * `getCurrentPondOwnerIdSafe`). A device outside that scope returns null, and
 * the page turns that into notFound() — unknown and out-of-scope are the same
 * answer.
 */
export interface FeederDeviceDetail {
	id: string;
	label: string;
	mac: string;
	lastSeenAt: Date | null;
	rtcOk: boolean;
	/** Water-temperature probe health as last reported. */
	waterTempOk: boolean;
	/** Last calibrated temperature the probe reported; null when it never did. */
	waterTempC: number | null;
	/** Last time the probe reported; null when the firmware never sent one. */
	waterTempUpdatedAt: Date | null;
	/** Freshness window for a reported reading, from the device status policy. */
	staleAfterMs: number;
	/** Latest sanitised firmware diagnostics object (issue #454); null until a heartbeat carries one. */
	diag: Record<string, unknown> | null;
	/** Firmware version reported in `diag`, when present. */
	firmwareVersion: string | null;
	/** Fresh Wi-Fi signal in dBm, or null when the last reading is old/absent. */
	signalDbm: number | null;
	isPaused: boolean;
	feedLevelPercent: number | null;
	/**
	 * Raw ultrasonic distance in cm (issue #659). The percentage is what the
	 * surfaces show; this is what an operator calibrating the hopper needs to
	 * see move, and it rides the same live poll instead of a second endpoint.
	 */
	feedLevelCm: number | null;
	/** When the hopper level was measured; the freshness basis for that reading. */
	feedLevelUpdatedAt: Date | null;
	/**
	 * The unit is reachable but its ultrasonic sensor is not answering (#574).
	 * False while the whole device is offline: the viewer's `status` already
	 * says Offline, and the sensor must not take the blame for a dead unit
	 * (#810). The hopper keeps its last known level either way.
	 */
	sensorOffline: boolean;
	hopperCapacityG: number | null;
	gramsPerFeeding: number;
	pond: { id: string; name: string };
	lastFedAt: Date | null;
	lastFedGrams: number | null;
	status: FeederStatus;
	/**
	 * A feed request is still `pending` or `dispatched` for this unit (#731).
	 * The viewer polls faster while it is true, so the dispense and the new
	 * hopper level land without a manual refresh.
	 */
	pendingFeedRequest: boolean;
}

export async function getDeviceDetail(
	deviceId: string,
	now: Date = new Date(),
): Promise<FeederDeviceDetail | null> {
	const user = await getCurrentUser();
	if (!user) return null;

	let pondIds: string[];
	const orgPondIds = (await resolveOrgScope()).pondIds;
	if (orgPondIds.length > 0) {
		pondIds = orgPondIds;
	} else {
		const ownerId = await getCurrentPondOwnerIdSafe();
		if (!ownerId) return null;
		const ponds = await prisma.pond.findMany({
			where: { ownerId, status: "ACTIVE" },
			select: { id: true },
			take: 200,
		});
		pondIds = ponds.map((pond) => pond.id);
	}
	if (pondIds.length === 0) return null;

	const device = await prisma.energyDevice.findFirst({
		where: { id: deviceId, pondId: { in: pondIds } },
		select: {
			id: true,
			label: true,
			mac: true,
			lastSeenAt: true,
			rtcOk: true,
			waterTempOk: true,
			waterTempC: true,
			waterTempUpdatedAt: true,
			diag: true,
			isPaused: true,
			feedLevelPercent: true,
			feedLevelCm: true,
			feedLevelUpdatedAt: true,
			wifiRssiDbm: true,
			wifiRssiUpdatedAt: true,
			hopperCapacityG: true,
			gramsPerFeeding: true,
			pond: { select: { id: true, name: true } },
		},
	});
	if (!device?.pond) return null;

	const [latestFeed, pendingFeed] = await Promise.all([
		prisma.feedEvent.findFirst({
			where: {
				deviceId: device.id,
				eventType: "feed_dispensed",
				source: { in: [...MACHINE_FEED_SOURCES] },
			},
			orderBy: { receivedAt: "desc" },
			select: { receivedAt: true, grams: true },
		}),
		// #731: one indexed read on (deviceId, status). It decides the poll cadence,
		// so it has to be the queue's own state rather than a client guess.
		prisma.feedRequest.findFirst({
			where: { deviceId: device.id, status: { in: [...IN_FLIGHT_FEED_STATUSES] } },
			select: { id: true },
		}),
	]);

	const policy = await getDeviceStatusPolicy();
	const diag = (device.diag as Record<string, unknown> | null) ?? null;
	const status = feederStatus({
		isPaused: device.isPaused,
		lastSeenAt: device.lastSeenAt,
		lastFedAt: latestFeed?.receivedAt ?? null,
		now,
		policy,
	});
	// #810: reuse the stored heartbeat diagnostics; the sensor fault is the
	// `hopper_sensor` bit, with the stale-level fallback for old firmware. No
	// extra query and no schema change.
	const sensorFault = faultsFromMask(
		parseDeviceHealthReport({ diag })?.faultsPresent ?? 0,
	).includes(HOPPER_SENSOR_FAULT);

	return {
		...device,
		// Prisma types the Json column as a loose JsonValue; the sanitizer at
		// ingest guarantees the object shape, so this cast stays safe.
		diag,
		firmwareVersion: typeof diag?.version === "string" ? diag.version : null,
		// A stale RSSI is not a current signal, so the resolver drops it rather
		// than letting a wall display show a bar from an hour ago.
		signalDbm: resolveRssiDbm({
			rssiDbm: device.wifiRssiDbm,
			updatedAt: device.wifiRssiUpdatedAt,
			now,
			policy,
		}),
		pond: device.pond,
		staleAfterMs: policy.offlineAfterMs,
		lastFedAt: latestFeed?.receivedAt ?? null,
		lastFedGrams: latestFeed?.grams ?? null,
		status,
		pendingFeedRequest: pendingFeed !== null,
		sensorOffline: resolveHopperSensorOffline({
			deviceOffline: status === "offline",
			levelUpdatedAt: device.feedLevelUpdatedAt,
			sensorFault,
			now,
			policy,
		}),
	};
}
